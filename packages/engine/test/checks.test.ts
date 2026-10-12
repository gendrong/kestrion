import { describe, expect, it } from 'vitest';
import {
  checkClusterBuy,
  checkCreatorHistory,
  checkCreatorWallet,
  checkCurveState,
  checkExemptions,
  checkHolders,
  checkPairType,
  checkSellPressure,
} from '../src/checks';
import { ENGINE_CONFIG as cfg } from '../src/scoring/config';
import { err, ok, type PriorLaunch } from '../src/types';
import { A, buy, CREATOR, CURVE, FUNDER, launch, makeData, pctOfSupply, TOKEN } from './fixtures';

const exemptData = (n: number, linkedToCreator = 0, boughtPct = 0) => {
  const wallets = Array.from({ length: n }, (_, i) => A(0x1000 + i));
  return makeData({
    exemptions: ok({
      windowSeconds: 3,
      declared: wallets,
      detected: wallets.map((address) => ({ address, via: 'exempt at launch (SnipeTaxExempted event)' })),
      autoExempt: [CREATOR],
      complete: true,
    }),
    earlyTrades: ok(boughtPct > 0 ? wallets.map((w) => buy(w, boughtPct / n)) : []),
    linked: ok([
      { address: CREATOR, reasons: ['creator'] },
      ...wallets.map((address, i) => ({
        address,
        reasons: i < linkedToCreator ? ['snipe-tax exempt (chosen by the creator)', 'funded by the creator'] : ['snipe-tax exempt (chosen by the creator)'],
      })),
    ]),
  });
};

describe('check 1: snipe-tax exemptions', () => {
  it('passes with no extra exempt wallets', () => {
    expect(checkExemptions(exemptData(0), cfg).status).toBe('pass');
  });
  it('warns on a few unlinked exempt wallets', () => {
    const r = checkExemptions(exemptData(2), cfg);
    expect(r.status).toBe('warn');
    expect(r.value.exemptWallets).toBe(2);
  });
  it('fails when an exempt wallet was funded by the creator', () => {
    const r = checkExemptions(exemptData(3, 1), cfg);
    expect(r.status).toBe('fail');
    expect(r.value.fundedByOrSharingFundsWithCreator).toBe(1);
  });
  it('fails on many exempt wallets', () => {
    expect(checkExemptions(exemptData(cfg.checks.exemptions.failAtCount), cfg).status).toBe('fail');
  });
  it('fails when exempt wallets bought a large share early', () => {
    const r = checkExemptions(exemptData(2, 0, 8), cfg);
    expect(r.status).toBe('fail');
    expect(r.value.boughtInEarlyWindowSupplyPct).toBe(8);
  });
  it('is informational for V1 launches', () => {
    const r = checkExemptions(makeData({ launch: launch({ version: 'v1' }), exemptions: 'not_applicable' }), cfg);
    expect(r.status).toBe('pass');
    expect(r.value.applicable).toBe(false);
  });
  it('is unknown when data failed', () => {
    expect(checkExemptions(makeData({ exemptions: err('boom') }), cfg).status).toBe('unknown');
  });
});

describe('check 2: creator cluster buy', () => {
  const linkedW = A(0x2000);
  const other = A(0x3000);
  const data = (creatorPct: number, linkedPct: number, otherPct = 1) =>
    makeData({
      earlyTrades: ok([buy(CREATOR, creatorPct), buy(linkedW, linkedPct), buy(other, otherPct)]),
      linked: ok([
        { address: CREATOR, reasons: ['creator'] },
        { address: linkedW, reasons: ['funded by the creator'] },
      ]),
    });
  it('passes when linked wallets bought little', () => {
    const r = checkClusterBuy(data(1, 1), cfg);
    expect(r.status).toBe('pass');
    expect(r.value.creatorAndLinkedSupplyPct).toBe(2);
  });
  it('warns at the warn threshold', () => {
    expect(checkClusterBuy(data(3, 3), cfg).status).toBe('warn');
  });
  it('fails at the fail threshold', () => {
    const r = checkClusterBuy(data(5, 12), cfg);
    expect(r.status).toBe('fail');
    expect(r.value.creatorSupplyPct).toBe(5);
    expect(r.value.allBuyersSupplyPct).toBe(18);
  });
  it('is unknown (not pass) when linking failed and the creator alone looks fine', () => {
    expect(checkClusterBuy(makeData({ earlyTrades: ok([buy(CREATOR, 1)]), linked: err('no explorer') }), cfg).status).toBe('unknown');
  });
  it('still fails when linking failed but the creator alone bought a lot', () => {
    expect(checkClusterBuy(makeData({ earlyTrades: ok([buy(CREATOR, 20)]), linked: err('no explorer') }), cfg).status).toBe('fail');
  });
  it('is unknown when trades failed', () => {
    expect(checkClusterBuy(makeData({ earlyTrades: err('rpc down') }), cfg).status).toBe('unknown');
  });
});

describe('check 3: holder concentration', () => {
  const holder = (n: number, pct: number, isContract = false) => ({ address: A(n), balance: pctOfSupply(pct), isContract });
  it('excludes curve/pool/burn and passes when spread out', () => {
    const r = checkHolders(makeData({ holders: ok([{ address: CURVE, balance: pctOfSupply(70), isContract: true }, ...Array.from({ length: 12 }, (_, i) => holder(0x100 + i, 1))]) }), cfg);
    expect(r.status).toBe('pass');
    expect(r.value.topHoldersSupplyPct).toBe(10);
  });
  it('warns at 25%+', () => {
    expect(checkHolders(makeData({ holders: ok([holder(1, 20), holder(2, 6)]) }), cfg).status).toBe('warn');
  });
  it('fails at 40%+ and labels the creator', () => {
    const r = checkHolders(makeData({ holders: ok([{ address: CREATOR, balance: pctOfSupply(42), isContract: false }]) }), cfg);
    expect(r.status).toBe('fail');
    expect(r.value.largestHolderLabel).toBe('creator');
  });
  it('excludes token lockers and reports locked supply', () => {
    const r = checkHolders(
      makeData({ holders: ok([{ address: A(0x10c), balance: pctOfSupply(30), isContract: true, name: 'RobinhoodLocker' }, holder(2, 3)]) }),
      cfg,
    );
    expect(r.status).toBe('pass');
    expect(r.value.topHoldersSupplyPct).toBe(3);
    expect(r.value.lockedInLockersPct).toBe(30);
  });
  it('passes when nobody holds outside the curve', () => {
    expect(checkHolders(makeData({ holders: ok([{ address: CURVE, balance: pctOfSupply(100), isContract: true }]) }), cfg).status).toBe('pass');
  });
  it('is unknown when holders failed', () => {
    expect(checkHolders(makeData({ holders: err('x') }), cfg).status).toBe('unknown');
  });
});

describe('check 4: creator history', () => {
  const prior = (i: number, over: Partial<PriorLaunch> = {}): PriorLaunch => ({
    token: A(0x5000 + i),
    factoryId: 'pons-v2',
    name: `Coin ${i}`,
    symbol: `C${i}`,
    launchBlock: BigInt(i),
    graduated: false,
    diedFast: false,
    ...over,
  });
  const data = (launches: PriorLaunch[], total = launches.length) => makeData({ priorLaunches: ok({ launches, total, partial: false }) });
  it('passes for a first launch', () => {
    expect(checkCreatorHistory(data([]), cfg).status).toBe('pass');
  });
  it('passes with one clean prior launch', () => {
    expect(checkCreatorHistory(data([prior(1, { graduated: true })]), cfg).status).toBe('pass');
  });
  it('warns on serial launching', () => {
    expect(checkCreatorHistory(data([prior(1), prior(2), prior(3)]), cfg).status).toBe('warn');
  });
  it('fails for a serial launcher', () => {
    const r = checkCreatorHistory(data([prior(1)], cfg.checks.creatorHistory.failAtPriorLaunches), cfg);
    expect(r.status).toBe('fail');
    expect(r.explanation).toMatch(/earlier launches by this creator/);
  });
  it('warns on a reused ticker', () => {
    const r = checkCreatorHistory(data([prior(1, { symbol: 'TEST' })]), cfg);
    expect(r.status).toBe('warn');
    expect(r.value.repeatedNameOrTicker).toBe(1);
  });
  it('fails when most prior launches died fast', () => {
    const r = checkCreatorHistory(data([prior(1, { diedFast: true }), prior(2, { diedFast: true }), prior(3)]), cfg);
    expect(r.status).toBe('fail');
    expect(r.value.diedFast).toBe(2);
  });
  it('is unknown when the search failed', () => {
    expect(checkCreatorHistory(makeData({ priorLaunches: err('x') }), cfg).status).toBe('unknown');
  });
});

describe('check 5: creator wallet', () => {
  const wallet = (ageDays: number | undefined, funderKind: 'exchange' | 'wallet' | 'launch_proceeds', funderAgeDays?: number) =>
    makeData({
      creatorWallet: ok({
        address: CREATOR,
        ageDays,
        funder: FUNDER,
        funderKind,
        funderProfile: funderAgeDays === undefined ? undefined : { address: FUNDER, ageDays: funderAgeDays, funderKind: 'wallet' },
      }),
    });
  it('passes for an old exchange-funded wallet', () => {
    expect(checkCreatorWallet(wallet(200, 'exchange'), cfg).status).toBe('pass');
  });
  it('warns for a fresh wallet', () => {
    expect(checkCreatorWallet(wallet(0.5, 'exchange'), cfg).status).toBe('warn');
  });
  it('warns when funded by launch proceeds', () => {
    expect(checkCreatorWallet(wallet(30, 'launch_proceeds'), cfg).status).toBe('warn');
  });
  it('fails for a fresh wallet funded by another fresh wallet', () => {
    expect(checkCreatorWallet(wallet(0.2, 'wallet', 0.5), cfg).status).toBe('fail');
  });
  it('is unknown without history', () => {
    expect(checkCreatorWallet(wallet(undefined, 'wallet'), cfg).status).toBe('unknown');
    expect(checkCreatorWallet(makeData({ creatorWallet: err('x') }), cfg).status).toBe('unknown');
  });
});

describe('check 6: curve state (informational)', () => {
  it('reports progress', () => {
    const r = checkCurveState(makeData(), cfg);
    expect(r.status).toBe('pass');
    expect(r.value.progressPct).toBe(2.38);
    expect(r.value.raised).toBe('0.1 ETH');
  });
  it('reports graduation', () => {
    const r = checkCurveState(makeData({ curve: ok({ raised: 0n, threshold: 1n, progressPct: 100, graduated: true, phase: 'PoolCreated' }) }), cfg);
    expect(r.explanation).toMatch(/Graduated/);
  });
  it('warns for rescued launches', () => {
    expect(checkCurveState(makeData({ curve: ok({ raised: 0n, threshold: 1n, progressPct: 0, graduated: false, phase: 'Rescued' }) }), cfg).status).toBe('warn');
  });
});

describe('check 7: pair type (informational)', () => {
  it('describes ETH, USDG and other pairs', () => {
    expect(checkPairType(makeData(), cfg).explanation).toBe('Paired with ETH.');
    expect(checkPairType(makeData({ launch: launch({ pairType: 'USDG', pairSymbol: 'USDG' }) }), cfg).explanation).toMatch(/stablecoin/);
    const other = checkPairType(makeData({ launch: launch({ pairType: 'Other', pairSymbol: 'ORBIO' }) }), cfg);
    expect(other.status).toBe('pass');
    expect(other.explanation).toMatch(/ORBIO/);
  });
});

describe('check 8: sell pressure', () => {
  const data = (received: bigint, sent: bigint, lockedOrBurned = 0n) =>
    makeData({ flows: ok([{ address: CREATOR, received, sent, lockedOrBurned }]) });
  it('does not count tokens sent to lockers as selling', () => {
    const r = checkSellPressure(data(pctOfSupply(5), 0n, pctOfSupply(5)), cfg);
    expect(r.status).toBe('pass');
    expect(r.value.lockedOrBurnedPct).toBe(100);
  });
  it('passes when nothing was received', () => {
    expect(checkSellPressure(data(0n, 0n), cfg).status).toBe('pass');
  });
  it('passes when holding', () => {
    expect(checkSellPressure(data(pctOfSupply(5), pctOfSupply(1)), cfg).status).toBe('pass');
  });
  it('warns at 50%+ sold', () => {
    expect(checkSellPressure(data(pctOfSupply(4), pctOfSupply(2)), cfg).status).toBe('warn');
  });
  it('fails at 80%+ sold', () => {
    const r = checkSellPressure(data(pctOfSupply(4), pctOfSupply(4)), cfg);
    expect(r.status).toBe('fail');
    expect(r.value.soldOrMovedPct).toBe(100);
  });
  it('is unknown when flows failed', () => {
    expect(checkSellPressure(makeData({ flows: err('x') }), cfg).status).toBe('unknown');
  });
});

it('fixtures use the token address', () => {
  expect(makeData().launch.token).toBe(TOKEN);
});

/** Builders for fake scan data, so every check can be tested without network access. */
import type { Address, Hash } from 'viem';
import { ok, type LaunchInfo, type ScanData, type Trade } from '../src/types';

export const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
export const CREATOR = A(0xc0ffee);
export const TOKEN = A(0x70ce);
export const CURVE = A(0xc0e);
export const FUNDER = A(0xf00d);
export const SUPPLY = 1_000_000_000n * 10n ** 18n;
export const LAUNCH_TIME = 1_791_400_000;
export const TX = `0x${'ab'.repeat(32)}` as Hash;

/** `p` percent of total supply, as a token amount. */
export const pctOfSupply = (p: number) => (SUPPLY * BigInt(Math.round(p * 100))) / 10_000n;

export function launch(over: Partial<LaunchInfo> = {}): LaunchInfo {
  return {
    launchpad: 'pons',
    factoryId: 'pons-v2',
    factoryAddress: A(0xfac),
    version: 'v2',
    token: TOKEN,
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 18,
    totalSupply: SUPPLY,
    deployer: CREATOR,
    deployerIsContract: false,
    launchTxFrom: CREATOR,
    launchTxTo: A(0xfac),
    creatorFeeRecipient: CREATOR,
    creator: CREATOR,
    pairToken: A(0),
    pairType: 'ETH',
    pairSymbol: 'ETH',
    pairDecimals: 18,
    curve: CURVE,
    launchBlock: 1000n,
    launchTime: LAUNCH_TIME,
    launchTx: TX,
    launchConfigId: 0n,
    graduationThreshold: 4_200_000_000_000_000_000n,
    feeBps: 100,
    creatorTaxBps: 200,
    ...over,
  };
}

export function buy(wallet: Address, supplyPct: number, over: Partial<Trade> = {}): Trade {
  return {
    block: 1001n,
    tx: TX,
    logIndex: 0,
    side: 'buy',
    wallet,
    tokenAmount: pctOfSupply(supplyPct),
    quoteAmount: 10n ** 16n,
    feeAmount: 10n ** 14n, // exactly 1%: paid no snipe tax
    time: LAUNCH_TIME + 10,
    ...over,
  };
}

export function makeData(over: Partial<ScanData> = {}): ScanData {
  return {
    launch: launch(),
    now: LAUNCH_TIME + 3600,
    latestBlock: 100_000n,
    earlyWindowBlocks: 300,
    curve: ok({ raised: 10n ** 17n, threshold: 42n * 10n ** 17n, progressPct: 2.38, graduated: false, phase: 'NotGraduated' }),
    earlyTrades: ok([]),
    exemptions: ok({ windowSeconds: 3, declared: [], detected: [], autoExempt: [CREATOR], complete: true }),
    holders: ok([]),
    excluded: [CURVE, A(0), A(0xdead)],
    creatorWallet: ok({ address: CREATOR, ageDays: 120, firstSeen: LAUNCH_TIME - 120 * 86400, funder: FUNDER, funderKind: 'exchange', funderLabel: 'Binance 14' }),
    linked: ok([{ address: CREATOR, reasons: ['creator'] }]),
    priorLaunches: ok({ launches: [], total: 0, partial: false }),
    flows: ok([]),
    ...over,
  };
}

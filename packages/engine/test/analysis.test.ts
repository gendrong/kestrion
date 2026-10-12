import { encodeFunctionData, zeroHash, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { decodeDeclaredExemptions, detectExemptBuys, diedFast } from '../src/adapters/pons/analysis';
import { ponsV2FactoryAbi, ponsV2RouterAbi } from '../src/chain/abis';
import { PONS_V2, VERIFIED_TOPICS } from '../src/chain/config';
import { TOPICS } from '../src/chain/topics';
import { classifyLabels } from '../src/scan/wallets';
import { A, buy, LAUNCH_TIME } from './fixtures';

describe('event topics match the hashes verified on-chain', () => {
  it.each(Object.keys(VERIFIED_TOPICS) as (keyof typeof VERIFIED_TOPICS)[])('%s', (k) => {
    expect(TOPICS[k]).toBe(VERIFIED_TOPICS[k]);
  });
});

describe('detectExemptBuys (snipe tax is inside the CurveBuy fee)', () => {
  const q = 10n ** 16n;
  const trade = (wallet: Address, secondsAfter: number, feeBps: number) =>
    buy(wallet, 1, { time: LAUNCH_TIME + secondsAfter, quoteAmount: q, feeAmount: (q * BigInt(feeBps)) / 10_000n });

  it('flags tax-free buys inside the window', () => {
    const found = detectExemptBuys([trade(A(1), 0, 100), trade(A(2), 1, 100)], LAUNCH_TIME, 3, 100);
    expect(found).toEqual([A(1), A(2)]);
  });
  it('does not flag buys that paid the snipe tax (measured: +1s = 7.18%, +2s = 1.19%)', () => {
    expect(detectExemptBuys([trade(A(1), 0, 9999), trade(A(2), 1, 718), trade(A(3), 2, 119)], LAUNCH_TIME, 3, 100)).toEqual([]);
  });
  it('ignores buys after the window', () => {
    expect(detectExemptBuys([trade(A(1), 3, 100), trade(A(2), 40, 100)], LAUNCH_TIME, 3, 100)).toEqual([]);
  });
  it('handles rounding (0.9999% fee)', () => {
    const t = buy(A(9), 1, { time: LAUNCH_TIME, quoteAmount: 10_000n, feeAmount: 99n });
    expect(detectExemptBuys([t], LAUNCH_TIME, 3, 100)).toEqual([A(9)]);
  });
});

describe('decodeDeclaredExemptions', () => {
  const params = {
    name: 'X',
    symbol: 'X',
    logo: '',
    description: '',
    socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
    creatorFeeRecipient: A(1),
    creatorTaxBps: 200,
    buybackEnabled: false,
    expectedEconomics: zeroHash,
    salt: zeroHash,
  } as const;
  const exempt = [A(0x11), A(0x22)];

  it('reads the list from a launchAndBuy call', () => {
    const data = encodeFunctionData({ abi: ponsV2RouterAbi, functionName: 'launchAndBuy', args: [params, 0n, A(0), 1n, 0n, A(1), exempt] });
    expect(decodeDeclaredExemptions(data, PONS_V2.launchAndBuyRouter)?.map((a) => a.toLowerCase())).toEqual(exempt);
  });
  it('reads the list from a factory launchToken call', () => {
    const data = encodeFunctionData({ abi: ponsV2FactoryAbi, functionName: 'launchToken', args: [params, 0n, A(0), exempt] });
    expect(decodeDeclaredExemptions(data, PONS_V2.factory)?.map((a) => a.toLowerCase())).toEqual(exempt);
  });
  it('returns [] for the overload without exemptions', () => {
    const data = encodeFunctionData({ abi: ponsV2FactoryAbi, functionName: 'launchToken', args: [params, 0n, A(0)] });
    expect(decodeDeclaredExemptions(data, PONS_V2.factory)).toEqual([]);
  });
  it('returns null for launches through other contracts', () => {
    expect(decodeDeclaredExemptions('0xa3a3ee69', A(0x999))).toBeNull();
  });
});

describe('diedFast', () => {
  const opts = { launchTime: 0, threshold: 4_200n, graduated: false, now: 200_000, windowHours: 24, dropPct: 90, minPeakPctOfThreshold: 5 };
  const t = (time: number, side: 'buy' | 'sell', quoteAmount: bigint) => ({ time, side, quoteAmount });
  it('is true when liquidity fell ≥90% within 24h', () => {
    expect(diedFast([t(10, 'buy', 1000n), t(100, 'sell', 950n)], opts)).toBe(true);
  });
  it('is false when liquidity held up', () => {
    expect(diedFast([t(10, 'buy', 1000n), t(100, 'sell', 300n)], opts)).toBe(false);
  });
  it('ignores tokens that never gained traction', () => {
    expect(diedFast([t(10, 'buy', 100n), t(100, 'sell', 100n)], opts)).toBe(false);
  });
  it('ignores drops after the window', () => {
    expect(diedFast([t(10, 'buy', 1000n), t(90_000, 'sell', 1000n)], opts)).toBe(false);
  });
  it('is undecided while still inside the window', () => {
    expect(diedFast([t(10, 'buy', 1000n)], { ...opts, now: 1000 })).toBeNull();
  });
  it('graduated tokens did not die on the curve', () => {
    expect(diedFast([t(10, 'buy', 1000n), t(100, 'sell', 1000n)], { ...opts, graduated: true })).toBe(false);
  });
});

describe('classifyLabels', () => {
  it('recognises bridges before exchanges', () => {
    expect(classifyLabels(['Robinhood Chain: Bridge'], true)).toBe('bridge');
  });
  it('recognises exchanges', () => {
    expect(classifyLabels(['Binance 14'], false)).toBe('exchange');
  });
  it('falls back to wallet / contract', () => {
    expect(classifyLabels([], false)).toBe('wallet');
    expect(classifyLabels(['SomeVault'], true)).toBe('contract');
  });
});

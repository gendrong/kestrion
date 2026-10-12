/** Pure analysis helpers for Pons (no network). Unit-tested in test/analysis.test.ts. */
import { decodeFunctionData, type Address, type Hex } from 'viem';
import { ponsV2FactoryAbi, ponsV2RouterAbi } from '../../chain/abis';
import { PONS_V2 } from '../../chain/config';
import type { Trade } from '../../types';
import { sameAddr, uniqAddrs } from '../../util/format';

/**
 * Wallets that bought inside the snipe-tax window without paying the snipe tax.
 *
 * Measured in Phase 1b: during the window a non-exempt buy pays `feeBps` + snipe tax, and the snipe tax
 * is included in the CurveBuy `fee` field (e.g. 1% base + 6.18% snipe = 7.18% one second after launch).
 * An exempt wallet pays exactly the base fee. The tax is computed per second of block time.
 */
export function detectExemptBuys(trades: Trade[], launchTime: number, windowSeconds: number, feeBps: number): Address[] {
  const found: Address[] = [];
  for (const t of trades) {
    if (t.side !== 'buy' || t.time === undefined || t.feeAmount === undefined || t.quoteAmount === 0n) continue;
    const elapsed = t.time - launchTime;
    if (elapsed < 0 || elapsed >= windowSeconds) continue;
    const paidBps = Number((t.feeAmount * 1_000_000n) / t.quoteAmount) / 100;
    if (paidBps - feeBps < 0.5) found.push(t.wallet);
  }
  return uniqAddrs(found);
}

/**
 * The full exemption list, decoded from the launch transaction when it was sent straight to the
 * V2 factory or the official Launch-and-Buy router. null = launched through another contract.
 */
export function decodeDeclaredExemptions(input: Hex, to: Address | null): Address[] | null {
  if (!to) return null;
  try {
    if (sameAddr(to, PONS_V2.factory)) {
      const d = decodeFunctionData({ abi: ponsV2FactoryAbi, data: input });
      if (d.functionName !== 'launchToken') return null;
      const args = d.args as readonly unknown[];
      return args.length >= 4 ? [...(args[3] as readonly Address[])] : [];
    }
    if (sameAddr(to, PONS_V2.launchAndBuyRouter)) {
      const d = decodeFunctionData({ abi: ponsV2RouterAbi, data: input });
      return [...(d.args[6] as readonly Address[])];
    }
  } catch {
    return null;
  }
  return null;
}

export interface CurveTradeLite {
  time: number;
  side: 'buy' | 'sell';
  quoteAmount: bigint;
}

/**
 * "Died fast" (config: creatorHistory.diedFast): net quote raised in the curve peaked and then fell by
 * ≥ dropPct within windowHours of launch. Uses net buys − sells as a liquidity proxy.
 * Returns null when it can't be decided yet (still inside the window and not dead).
 */
export function diedFast(
  trades: CurveTradeLite[],
  opts: {
    launchTime: number;
    threshold: bigint;
    graduated: boolean;
    now: number;
    windowHours: number;
    dropPct: number;
    minPeakPctOfThreshold: number;
  },
): boolean | null {
  if (opts.graduated) return false;
  const end = opts.launchTime + opts.windowHours * 3600;
  const sorted = trades.filter((t) => t.time <= end).sort((a, b) => a.time - b.time);
  let net = 0n;
  let peak = 0n;
  for (const t of sorted) {
    net += t.side === 'buy' ? t.quoteAmount : -t.quoteAmount;
    if (net > peak) peak = net;
  }
  const minPeak = (opts.threshold * BigInt(Math.round(opts.minPeakPctOfThreshold * 100))) / 10_000n;
  if (peak === 0n || peak < minPeak) return false; // never gained traction: not counted as "died"
  const floor = (peak * BigInt(100 - opts.dropPct)) / 100n;
  if (net <= floor) return true;
  return opts.now < end ? null : false;
}

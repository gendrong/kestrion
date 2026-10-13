/**
 * ALL scoring weights and thresholds live here. Change a number → bump ENGINE_VERSION (src/version.ts)
 * so stored scans stay traceable to the rules that produced them.
 *
 * Score = 100 − sum of deductions, clamped to 0–100.
 * A check's deduction depends only on its status (pass = 0).
 */
import type { CheckId, CheckStatus } from '../types';

export interface EngineConfig {
  /** "First N blocks" after launch used for early-buy analysis (~0.1 s per block → 300 ≈ 30 s). */
  earlyWindowBlocks: number;
  /** Max early buyers whose funding we trace (each costs a few explorer calls). */
  maxLinkedCandidates: number;
  /** Max prior launches of the creator analysed in detail (the rest are only counted). */
  maxPriorLaunchesAnalyzed: number;
  /** Max creator/linked wallets whose token flows we fetch for sell pressure. */
  maxFlowWallets: number;
  checks: {
    exemptions: {
      /** Exempt wallets (besides the protocol's automatic ones) that trigger WARN. */
      warnAtCount: number;
      /** …and FAIL. */
      failAtCount: number;
      /** FAIL if exempt wallets bought at least this % of supply in the early window. */
      failAtSupplyPct: number;
      /** FAIL if any exempt wallet was funded by / shares funding with the creator (≤ 2 hops). */
      failIfLinkedToCreator: boolean;
    };
    clusterBuy: {
      /** % of total supply bought in the early window by the creator + linked wallets. */
      warnAtPct: number;
      failAtPct: number;
    };
    holders: {
      topN: number;
      /** % of total supply held by the top N (excluding pool, curve, lockers, burn). */
      warnAtPct: number;
      failAtPct: number;
    };
    creatorHistory: {
      /** "Died fast": raised liquidity fell by ≥ dropPct within windowHours of launch… */
      diedFast: { windowHours: number; dropPct: number; minPeakPctOfThreshold: number };
      /** …only counted when the peak reached at least minPeakPctOfThreshold % of the graduation threshold. */
      warnAtPriorLaunches: number;
      /** Serial launcher: this many earlier launches is a FAIL on its own. */
      failAtPriorLaunches: number;
      /** FAIL when at least this many prior launches died fast… */
      failAtDiedFast: number;
      /** …and they are at least this share of the analysed prior launches. */
      failAtDiedFastRatio: number;
    };
    creatorWallet: {
      /** Wallet younger than this (days) counts as fresh. */
      freshDays: number;
    };
    sellPressure: {
      /** % of tokens received that creator + linked wallets have sent out (sold/moved). */
      warnAtPct: number;
      failAtPct: number;
    };
  };
  /** Points deducted per status. Informational checks (curve state, pair type) deduct 0. */
  weights: Record<CheckId, Record<Exclude<CheckStatus, 'pass'>, number>>;
  /** Score bands: ≥ low → Low risk, ≥ caution → Caution, else High risk. */
  labels: { low: number; caution: number };
}

export const ENGINE_CONFIG: EngineConfig = {
  earlyWindowBlocks: 300,
  maxLinkedCandidates: 20,
  maxPriorLaunchesAnalyzed: 5,
  maxFlowWallets: 15,
  checks: {
    exemptions: { warnAtCount: 1, failAtCount: 10, failAtSupplyPct: 5, failIfLinkedToCreator: true },
    clusterBuy: { warnAtPct: 5, failAtPct: 15 },
    holders: { topN: 10, warnAtPct: 25, failAtPct: 40 },
    creatorHistory: {
      diedFast: { windowHours: 24, dropPct: 90, minPeakPctOfThreshold: 5 },
      warnAtPriorLaunches: 3,
      failAtPriorLaunches: 10,
      failAtDiedFast: 2,
      failAtDiedFastRatio: 0.5,
    },
    creatorWallet: { freshDays: 2 },
    sellPressure: { warnAtPct: 50, failAtPct: 80 },
  },
  weights: {
    exemptions: { warn: 10, fail: 25, unknown: 4 },
    clusterBuy: { warn: 10, fail: 20, unknown: 4 },
    holders: { warn: 8, fail: 15, unknown: 4 },
    creatorHistory: { warn: 8, fail: 20, unknown: 3 },
    creatorWallet: { warn: 5, fail: 10, unknown: 3 },
    curveState: { warn: 5, fail: 10, unknown: 2 },
    pairType: { warn: 0, fail: 0, unknown: 0 },
    sellPressure: { warn: 10, fail: 20, unknown: 3 },
  },
  labels: { low: 70, caution: 40 },
};

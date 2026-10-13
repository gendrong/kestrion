/**
 * Common interface every launchpad adapter implements. The scan core only talks to this interface,
 * so new launchpads (Phase 8) plug in without touching the core.
 */
import type { Address, Hash } from 'viem';
import type { CurveState, ExemptionData, FactoryId, LaunchInfo, PriorLaunch, Trade } from '../types';
import type { EngineConfig } from '../scoring/config';
import type { TokenMetadata } from '../util/media';

export interface FactoryInfo {
  id: FactoryId;
  address: Address;
  /** First block to scan for launches. */
  startBlock: bigint;
  /** Last block that can contain launches (the factory stopped launching), if any. */
  endBlock?: bigint;
  version: 'v1' | 'v2';
}

/** A launch found while scanning a block range (used by the ingest job). */
export interface DiscoveredLaunch {
  factoryId: FactoryId;
  token: Address;
  deployer: Address;
  blockNumber: bigint;
  txHash: `0x${string}`;
  /** V2 curve / V1 pool. */
  curveOrPool?: Address;
  pairToken?: Address;
  /** V2 only. */
  graduationThreshold?: bigint;
}

export interface PriorLaunchRef {
  factoryId: FactoryId;
  token: Address;
  launchBlock: bigint;
  launchTime?: number;
  /** V2 curve. */
  curve?: Address;
  graduationThreshold?: bigint;
}

/** Our own index of every launch (kept by the jobs): creator history without explorer searches. */
export interface LaunchIndex {
  /** Launches whose deployer is one of `deployers`. `complete` = the index covers every block of every factory. */
  byDeployers(deployers: Address[]): Promise<{ refs: PriorLaunchRef[]; complete: boolean }>;
}

/** Known facts that save lookups (the ingest job knows the launch tx from the factory event). */
export interface LaunchHint {
  txHash?: Hash;
}

export interface LaunchpadAdapter {
  readonly id: string;
  readonly factories: FactoryInfo[];
  /** Read launch config: which factory launched `token`, by whom, with what settings. null = not ours. */
  findLaunch(token: Address, hint?: LaunchHint): Promise<LaunchInfo | null>;
  /** Discover launches of one factory in a block range. */
  discoverLaunches(factoryId: FactoryId, fromBlock: bigint, toBlock: bigint): Promise<DiscoveredLaunch[]>;
  /** Curve state, including graduation. */
  readCurveState(launch: LaunchInfo): Promise<CurveState>;
  /** Trades in the first `blocks` blocks after launch (with timestamps when available). */
  getEarlyTrades(launch: LaunchInfo, blocks: number): Promise<Trade[]>;
  /** Snipe-tax exemptions, or 'not_applicable' when the launchpad has no such feature. */
  getExemptions(launch: LaunchInfo, earlyTrades: Trade[], latestBlock: bigint): Promise<ExemptionData | 'not_applicable'>;
  /** Addresses that are not real holders (pool, curve, lockers, burn). */
  holderExclusions(launch: LaunchInfo): Address[];
  /** Other launches by these creator wallets. `partial` = the search could not cover everything. */
  findLaunchesByCreator(creators: Address[]): Promise<{ refs: PriorLaunchRef[]; partial: boolean }>;
  /** Name, outcome and (with `outcome`, explorer calls) "died fast" for one prior launch. */
  describePriorLaunch(ref: PriorLaunchRef, cfg: EngineConfig, now: number, opts?: { outcome?: boolean }): Promise<PriorLaunch>;
  /** Logo / description / socials, already cleaned (never trust raw token metadata). */
  readTokenMetadata(launch: LaunchInfo): Promise<TokenMetadata>;
}

/**
 * Common interface every launchpad adapter implements. The scan core only talks to this interface,
 * so new launchpads (Phase 8) plug in without touching the core.
 */
import type { Address } from 'viem';
import type { CurveState, ExemptionData, FactoryId, LaunchInfo, PriorLaunch, Trade } from '../types';
import type { EngineConfig } from '../scoring/config';
import type { TokenMetadata } from '../util/media';

export interface FactoryInfo {
  id: FactoryId;
  address: Address;
  /** First block to scan for launches. */
  startBlock: bigint;
  version: 'v1' | 'v2';
}

/** A launch found while scanning a block range (used by the ingest job). */
export interface DiscoveredLaunch {
  factoryId: FactoryId;
  token: Address;
  deployer: Address;
  blockNumber: bigint;
  txHash: `0x${string}`;
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

export interface LaunchpadAdapter {
  readonly id: string;
  readonly factories: FactoryInfo[];
  /** Read launch config: which factory launched `token`, by whom, with what settings. null = not ours. */
  findLaunch(token: Address): Promise<LaunchInfo | null>;
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
  /** Name, outcome and "died fast" for one prior launch. */
  describePriorLaunch(ref: PriorLaunchRef, cfg: EngineConfig, now: number): Promise<PriorLaunch>;
  /** Logo / description / socials, already cleaned (never trust raw token metadata). */
  readTokenMetadata(launch: LaunchInfo): Promise<TokenMetadata>;
}

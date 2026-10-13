import type { Address, Hash } from 'viem';

export type FactoryId = 'pons-v2' | 'pons-v1-active' | 'pons-v1-legacy';
export type PairType = 'ETH' | 'USDG' | 'Other';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type CheckId =
  | 'exemptions'
  | 'clusterBuy'
  | 'holders'
  | 'creatorHistory'
  | 'creatorWallet'
  | 'curveState'
  | 'pairType'
  | 'sellPressure';
export type RiskLabel = 'Low risk' | 'Caution' | 'High risk';

/** A value that may have failed to load. Checks turn `ok: false` into status `unknown`. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: string): Result<T> => ({ ok: false, error });

/** Everything we know about how and by whom a token was launched. */
export interface LaunchInfo {
  launchpad: 'pons';
  factoryId: FactoryId;
  factoryAddress: Address;
  version: 'v1' | 'v2';
  token: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  /** As emitted by the factory; can be a third-party launcher contract. */
  deployer: Address;
  deployerIsContract: boolean;
  /** EOA that sent the launch transaction. */
  launchTxFrom: Address;
  launchTxTo: Address | null;
  /** V2 only. */
  creatorFeeRecipient?: Address;
  /** Best guess of the real creator (an EOA). */
  creator: Address;
  pairToken: Address;
  pairType: PairType;
  pairSymbol: string;
  pairDecimals: number;
  /** V2 bonding curve. */
  curve?: Address;
  /** V1 Uniswap v3 pool. */
  pool?: Address;
  launchBlock: bigint;
  /** Unix seconds. */
  launchTime: number;
  launchTx: Hash;
  launchConfigId: bigint;
  graduationThreshold: bigint;
  /** V2 curve base fee (100 = 1%). */
  feeBps?: number;
  /** V2 creator tax on trades. */
  creatorTaxBps?: number;
  /** V1: an Ethereum L1 block number (Arbitrum `block.number`). */
  restrictionsEndL1Block?: bigint;
  /** V1: creator's initial buy in the launch tx. */
  initialBuyAmount?: bigint;
  /** V1: is the launched token token0 in the pool. */
  isToken0?: boolean;
}

export interface CurveState {
  raised: bigint;
  threshold: bigint;
  progressPct: number;
  graduated: boolean;
  phase: string;
}

export interface Trade {
  block: bigint;
  tx: Hash;
  logIndex: number;
  side: 'buy' | 'sell';
  /** Buyer (recipient of tokens) or seller. */
  wallet: Address;
  tokenAmount: bigint;
  quoteAmount: bigint;
  /** V2: base fee + snipe tax, in quote units. */
  feeAmount?: bigint;
  /** Unix seconds, when known. */
  time?: number;
}

export interface ExemptionData {
  /** Snipe-tax window in seconds (current factory setting). */
  windowSeconds: number;
  /** Full list decoded from the launch transaction, or null when it can't be decoded. */
  declared: Address[] | null;
  /** Wallets proven exempt by on-chain evidence. */
  detected: { address: Address; via: string }[];
  /** Exempt automatically by the protocol (launcher, fee recipient). */
  autoExempt: Address[];
  /** True when `declared` is the complete list. */
  complete: boolean;
}

export interface Holder {
  address: Address;
  balance: bigint;
  isContract: boolean;
  name?: string;
}

export type FunderKind = 'exchange' | 'bridge' | 'launch_proceeds' | 'contract' | 'wallet' | 'none' | 'unknown';

export interface WalletProfile {
  address: Address;
  /** Unix seconds of the first transaction seen. */
  firstSeen?: number;
  ageDays?: number;
  funder?: Address;
  funderKind: FunderKind;
  funderLabel?: string;
  fundedAt?: number;
}

export interface CreatorProfile extends WalletProfile {
  /** Profile of the wallet that funded the creator (2nd hop). */
  funderProfile?: WalletProfile;
}

export interface LinkedWallet {
  address: Address;
  reasons: string[];
}

export interface PriorLaunch {
  token: Address;
  factoryId: FactoryId;
  name: string;
  symbol: string;
  launchBlock: bigint;
  launchTime?: number;
  graduated: boolean | null;
  /** null = outcome unknown (too young, too much data, or V1). */
  diedFast: boolean | null;
}

/** Another launch by the same creator: every one found, not only the ones analysed in detail. */
export interface CreatorLaunchRef {
  token: Address;
  factoryId: FactoryId;
  launchBlock: bigint;
  /** Unix seconds, when known. */
  launchTime?: number;
}

/** What one scan learned about the creator (stored in the `creators` table by the jobs). */
export interface CreatorSnapshot {
  address: Address;
  /** ISO time of the wallet's first transaction, or null when unknown. */
  firstSeen: string | null;
  fundingSource: FunderKind | null;
  funder: Address | null;
  funderLabel: string | null;
  /** All Pons launches found for this creator, including the scanned token, newest first. null = search failed. */
  launches: CreatorLaunch[] | null;
  /** True when the launch search could not cover everything (e.g. launches through other contracts). */
  searchPartial: boolean;
  /** Wallets linked to the creator in this launch (funding links, exemptions, other identities). null = not traced. */
  linkedWallets: LinkedWallet[] | null;
}

export interface CreatorLaunch {
  token: Address;
  factoryId: FactoryId;
  launchBlock: string;
  launchTime: string | null;
  /** Only for the launches analysed in detail (and the scanned token). */
  name?: string;
  symbol?: string;
  graduated?: boolean | null;
  /** null = outcome unknown. */
  diedFast?: boolean | null;
}

export interface WalletFlow {
  address: Address;
  received: bigint;
  /** Sent out to anyone except lockers, burn addresses and the creator's own wallets. */
  sent: bigint;
  /** Sent to token lockers or burn addresses (not counted as selling). */
  lockedOrBurned: bigint;
}

/** All data collected for one scan. Pure check functions read only this. */
export interface ScanData {
  launch: LaunchInfo;
  /** Unix seconds at scan time. */
  now: number;
  latestBlock: bigint;
  earlyWindowBlocks: number;
  curve: Result<CurveState>;
  earlyTrades: Result<Trade[]>;
  exemptions: Result<ExemptionData> | 'not_applicable';
  holders: Result<Holder[]>;
  /** Addresses excluded from holder concentration (pool, curve, lockers, burn…). */
  excluded: Address[];
  creatorWallet: Result<CreatorProfile>;
  /** Creator identities + wallets linked to them, with reasons. */
  linked: Result<LinkedWallet[]>;
  /** `launches` = the most recent ones analysed in detail; `total` = all found; `partial` = search incomplete. */
  priorLaunches: Result<{ launches: PriorLaunch[]; total: number; partial: boolean; all?: CreatorLaunchRef[] }>;
  flows: Result<WalletFlow[]>;
}

export interface CheckResult {
  id: CheckId;
  title: string;
  status: CheckStatus;
  /** Raw numbers behind the result (JSON-safe). */
  value: Record<string, unknown>;
  explanation: string;
}

export interface ScoredCheck extends CheckResult {
  deduction: number;
}

export interface ScanReport {
  engineVersion: string;
  scannedAt: string;
  token: { address: Address; name: string; symbol: string; decimals: number; totalSupply: string };
  launchpad: { id: 'pons'; factoryId: FactoryId; version: 'v1' | 'v2'; factory: Address };
  launch: { block: string; time: string; tx: Hash };
  creator: { address: Address; deployer: Address; deployerIsContract: boolean; feeRecipient?: Address };
  pair: { type: PairType; symbol: string; address: Address };
  curve: { progressPct: number; raised: string; threshold: string; graduated: boolean; phase: string } | null;
  score: number;
  label: RiskLabel;
  checks: ScoredCheck[];
  topHolders: { address: Address; pct: number; label?: string }[];
  summary: string;
  notes: string[];
  disclaimer: string;
}

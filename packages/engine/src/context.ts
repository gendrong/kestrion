/** Wires the RPC client and the explorer client from environment variables. */
import type { PublicClient } from 'viem';
import { BLOCKSCOUT, RPC } from './chain/config';
import { createFailoverRpc, type FailoverRpc, type RpcEndpoint } from './chain/rpc';
import { CreditBudget } from './explorer/budget';
import { Blockscout } from './explorer/blockscout';
import type { FunderKind, WalletProfile } from './types';
import { RateLimiter } from './util/limiter';

export interface EngineEnv {
  /** Primary RPC (default: public Robinhood Chain RPC). */
  RPC_URL?: string;
  /** Fallback RPC (default: Blockscout JSON-RPC built from BLOCKSCOUT_API_KEY). */
  FALLBACK_RPC_URL?: string;
  /** Free key from https://dev.blockscout.com. Without it, explorer-based checks return `unknown`. */
  BLOCKSCOUT_API_KEY?: string;
}

/** Caches shared by all scans of one job run (exchanges fund many creators; creators launch many tokens). */
export interface SharedCaches {
  profiles: Map<string, Promise<WalletProfile>>;
  funders: Map<string, Promise<{ kind: FunderKind; label?: string }>>;
}
export const newSharedCaches = (): SharedCaches => ({ profiles: new Map(), funders: new Map() });

export interface EngineContext {
  rpc: PublicClient;
  explorer: Blockscout | null;
  /** Explorer credits (shared across a job run). */
  budget: CreditBudget;
  shared: SharedCaches;
  /** Progress messages (the CLI prints them to stderr). */
  log: (message: string) => void;
  /** Data-quality notes shown at the bottom of the report. */
  notes: string[];
  rpcStatus: FailoverRpc['status'];
}

export function createEngineContext(
  env: EngineEnv,
  log: (message: string) => void = () => {},
  opts: {
    /** Share one limiter between contexts that run at the same time (e.g. parallel scans in a job). */
    blockscoutLimiter?: RateLimiter;
    /** Share the explorer credit budget the same way. */
    budget?: CreditBudget;
    /** Rate limit for the primary (public) RPC, shared by parallel scans. */
    rpcLimiter?: RateLimiter;
    shared?: SharedCaches;
  } = {},
): EngineContext {
  const key = env.BLOCKSCOUT_API_KEY?.trim() || undefined;
  // One limiter for everything that hits Blockscout (REST + JSON-RPC share the 5 req/s budget).
  const blockscoutLimiter = opts.blockscoutLimiter ?? new RateLimiter(BLOCKSCOUT.requestsPerSecond);

  const endpoints: RpcEndpoint[] = [{ name: 'public RPC', url: env.RPC_URL?.trim() || RPC.publicUrl, limiter: opts.rpcLimiter }];
  const fallbackUrl = env.FALLBACK_RPC_URL?.trim() || (key ? RPC.blockscoutUrl(key) : undefined);
  if (fallbackUrl) {
    endpoints.push({
      name: 'fallback RPC',
      url: fallbackUrl,
      limiter: fallbackUrl.includes('blockscout.com') ? blockscoutLimiter : undefined,
    });
  }
  const failover = createFailoverRpc(endpoints);
  const notes: string[] = [];
  if (!key) notes.push('BLOCKSCOUT_API_KEY not set: wallet history, holders and creator history are unavailable.');

  const budget = opts.budget ?? new CreditBudget();
  return {
    rpc: failover.client,
    explorer: key ? new Blockscout(key, blockscoutLimiter, undefined, budget) : null,
    budget,
    shared: opts.shared ?? newSharedCaches(),
    log,
    notes,
    rpcStatus: failover.status,
  };
}

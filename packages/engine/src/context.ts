/** Wires the RPC client and the explorer client from environment variables. */
import type { PublicClient } from 'viem';
import { BLOCKSCOUT, RPC } from './chain/config';
import { createFailoverRpc, type FailoverRpc, type RpcEndpoint } from './chain/rpc';
import { Blockscout } from './explorer/blockscout';
import { RateLimiter } from './util/limiter';

export interface EngineEnv {
  /** Primary RPC (default: public Robinhood Chain RPC). */
  RPC_URL?: string;
  /** Fallback RPC (default: Blockscout JSON-RPC built from BLOCKSCOUT_API_KEY). */
  FALLBACK_RPC_URL?: string;
  /** Free key from https://dev.blockscout.com. Without it, explorer-based checks return `unknown`. */
  BLOCKSCOUT_API_KEY?: string;
}

export interface EngineContext {
  rpc: PublicClient;
  explorer: Blockscout | null;
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
  } = {},
): EngineContext {
  const key = env.BLOCKSCOUT_API_KEY?.trim() || undefined;
  // One limiter for everything that hits Blockscout (REST + JSON-RPC share the 5 req/s budget).
  const blockscoutLimiter = opts.blockscoutLimiter ?? new RateLimiter(BLOCKSCOUT.requestsPerSecond);

  const endpoints: RpcEndpoint[] = [{ name: 'public RPC', url: env.RPC_URL?.trim() || RPC.publicUrl }];
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

  return {
    rpc: failover.client,
    explorer: key ? new Blockscout(key, blockscoutLimiter) : null,
    log,
    notes,
    rpcStatus: failover.status,
  };
}

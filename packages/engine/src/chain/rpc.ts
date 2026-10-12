/**
 * RPC client with automatic failover.
 *
 * Why: the public RPC is blocked by some ISPs and keeps only ~10 min of state, so every request
 * tries the public RPC first and switches to the Blockscout JSON-RPC when it fails.
 * A network/TLS failure parks an endpoint for 60 s so we don't keep retrying a dead one.
 */
import { createPublicClient, custom, defineChain, type PublicClient } from 'viem';
import { CHAIN_ID, RPC } from './config';
import { RateLimiter, sleep } from '../util/limiter';

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC.publicUrl] } },
  blockExplorers: { default: { name: 'RobinScan', url: 'https://robin.etherscan.io' } },
});

/** HTTP-level failure (network, TLS, timeout, 5xx, 429). */
export class RpcHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RpcHttpError';
  }
}

/** JSON-RPC error returned by a node (e.g. revert, missing state). */
export class RpcResponseError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcResponseError';
  }
}

export interface RpcEndpoint {
  name: string;
  url: string;
  limiter?: RateLimiter;
}

interface EndpointState extends RpcEndpoint {
  downUntil: number;
  failures: number;
  successes: number;
}

const causeCode = (e: unknown): string => {
  const c = (e as { cause?: { code?: string; message?: string } })?.cause;
  return c?.code ?? c?.message ?? (e as Error)?.message ?? 'unknown';
};

async function postJsonRpc(ep: RpcEndpoint, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
  await ep.limiter?.wait();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new RpcHttpError(`${ep.name}: network error (${causeCode(e)})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new RpcHttpError(`${ep.name}: HTTP ${res.status}`, res.status);
  let body: { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new RpcHttpError(`${ep.name}: invalid JSON response`);
  }
  if (body.error) throw new RpcResponseError(body.error.code, `${ep.name}: ${body.error.message}`, body.error.data);
  return body.result;
}

/** A revert is a real answer from the contract: never retry it on another endpoint. */
const isDeterministic = (e: RpcResponseError) => e.code === 3 || /revert/i.test(e.message);

export interface FailoverRpc {
  client: PublicClient;
  /** Which endpoints answered / failed, for the report's data notes. */
  status(): { name: string; successes: number; failures: number }[];
}

export function createFailoverRpc(endpoints: RpcEndpoint[], opts: { timeoutMs?: number } = {}): FailoverRpc {
  if (endpoints.length === 0) throw new Error('No RPC endpoints configured');
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const states: EndpointState[] = endpoints.map((e) => ({ ...e, downUntil: 0, failures: 0, successes: 0 }));

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const now = Date.now();
    // Healthy endpoints first (in configured order), parked ones last.
    const order = [...states].sort((a, b) => Number(a.downUntil > now) - Number(b.downUntil > now));
    let lastError: unknown;
    for (const ep of order) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await postJsonRpc(ep, method, params ?? [], timeoutMs);
          ep.successes++;
          return result;
        } catch (e) {
          lastError = e;
          if (e instanceof RpcResponseError) {
            if (isDeterministic(e)) throw e;
            ep.failures++;
            break; // e.g. missing historical state → try the next endpoint
          }
          if (e instanceof RpcHttpError) {
            ep.failures++;
            if (e.status === 429 || (e.status !== undefined && e.status >= 500)) {
              await sleep(600 * 2 ** attempt);
              continue;
            }
            ep.downUntil = Date.now() + 60_000;
            break;
          }
          throw e;
        }
      }
    }
    throw lastError ?? new RpcHttpError('All RPC endpoints failed');
  }

  const client = createPublicClient({
    chain: robinhoodChain,
    transport: custom({ request } as Parameters<typeof custom>[0], { retryCount: 0 }),
  }) as PublicClient;

  return {
    client,
    status: () => states.map((s) => ({ name: s.name, successes: s.successes, failures: s.failures })),
  };
}

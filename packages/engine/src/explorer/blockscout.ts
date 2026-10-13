/**
 * Blockscout PRO API client (free tier). Gives what the RPC can't: wallet history (age, funding source),
 * token holders, token transfers per wallet, contract creation tx, and wide-range filtered logs.
 * Source: https://docs.blockscout.com/robinhood-api.md
 */
import type { Address, Hash, Hex } from 'viem';
import { BLOCKSCOUT } from '../chain/config';
import type { RawLog } from '../chain/logs';
import { RateLimiter, sleep } from '../util/limiter';
import { CreditBudget } from './budget';

export interface AddressInfo {
  isContract: boolean;
  name?: string;
  /** Public labels (name, tags) used to recognise exchanges and bridges. */
  labels: string[];
  creationTxHash?: Hash;
}

/** Etherscan-style transaction row (normal or internal). */
export interface ExplorerTx {
  hash: Hash;
  from: Address;
  to: Address | '';
  value: bigint;
  timeStamp: number;
  isError: boolean;
}

export interface ExplorerTokenTransfer {
  from: Address;
  to: Address;
  value: bigint;
  timeStamp: number;
  hash: Hash;
}

/** Thrown without calling the API when the day's credits are used up. */
export const OUT_OF_CREDITS = 'explorer API daily credits used up (they reset at 00:00 UTC)';

export class ExplorerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExplorerError';
  }
}

type Json = Record<string, unknown>;

export class Blockscout {
  private cache = new Map<string, Promise<unknown>>();
  calls = 0;

  constructor(
    private readonly apiKey: string,
    readonly limiter: RateLimiter = new RateLimiter(BLOCKSCOUT.requestsPerSecond),
    private readonly base: string = BLOCKSCOUT.base,
    /** Shared daily credit budget (see budget.ts). */
    readonly budget: CreditBudget = new CreditBudget(),
  ) {}

  /** GET with rate limiting, retries on 429/5xx/non-JSON, and per-URL caching. */
  private getJson(url: string): Promise<unknown> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const p = (async () => {
      let lastError = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!this.budget.canCall()) throw new ExplorerError(OUT_OF_CREDITS);
        await this.limiter.wait();
        this.calls++;
        let res: Response;
        try {
          res = await fetch(url, { headers: { accept: 'application/json' } });
        } catch (e) {
          lastError = `network error (${(e as Error).message})`;
          await sleep(700 * 2 ** attempt);
          continue;
        }
        this.budget.observe(res.status, res.headers.get('x-credits-remaining'));
        if (res.status === 402) throw new ExplorerError(OUT_OF_CREDITS);
        if (res.status === 404) return null;
        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          await sleep(900 * 2 ** attempt);
          continue;
        }
        const text = await res.text();
        if (!res.ok) throw new ExplorerError(`Blockscout HTTP ${res.status}: ${text.slice(0, 120)}`);
        try {
          return JSON.parse(text) as unknown;
        } catch {
          lastError = 'non-JSON response';
          await sleep(900 * 2 ** attempt);
        }
      }
      throw new ExplorerError(`Blockscout request failed: ${lastError}`);
    })();
    this.cache.set(url, p);
    p.catch(() => this.cache.delete(url));
    return p;
  }

  private rest(path: string): Promise<Json | null> {
    const sep = path.includes('?') ? '&' : '?';
    return this.getJson(`${this.base}/api/v2${path}${sep}apikey=${this.apiKey}`) as Promise<Json | null>;
  }

  /** Etherscan-compatible module API. Returns [] for "no records". */
  private async legacy(params: Record<string, string | number>): Promise<Json[]> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const body = (await this.getJson(`${this.base}/api?${qs}&apikey=${this.apiKey}`)) as Json | null;
    if (!body) return [];
    if (Array.isArray(body.result)) return body.result as Json[];
    const msg = String(body.message ?? '');
    if (/no (transactions|records|token transfers)/i.test(msg)) return [];
    throw new ExplorerError(`Blockscout ${params.module}/${params.action}: ${msg} ${String(body.result ?? '')}`);
  }

  async addressInfo(address: Address): Promise<AddressInfo> {
    const j = await this.rest(`/addresses/${address}`);
    if (!j) return { isContract: false, labels: [] };
    const labels: string[] = [];
    if (typeof j.name === 'string' && j.name) labels.push(j.name);
    for (const t of (j.public_tags as Json[] | undefined) ?? []) {
      const label = t.display_name ?? t.label ?? t.name;
      if (typeof label === 'string') labels.push(label);
    }
    const meta = j.metadata as { tags?: Json[] } | null | undefined;
    for (const t of meta?.tags ?? []) if (typeof t.name === 'string') labels.push(t.name);
    return {
      isContract: Boolean(j.is_contract),
      name: typeof j.name === 'string' ? j.name : undefined,
      labels,
      creationTxHash: (j.creation_transaction_hash ?? j.creation_tx_hash) as Hash | undefined,
    };
  }

  /** Oldest normal transactions of an address (incoming and outgoing). */
  async firstTransactions(address: Address, count = 25): Promise<ExplorerTx[]> {
    const rows = await this.legacy({ module: 'account', action: 'txlist', address, sort: 'asc', page: 1, offset: count });
    return rows.map(toTx);
  }

  /** Oldest internal transactions (ETH sent to the address by contracts). */
  async firstInternalTransactions(address: Address, count = 25): Promise<ExplorerTx[]> {
    const rows = await this.legacy({ module: 'account', action: 'txlistinternal', address, sort: 'asc', page: 1, offset: count });
    return rows.map(toTx);
  }

  /** ERC-20 transfers of one token to/from one address. */
  async tokenTransfers(address: Address, token: Address): Promise<{ transfers: ExplorerTokenTransfer[]; capped: boolean }> {
    const rows = await this.legacy({
      module: 'account',
      action: 'tokentx',
      address,
      contractaddress: token,
      sort: 'asc',
      page: 1,
      offset: BLOCKSCOUT.maxRecords,
    });
    return {
      transfers: rows.map((r) => ({
        from: r.from as Address,
        to: r.to as Address,
        value: BigInt(String(r.value)),
        timeStamp: Number(r.timeStamp),
        hash: r.hash as Hash,
      })),
      capped: rows.length >= BLOCKSCOUT.maxRecords,
    };
  }

  /** Top holders of a token (first page, ~50). */
  async tokenHolders(token: Address): Promise<{ address: Address; balance: bigint; isContract: boolean; name?: string }[]> {
    const j = await this.rest(`/tokens/${token}/holders`);
    const items = (j?.items as Json[] | undefined) ?? [];
    return items.map((it) => {
      const a = it.address as Json;
      return {
        address: a.hash as Address,
        balance: BigInt(String(it.value)),
        isContract: Boolean(a.is_contract),
        name: typeof a.name === 'string' ? a.name : undefined,
      };
    });
  }

  /**
   * Filtered logs over wide ranges (≤ 10M blocks per call, ≤ 1000 results). Includes timestamps.
   * `topics` keys are topic positions 0–3.
   */
  async logs(params: {
    address: Address;
    fromBlock: bigint;
    toBlock: bigint | 'latest';
    topics: Partial<Record<0 | 1 | 2 | 3, Hex>>;
  }): Promise<{ logs: RawLog[]; capped: boolean }> {
    const q: Record<string, string | number> = {
      module: 'logs',
      action: 'getLogs',
      address: params.address,
      fromBlock: params.fromBlock.toString(),
      toBlock: params.toBlock.toString(),
    };
    const positions = Object.keys(params.topics).map(Number).sort();
    for (const i of positions) q[`topic${i}`] = params.topics[i as 0 | 1 | 2 | 3] as string;
    for (let a = 0; a < positions.length; a++)
      for (let b = a + 1; b < positions.length; b++) q[`topic${positions[a]}_${positions[b]}_opr`] = 'and';
    const rows = await this.legacy(q);
    const logs = rows.map((r) => ({
      address: r.address as Address,
      topics: ((r.topics as (string | null)[]) ?? []).filter((t): t is string => !!t) as Hex[],
      data: (r.data as Hex) ?? '0x',
      blockNumber: BigInt(String(r.blockNumber)),
      transactionHash: r.transactionHash as Hash,
      logIndex: r.logIndex === '0x' || r.logIndex === '' ? 0 : Number(BigInt(String(r.logIndex))),
      timeStamp: Number(BigInt(String(r.timeStamp))),
    }));
    return { logs, capped: rows.length >= BLOCKSCOUT.maxRecords };
  }
}

function toTx(r: Json): ExplorerTx {
  return {
    hash: (r.hash ?? r.transactionHash) as Hash,
    from: r.from as Address,
    to: (r.to as Address) ?? '',
    value: BigInt(String(r.value ?? '0')),
    timeStamp: Number(r.timeStamp),
    isError: String(r.isError ?? '0') === '1',
  };
}

/** eth_getLogs over any block range, split into chunks the RPC accepts (halving on errors). */
import { toHex, type Address, type Hash, type Hex } from 'viem';
import { RPC } from './config';

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
  /** Unix seconds, when the source provides it (explorer logs API does). */
  timeStamp?: number;
}

export interface LogFilter {
  /** Omit to match every contract (e.g. all Pons curves at once). */
  address?: Address;
  /** topics[i] = exact topic, list of alternatives, or null for "any". */
  topics: (Hex | Hex[] | null)[];
}

/** Anything with an EIP-1193 `request` (a viem client, or a fake in tests). */
interface RpcLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (args: any) => Promise<unknown>;
}

interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hash;
  logIndex: Hex;
}

export async function getLogsChunked(
  rpc: RpcLike,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  opts: { chunk?: number; minChunk?: number } = {},
): Promise<RawLog[]> {
  const maxChunk = BigInt(opts.chunk ?? RPC.maxLogRange);
  const minChunk = BigInt(opts.minChunk ?? 250);
  const out: RawLog[] = [];
  let size = maxChunk;
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + size - 1n > toBlock ? toBlock : cursor + size - 1n;
    try {
      const logs = (await rpc.request({
        method: 'eth_getLogs',
        params: [{ ...(filter.address ? { address: filter.address } : {}), topics: filter.topics, fromBlock: toHex(cursor), toBlock: toHex(end) }],
      })) as RpcLog[];
      for (const l of logs) {
        out.push({
          address: l.address,
          topics: l.topics,
          data: l.data,
          blockNumber: BigInt(l.blockNumber),
          transactionHash: l.transactionHash,
          logIndex: Number(BigInt(l.logIndex)),
        });
      }
      cursor = end + 1n;
      if (size < maxChunk) size = size * 2n > maxChunk ? maxChunk : size * 2n;
    } catch (e) {
      if (size <= minChunk) throw e;
      size = size / 2n;
    }
  }
  return out;
}

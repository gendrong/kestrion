/** Shared helpers for the Pons V1 and V2 adapters. */
import { pad, type Address, type Hash, type Hex } from 'viem';
import { erc20Abi } from '../../chain/abis';
import { RPC, TOKENS, ZERO_ADDRESS } from '../../chain/config';
import { getLogsChunked, type RawLog } from '../../chain/logs';
import type { EngineContext } from '../../context';
import type { PairType } from '../../types';
import { sameAddr } from '../../util/format';
import { mapLimit } from '../../util/limiter';

export async function readTokenBasics(ctx: EngineContext, token: Address) {
  const read = <T>(functionName: 'name' | 'symbol' | 'decimals' | 'totalSupply') =>
    ctx.rpc.readContract({ address: token, abi: erc20Abi, functionName }) as Promise<T>;
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    read<string>('name').catch(() => '?'),
    read<string>('symbol').catch(() => '?'),
    read<number>('decimals').catch(() => 18),
    read<bigint>('totalSupply'),
  ]);
  return { name, symbol, decimals: Number(decimals), totalSupply };
}

export async function readPair(
  ctx: EngineContext,
  pairToken: Address,
): Promise<{ pairType: PairType; pairSymbol: string; pairDecimals: number }> {
  if (sameAddr(pairToken, ZERO_ADDRESS)) return { pairType: 'ETH', pairSymbol: 'ETH', pairDecimals: 18 };
  if (sameAddr(pairToken, TOKENS.WETH)) return { pairType: 'ETH', pairSymbol: 'WETH', pairDecimals: 18 };
  if (sameAddr(pairToken, TOKENS.USDG)) return { pairType: 'USDG', pairSymbol: 'USDG', pairDecimals: 6 };
  const [symbol, decimals] = await Promise.all([
    ctx.rpc.readContract({ address: pairToken, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
    ctx.rpc.readContract({ address: pairToken, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ]);
  return { pairType: 'Other', pairSymbol: String(symbol), pairDecimals: Number(decimals) };
}

export interface LocatedLaunch {
  log: RawLog;
  txHash: Hash;
  from: Address;
  to: Address | null;
  input: Hex;
  blockNumber: bigint;
  timestamp: number;
}

/**
 * Find the factory's TokenLaunched log for `token`.
 * 1. The launch tx is already known (the ingest job read the factory event): read its receipt from the RPC.
 * 2. The explorer knows the token's creation tx (= the launch tx).
 * 3. Fallback: scan the last ~500k blocks (≈ 14 h) for the event with token as topic1.
 */
export async function locateLaunch(
  ctx: EngineContext,
  args: { factory: Address; topic0: Hex; token: Address; txHash?: Hash },
): Promise<LocatedLaunch> {
  const tokenTopic = pad(args.token.toLowerCase() as Hex).toLowerCase();
  const matches = (l: { address: string; topics: readonly string[] }) =>
    sameAddr(l.address, args.factory) &&
    l.topics[0]?.toLowerCase() === args.topic0.toLowerCase() &&
    l.topics[1]?.toLowerCase() === tokenTopic;

  const fromReceipt = async (hash: Hash): Promise<RawLog | undefined> => {
    const receipt = await ctx.rpc.getTransactionReceipt({ hash });
    const l = receipt.logs.find((x) => matches(x));
    return l
      ? { address: l.address, topics: [...l.topics] as Hex[], data: l.data, blockNumber: l.blockNumber, transactionHash: l.transactionHash, logIndex: l.logIndex }
      : undefined;
  };

  let log: RawLog | undefined;
  if (args.txHash) log = await fromReceipt(args.txHash).catch(() => undefined);
  if (!log && ctx.explorer) {
    // An explorer failure (e.g. no credits left) just means: use the RPC fallback below.
    const info = await ctx.explorer.addressInfo(args.token).catch(() => null);
    if (info?.creationTxHash) log = await fromReceipt(info.creationTxHash);
  }
  if (!log) {
    ctx.log('Launch tx not found via explorer; scanning recent blocks…');
    const latest = await ctx.rpc.getBlockNumber();
    const span = BigInt(RPC.maxLogRange) * 10n;
    for (let to = latest, i = 0; i < 5 && !log; i++, to -= span) {
      const from = to - span + 1n;
      const logs = await getLogsChunked(ctx.rpc, { address: args.factory, topics: [args.topic0, tokenTopic as Hex] }, from, to);
      log = logs.find((x) => matches(x));
    }
  }
  if (!log) throw new Error('Could not find the launch transaction for this token');

  const [tx, block] = await Promise.all([
    ctx.rpc.getTransaction({ hash: log.transactionHash }),
    ctx.rpc.getBlock({ blockNumber: log.blockNumber }),
  ]);
  return {
    log,
    txHash: log.transactionHash,
    from: tx.from,
    to: tx.to ?? null,
    input: tx.input,
    blockNumber: log.blockNumber,
    timestamp: Number(block.timestamp),
  };
}

/** Ranges up to this many blocks are read from the RPC (free, ≤ 3 calls); wider ones from the explorer. */
const RPC_FIRST_SPAN = 60_000n;

/**
 * Logs of one contract for some event topics in a block range, with timestamps.
 * Small ranges: RPC + block timestamps (no explorer credits). Wide ranges: the explorer (one call per topic,
 * includes timestamps), falling back to the RPC when it is capped or unavailable.
 */
export async function contractLogs(
  ctx: EngineContext,
  address: Address,
  topic0s: Hex[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawLog[]> {
  const explorer = ctx.explorer;
  if (explorer && toBlock - fromBlock > RPC_FIRST_SPAN) {
    try {
      const results = await Promise.all(topic0s.map((t) => explorer.logs({ address, fromBlock, toBlock, topics: { 0: t } })));
      if (!results.some((r) => r.capped)) return sortLogs(results.flatMap((r) => r.logs));
      ctx.log('Explorer log limit reached; reading logs from RPC instead…');
    } catch {
      ctx.log('Explorer logs unavailable; reading logs from RPC instead…');
    }
  }
  const logs = await getLogsChunked(ctx.rpc, { address, topics: [topic0s] }, fromBlock, toBlock);
  const times = await blockTimes(ctx, [...new Set(logs.map((l) => l.blockNumber))].slice(0, 60));
  for (const l of logs) l.timeStamp = times.get(l.blockNumber);
  return sortLogs(logs);
}

const sortLogs = (logs: RawLog[]) =>
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

export async function blockTimes(ctx: EngineContext, blocks: bigint[]): Promise<Map<bigint, number>> {
  const out = new Map<bigint, number>();
  await mapLimit(blocks, 6, async (b) => {
    const blk = await ctx.rpc.getBlock({ blockNumber: b });
    out.set(b, Number(blk.timestamp));
  });
  return out;
}

/**
 * True for real contracts. An EIP-7702 account (an EOA delegating to code) has code `0xef0100 || address`;
 * it is still a person's wallet, so it counts as NOT a contract.
 */
export async function isContract(ctx: EngineContext, address: Address): Promise<boolean> {
  const code = await ctx.rpc.getCode({ address });
  if (!code || code === '0x') return false;
  return !code.toLowerCase().startsWith('0xef0100');
}

/** Split [from, to] into ranges of at most `size` blocks. */
export function ranges(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) out.push([start, start + size - 1n > to ? to : start + size - 1n]);
  return out;
}

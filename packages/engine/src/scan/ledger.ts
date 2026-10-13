/**
 * All ERC-20 transfers of a token, read from the RPC (free) instead of the explorer. Gives exact balances (holders)
 * and per-wallet flows (sell pressure). Only for tokens young enough that the log range stays small; older or very
 * busy tokens use the explorer instead (returns null).
 */
import type { Address, Hex } from 'viem';
import { getLogsChunked } from '../chain/logs';
import { TOPICS } from '../chain/topics';
import type { EngineContext } from '../context';

/** Read transfers only when the token is at most this many blocks old (~8 hours at 0.1 s per block). */
export const LEDGER_MAX_SPAN = 300_000n;
/** Give up (and use the explorer) above this many transfers. */
export const LEDGER_MAX_TRANSFERS = 20_000;

export interface LedgerTransfer {
  from: Address;
  to: Address;
  value: bigint;
  block: bigint;
}

export interface TransferLedger {
  transfers: LedgerTransfer[];
  /** Lower-cased address → balance (only addresses that ever held the token). */
  balances: Map<string, bigint>;
}

const topicToAddress = (t: Hex | undefined) => (`0x${(t ?? '').slice(-40)}` as Address);

export function buildLedger(transfers: LedgerTransfer[]): TransferLedger {
  const balances = new Map<string, bigint>();
  const add = (a: string, v: bigint) => balances.set(a, (balances.get(a) ?? 0n) + v);
  for (const t of transfers) {
    add(t.from.toLowerCase(), -t.value);
    add(t.to.toLowerCase(), t.value);
  }
  return { transfers, balances };
}

export async function readLedger(ctx: EngineContext, token: Address, fromBlock: bigint, toBlock: bigint): Promise<TransferLedger | null> {
  if (toBlock - fromBlock > LEDGER_MAX_SPAN) return null;
  const logs = await getLogsChunked(ctx.rpc, { address: token, topics: [TOPICS.erc20Transfer] }, fromBlock, toBlock);
  if (logs.length > LEDGER_MAX_TRANSFERS) return null;
  const transfers = logs
    .filter((l) => l.topics.length >= 3)
    .map((l) => ({ from: topicToAddress(l.topics[1]), to: topicToAddress(l.topics[2]), value: BigInt(l.data === '0x' ? 0 : l.data), block: l.blockNumber }));
  return buildLedger(transfers);
}

/** Holders by balance (largest first), excluding the zero address. */
export function ledgerHolders(ledger: TransferLedger): { address: Address; balance: bigint }[] {
  return [...ledger.balances.entries()]
    .filter(([a, b]) => b > 0n && a !== '0x0000000000000000000000000000000000000000')
    .sort((x, y) => (x[1] > y[1] ? -1 : x[1] < y[1] ? 1 : 0))
    .map(([address, balance]) => ({ address: address as Address, balance }));
}

/** Transfers in or out of one wallet (the explorer's tokentx shape, without time/hash). */
export const ledgerTransfersOf = (ledger: TransferLedger, wallet: Address) =>
  ledger.transfers.filter((t) => t.from.toLowerCase() === wallet.toLowerCase() || t.to.toLowerCase() === wallet.toLowerCase());

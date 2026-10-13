/**
 * $KEST balance → tier (Phase 7). Read-only: one eth_call per value on the public RPC, never a transaction.
 * Off (everyone Free) until KEST.address (engine chain config) and HOLDER_MIN_KEST (db tiers) are both set.
 */
import 'server-only';
import { HOLDER_MIN_KEST, tierForBalance, type Tier } from '@kestrion/db';
import { KEST, RPC } from '@kestrion/engine/config';
import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from 'viem';

export const kestEnabled = (): boolean => KEST.address !== null && HOLDER_MIN_KEST !== null;

async function call(data: Hex): Promise<Hex> {
  const res = await fetch(RPC.publicUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: KEST.address, data }, 'latest'] }),
    signal: AbortSignal.timeout(2500),
  });
  const body = (await res.json()) as { result?: Hex; error?: { message: string } };
  if (!res.ok || !body.result) throw new Error(body.error?.message ?? `RPC HTTP ${res.status}`);
  return body.result;
}

/** The wallet's $KEST balance and the tier it earns; null when the feature is off or the read failed. */
export async function kestTier(wallet: string): Promise<{ balance: bigint; tier: Tier } | null> {
  if (!kestEnabled()) return null;
  try {
    const [balHex, decHex] = await Promise.all([
      call(encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [wallet as Hex] })),
      call(encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' })),
    ]);
    const balance = decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: balHex });
    const decimals = decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: decHex });
    return { balance, tier: tierForBalance(balance, Number(decimals)) };
  } catch (e) {
    // The hourly job refreshes balances too, so a failed read here only delays the tier change.
    console.warn('[kest] balance read failed', (e as Error).message);
    return null;
  }
}

/** Shown when a Free account hits a limit (only once the Holder tier exists). */
export const holderHint = (what: string) => (kestEnabled() ? ` Holding at least ${HOLDER_MIN_KEST} $KEST unlocks ${what}.` : '');

/**
 * Is an unknown address a token (contract) or a wallet? One eth_getCode call to the public RPC. This is not a scan:
 * a single cheap read, so the search box can send wallets to their creator page instead of the token queue.
 */
import 'server-only';
import { RPC } from '@kestrion/engine/config';

/** EIP-7702 delegated wallets have code "0xef0100…" but are still wallets (EOAs). */
const DELEGATION_PREFIX = '0xef0100';

export async function addressKind(address: string): Promise<'contract' | 'wallet' | 'unknown'> {
  try {
    const res = await fetch(RPC.publicUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      console.warn('[resolve] getCode HTTP', res.status);
      return 'unknown';
    }
    const body = (await res.json()) as { result?: unknown };
    if (typeof body.result !== 'string' || !body.result.startsWith('0x')) return 'unknown';
    const code = body.result.toLowerCase();
    return code === '0x' || code.startsWith(DELEGATION_PREFIX) ? 'wallet' : 'contract';
  } catch (e) {
    // Unknown is fine: the scan queue also detects wallets (jobs/src/ingest.ts) and the page then redirects.
    console.warn('[resolve] getCode failed', (e as Error).name);
    return 'unknown';
  }
}

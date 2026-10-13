/**
 * Sign-In with Ethereum (EIP-4361) checks on the server. The wallet signs a plain-text message (no transaction, no
 * gas); we check the message is for this site, fresh, uses a nonce we issued, and that the signature recovers to the
 * address in it. Signature recovery is local (no RPC), so smart-contract wallets (EIP-1271) aren't supported yet.
 * Spec: https://eips.ethereum.org/EIPS/eip-4361 · parser/recovery: viem (viem/siwe, recoverMessageAddress).
 */
import 'server-only';
import { isAddressEqual, recoverMessageAddress, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';

/** A signed message older than this is refused (the nonce also expires after 10 minutes). */
const MAX_AGE_MS = 10 * 60_000;

export type SiweCheck = { ok: true; address: string; nonce: string } | { ok: false; reason: string };

export async function checkSiwe(message: string, signature: string, expectedHost: string): Promise<SiweCheck> {
  if (message.length > 2000 || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return { ok: false, reason: 'malformed request' };
  const m = parseSiweMessage(message);
  if (!m.address || !m.nonce || !m.domain || !m.uri || !m.issuedAt) return { ok: false, reason: 'not a sign-in message' };
  if (m.domain !== expectedHost) return { ok: false, reason: 'message is for another site' };
  try {
    if (new URL(m.uri).host !== expectedHost) return { ok: false, reason: 'message is for another site' };
  } catch {
    return { ok: false, reason: 'bad uri' };
  }
  const now = Date.now();
  if (Math.abs(now - m.issuedAt.getTime()) > MAX_AGE_MS) return { ok: false, reason: 'message expired, please try again' };
  if (m.expirationTime && m.expirationTime.getTime() < now) return { ok: false, reason: 'message expired, please try again' };
  if (m.notBefore && m.notBefore.getTime() > now) return { ok: false, reason: 'message not valid yet' };
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return { ok: false, reason: 'invalid signature' };
  }
  if (!isAddressEqual(signer as Hex, m.address)) return { ok: false, reason: 'signature does not match the wallet' };
  return { ok: true, address: m.address.toLowerCase(), nonce: m.nonce };
}

/**
 * Public API access (CLAUDE.md §9): without a key a low per-IP limit; with a valid API key a higher per-key limit.
 * Keys are sent as `Authorization: Bearer kest_…` or `X-API-Key: kest_…` and stored only as SHA-256 hashes.
 */
import 'server-only';
import { useApiKey } from '@kestrion/db';
import { apiError, rateLimited } from './apiResponse';
import { getDb } from './db';
import { LIMITS, rateLimit } from './rateLimit';
import { hashToken } from './session';

/** "kest_" + 43 base64url characters (32 random bytes). */
export const API_KEY_RE = /^kest_[A-Za-z0-9_-]{43}$/;

export type ApiAccess =
  | { ok: true; headers: Record<string, string>; key: { id: number; wallet: string } | null }
  | { ok: false; response: Response };

export function apiKeyFrom(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-api-key')?.trim() || null;
}

export async function apiAccess(req: Request): Promise<ApiAccess> {
  const raw = apiKeyFrom(req);
  if (!raw) {
    const limit = await rateLimit('api', req.headers);
    return limit.ok ? { ok: true, headers: { ...limit.headers, 'X-Kestrion-Access': 'anonymous' }, key: null } : { ok: false, response: rateLimited(limit.headers) };
  }
  const invalid = () => ({ ok: false as const, response: apiError(401, 'invalid_api_key', 'This API key is not valid or was revoked.') });
  if (!API_KEY_RE.test(raw)) return invalid();
  const db = getDb();
  if (!db) return { ok: false, response: apiError(503, 'unavailable', 'The database is not configured or unreachable. Try again later.') };
  const key = await useApiKey(db, await hashToken(raw)).catch(() => null);
  if (!key) return invalid();
  const limit = await rateLimit('apiKey', req.headers, String(key.id));
  if (!limit.ok) return { ok: false, response: rateLimited(limit.headers) };
  return { ok: true, headers: { 'X-RateLimit-Limit': String(LIMITS.apiKey), 'X-Kestrion-Access': 'api-key' }, key: { id: key.id, wallet: key.wallet } };
}

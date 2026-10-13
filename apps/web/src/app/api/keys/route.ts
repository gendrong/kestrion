/**
 * The signed-in user's API keys.
 * GET → { keys } · POST { name } → { key, info } (the full key is returned ONCE, only its hash is stored)
 * DELETE { id } → revoke.
 */
import { createApiKey, listApiKeys, MAX_API_KEYS, revokeApiKey } from '@kestrion/db';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { currentUser, hashToken, newSessionToken, sameOrigin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function signedIn() {
  const db = getDb();
  const user = await currentUser(db);
  return db && user ? { db, user } : null;
}

export async function GET() {
  const s = await signedIn();
  if (!s) return reply(401, { error: 'Sign in to manage API keys' });
  return reply(200, { keys: await listApiKeys(s.db, s.user.wallet), max: MAX_API_KEYS });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return reply(403, { error: 'Forbidden' });
  const limit = await rateLimit('enqueue', req.headers);
  if (!limit.ok) return reply(429, { error: 'Too many requests' });
  const s = await signedIn();
  if (!s) return reply(401, { error: 'Sign in to manage API keys' });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.replace(/[\p{Cc}]/gu, '').trim().slice(0, 60) : '';
  // 32 random bytes, base64url: the same generator as session tokens.
  const key = `kest_${newSessionToken()}`;
  const id = await createApiKey(s.db, s.user, await hashToken(key), key.slice(0, 9), name || 'API key');
  if (id === null) return reply(409, { error: `You already have ${MAX_API_KEYS} keys. Revoke one first.` });
  return reply(200, { key, id });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return reply(403, { error: 'Forbidden' });
  const s = await signedIn();
  if (!s) return reply(401, { error: 'Sign in to manage API keys' });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return reply(400, { error: 'Malformed request' });
  return reply((await revokeApiKey(s.db, s.user.wallet, id)) ? 200 : 404, { revoked: true });
}

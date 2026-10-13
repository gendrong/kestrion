/** POST /api/auth/verify { message, signature } — checks the signed SIWE message and starts a session (cookie). */
import { consumeNonce, createSession, upsertUser } from '@kestrion/db';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { hashToken, newSessionToken, sameOrigin, sessionCookie } from '@/lib/session';
import { checkSiwe } from '@/lib/siwe';

export const dynamic = 'force-dynamic';

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'Forbidden');
  const limit = await rateLimit('enqueue', req.headers);
  if (!limit.ok) return fail(429, 'Too many sign-in attempts. Please wait a minute.');
  const db = getDb();
  if (!db) return fail(503, 'Sign-in is unavailable right now');

  const body = (await req.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  if (typeof body?.message !== 'string' || typeof body.signature !== 'string') return fail(400, 'Malformed request');
  const check = await checkSiwe(body.message, body.signature, new URL(req.url).host);
  if (!check.ok) return fail(401, `Sign-in failed: ${check.reason}`);
  if (!(await consumeNonce(db, check.nonce))) return fail(401, 'Sign-in failed: this request expired, please try again');

  const user = await upsertUser(db, check.address);
  const token = newSessionToken();
  await createSession(db, user.wallet, await hashToken(token));
  (await cookies()).set(sessionCookie(token));
  return Response.json({ address: user.wallet, tier: user.tier }, { headers: { 'Cache-Control': 'no-store' } });
}

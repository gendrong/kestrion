/** POST /api/auth/verify { message, signature } — checks the signed SIWE message and starts a session (cookie). */
import { consumeNonce, createSession, setUserBalance, upsertUser } from '@kestrion/db';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { kestTier } from '@/lib/kest';
import { rateLimit } from '@/lib/rateLimit';
import { hashToken, newSessionToken, sameOrigin, sessionCookie } from '@/lib/session';
import { checkSiwe } from '@/lib/siwe';
import { withPausedWrites } from '@/lib/paused';

export const dynamic = 'force-dynamic';

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export const POST = withPausedWrites(async function postHandler(req: Request) {
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

  let user = await upsertUser(db, check.address);
  // Phase 7: the $KEST balance decides the tier (no-op while the token address isn't set).
  const kest = await kestTier(user.wallet);
  if (kest) {
    await setUserBalance(db, user.wallet, kest.balance, kest.tier);
    user = { ...user, tier: kest.tier };
  }
  const token = newSessionToken();
  await createSession(db, user.wallet, await hashToken(token));
  (await cookies()).set(sessionCookie(token));
  return Response.json({ address: user.wallet, tier: user.tier }, { headers: { 'Cache-Control': 'no-store' } });
});

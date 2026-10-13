/** POST /api/follow { creator, action: 'add' | 'remove' } — creators the signed-in user follows. */
import { followCreator, TIERS, unfollowCreator } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { currentUser, sameOrigin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return reply(403, { error: 'Forbidden' });
  const limit = await rateLimit('api', req.headers);
  if (!limit.ok) return reply(429, { error: 'Too many requests' });
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !user) return reply(401, { error: 'Sign in to follow creators' });
  const body = (await req.json().catch(() => null)) as { creator?: string; action?: string } | null;
  const creator = normalizeAddress(body?.creator);
  if (!creator || (body?.action !== 'add' && body?.action !== 'remove')) return reply(400, { error: 'Malformed request' });

  if (body.action === 'remove') {
    await unfollowCreator(db, user, creator);
    return reply(200, { following: false });
  }
  const r = await followCreator(db, user, creator);
  if (!r.ok) return reply(409, { error: `Free accounts can follow up to ${r.limit} creators. Unfollow one first.`, limit: r.limit });
  return reply(200, { following: true, limit: TIERS[user.tier].follows });
}

/** POST /api/watchlist { token, action: 'add' | 'remove' } — the signed-in user's watchlist. */
import { addToWatchlist, isScanned, removeFromWatchlist, TIERS } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { getDb } from '@/lib/db';
import { holderHint } from '@/lib/kest';
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
  if (!db || !user) return reply(401, { error: 'Sign in to use the watchlist' });
  const body = (await req.json().catch(() => null)) as { token?: string; action?: string } | null;
  const token = normalizeAddress(body?.token);
  if (!token || (body?.action !== 'add' && body?.action !== 'remove')) return reply(400, { error: 'Malformed request' });

  if (body.action === 'remove') {
    await removeFromWatchlist(db, user, token);
    return reply(200, { watching: false });
  }
  if (!(await isScanned(db, token))) return reply(409, { error: 'This token has no report yet' });
  const r = await addToWatchlist(db, user, token);
  if (!r.ok) return reply(409, { error: `Your account can watch up to ${r.limit} tokens. Remove one first.${user.tier === 'free' ? holderHint('a bigger watchlist') : ''}`, limit: r.limit });
  return reply(200, { watching: true, limit: TIERS[user.tier].watchlist });
}

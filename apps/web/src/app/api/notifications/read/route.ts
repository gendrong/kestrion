/** POST /api/notifications/read { ids?: number[] } — mark some (or all) notifications as read. */
import { markNotificationsRead } from '@kestrion/db';
import { getDb } from '@/lib/db';
import { currentUser, sameOrigin } from '@/lib/session';
import { withPausedWrites } from '@/lib/paused';

export const dynamic = 'force-dynamic';

export const POST = withPausedWrites(async function postHandler(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : undefined;
  await markNotificationsRead(db, user.wallet, ids);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});

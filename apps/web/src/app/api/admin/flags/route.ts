/** POST /api/admin/flags { id, status: 'open' | 'reviewed' | 'dismissed' } — admins only. */
import { setFlagStatus, type FlagStatus } from '@kestrion/db';
import { isAdmin } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { currentUser, sameOrigin } from '@/lib/session';
import { withPausedWrites } from '@/lib/paused';

export const dynamic = 'force-dynamic';

const STATUSES: FlagStatus[] = ['open', 'reviewed', 'dismissed'];

export const POST = withPausedWrites(async function postHandler(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !isAdmin(user)) return Response.json({ error: 'Not found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  const id = Number(body?.id);
  const status = STATUSES.find((s) => s === body?.status);
  if (!Number.isInteger(id) || !status) return Response.json({ error: 'Malformed request' }, { status: 400 });
  await setFlagStatus(db, id, status, user!.wallet);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});

/** POST /api/auth/logout — ends the session. */
import { deleteSession } from '@kestrion/db';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { hashToken, sameOrigin, SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const db = getDb();
  if (token && db) await deleteSession(db, await hashToken(token)).catch(() => {});
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

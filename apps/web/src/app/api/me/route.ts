/** GET /api/me — who is signed in, and how many unread notifications (for the header). */
import { unreadCount } from '@kestrion/db';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const user = await currentUser(db);
  const headers = { 'Cache-Control': 'no-store' };
  if (!user || !db) return Response.json({ user: null }, { headers });
  const unread = await unreadCount(db, user.wallet).catch(() => 0);
  return Response.json({ user: { address: user.wallet, tier: user.tier }, unread }, { headers });
}

/** POST /api/admin/rescan { addresses: string[] } — queue full scans (admins only, no cooldown, max 50). */
import { enqueueScan } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { isAdmin } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { currentUser, sameOrigin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !isAdmin(user)) return Response.json({ error: 'Not found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { addresses?: unknown } | null;
  const list = Array.isArray(body?.addresses) ? body.addresses : [];
  const addresses = [...new Set(list.map((a) => normalizeAddress(String(a))).filter((a): a is string => !!a))].slice(0, 50);
  if (addresses.length === 0) return Response.json({ error: 'No valid addresses' }, { status: 400 });
  for (const a of addresses) await enqueueScan(db, a, 'full');
  return Response.json({ queued: addresses.length }, { headers: { 'Cache-Control': 'no-store' } });
}

/** POST /api/flags { token, type: 'false_positive' | 'missed_risk', note? } — flag a report (signed-in, rate-limited). */
import { createFlag, isScanned, type FlagType } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { currentUser, sameOrigin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const TYPES: FlagType[] = ['false_positive', 'missed_risk'];

export async function POST(req: Request) {
  if (!sameOrigin(req)) return reply(403, { error: 'Forbidden' });
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !user) return reply(401, { error: 'Sign in to flag a report' });
  const limit = await rateLimit('enqueue', req.headers, `flag:${user.wallet}`);
  if (!limit.ok) return reply(429, { error: 'You sent many flags in a short time. Please wait a minute.' });
  const body = (await req.json().catch(() => null)) as { token?: string; type?: string; note?: unknown } | null;
  const token = normalizeAddress(body?.token);
  const type = TYPES.find((t) => t === body?.type);
  if (!token || !type) return reply(400, { error: 'Malformed request' });
  if (typeof body?.note === 'string' && body.note.length > 1000) return reply(400, { error: 'The note can be at most 1000 characters' });
  if (!(await isScanned(db, token))) return reply(404, { error: 'This token has no report' });
  await createFlag(db, user, token, type, typeof body?.note === 'string' ? body.note : null);
  return reply(200, { ok: true });
}

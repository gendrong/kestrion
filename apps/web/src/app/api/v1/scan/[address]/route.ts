/**
 * POST /api/v1/scan/:address — ask for a fresh full scan of a token (CLAUDE.md §9). Needs an API key
 * (Authorization: Bearer kest_…) or a signed-in session on the website. Rate-limited per key / IP; a token
 * scanned in the last 10 minutes is not rescanned. The scan runs in the next job run (every ~5 minutes) while the
 * day's explorer credits allow full scans.
 * 202 { data: null, meta: { status, retryAfterSeconds } } · 400 invalid_address · 401 unauthorized / invalid_api_key
 * 429 rate_limited / recently scanned
 */
import { enqueueScan, getLatestScan } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { apiData, apiError, dbUnavailable, rateLimited } from '@/lib/apiResponse';
import { apiAccess, apiKeyFrom } from '@/lib/apiAuth';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { currentUser, sameOrigin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const COOLDOWN_MS = 10 * 60_000;

export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const address = normalizeAddress((await params).address);
  if (!address) return apiError(400, 'invalid_address', 'Expected a token address: 0x followed by 40 hex characters.');
  const db = getDb();
  if (!db) return dbUnavailable();

  // Who is asking: an API key, or a signed-in user of the website.
  let subject: string;
  if (apiKeyFrom(req)) {
    const access = await apiAccess(req);
    if (!access.ok) return access.response;
    subject = `key:${access.key!.id}`;
  } else {
    const user = sameOrigin(req) ? await currentUser(db) : null;
    if (!user) return apiError(401, 'unauthorized', 'Sign in on the website or send an API key to request a rescan.');
    subject = `user:${user.wallet}`;
  }
  const limit = await rateLimit('enqueue', req.headers, subject);
  if (!limit.ok) return rateLimited(limit.headers);
  try {
    const latest = await getLatestScan(db, address);
    if (latest && Date.now() - Date.parse(latest.scannedAt) < COOLDOWN_MS) {
      return apiError(429, 'rate_limited', 'This token was scanned in the last 10 minutes. Try again later.', { 'Retry-After': '600' });
    }
    const request = await enqueueScan(db, address, 'full');
    return apiData(
      null,
      { status: request.status === 'done' ? 'queued' : request.status, retryAfterSeconds: 300 },
      { status: 202, headers: { 'Cache-Control': 'no-store', ...limit.headers } },
    );
  } catch (e) {
    console.error('[api/scan]', e);
    return apiError(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

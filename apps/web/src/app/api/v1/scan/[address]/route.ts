/**
 * POST /api/v1/scan/:address — ask for a fresh full scan of a token (CLAUDE.md §9). Rate-limited per IP; a token
 * scanned in the last 10 minutes is not rescanned. The scan runs in the next job run (every ~5 minutes) while the
 * day's explorer credits allow full scans.
 * 202 { data: null, meta: { status, retryAfterSeconds } } · 400 invalid_address · 429 rate_limited / recently scanned
 */
import { enqueueScan, getLatestScan } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { apiData, apiError, dbUnavailable, rateLimited } from '@/lib/apiResponse';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const COOLDOWN_MS = 10 * 60_000;

export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const limit = await rateLimit('enqueue', req.headers);
  if (!limit.ok) return rateLimited(limit.headers);
  const address = normalizeAddress((await params).address);
  if (!address) return apiError(400, 'invalid_address', 'Expected a token address: 0x followed by 40 hex characters.');
  const db = getDb();
  if (!db) return dbUnavailable();
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

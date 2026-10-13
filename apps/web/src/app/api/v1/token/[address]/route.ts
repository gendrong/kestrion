/**
 * GET /api/v1/token/:address — latest risk report for a token.
 * 200 { data: report, meta: { scannedAt } }
 * 202 { data: null, meta: { status: 'queued' | 'scanning', retryAfterSeconds } } — not scanned yet, now queued
 * 400 invalid_address · 404 not_a_launch · 429 rate_limited · 503 unavailable
 */
import { enqueueScan, getLatestScan } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { apiData, apiError, corsPreflight, dbUnavailable, rateLimited } from '@/lib/apiResponse';
import { apiAccess } from '@/lib/apiAuth';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const access = await apiAccess(req);
  if (!access.ok) return access.response;
  const limit = access;

  const address = normalizeAddress((await params).address);
  if (!address) return apiError(400, 'invalid_address', 'Expected a token address: 0x followed by 40 hex characters.');

  const db = getDb();
  if (!db) return dbUnavailable();
  try {
    const latest = await getLatestScan(db, address);
    if (latest) {
      return apiData(latest.report, { scannedAt: latest.scannedAt }, { headers: { 'Cache-Control': 'public, max-age=60', ...limit.headers } });
    }
    const enqueueLimit = await rateLimit('enqueue', req.headers);
    if (!enqueueLimit.ok) return rateLimited(enqueueLimit.headers);
    const request = await enqueueScan(db, address);
    if (request.status === 'not_a_launch') {
      return apiError(404, 'not_a_launch', 'This address is not a token launched on Pons (V2, V1 active or V1 legacy).');
    }
    return apiData(
      null,
      { status: request.status === 'failed' ? 'failed' : request.status === 'scanning' ? 'scanning' : 'queued', retryAfterSeconds: 300 },
      { status: 202, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store', ...limit.headers } },
    );
  } catch (e) {
    console.error('[api/token]', e);
    return apiError(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/v1/creator/:address — a wallet's Pons launches with scores, outcomes and stats.
 * 200 { data: CreatorView, meta: {} }
 * 202 { data: null, meta: { status: 'queued' | 'searching' | 'failed', retryAfterSeconds } } — unknown wallet, lookup queued
 * 400 invalid_address · 404 no_launches · 429 rate_limited · 503 unavailable
 */
import { enqueueCreatorLookup } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { apiData, apiError, corsPreflight, dbUnavailable, rateLimited } from '@/lib/apiResponse';
import { loadCreatorView } from '@/lib/creatorView';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const limit = await rateLimit('api', req.headers);
  if (!limit.ok) return rateLimited(limit.headers);

  const address = normalizeAddress((await params).address);
  if (!address) return apiError(400, 'invalid_address', 'Expected a wallet address: 0x followed by 40 hex characters.');

  const db = getDb();
  if (!db) return dbUnavailable();
  try {
    const view = await loadCreatorView(db, address);
    if (view.known) return apiData(view, {}, { headers: { 'Cache-Control': 'public, max-age=60', ...limit.headers } });

    const enqueueLimit = await rateLimit('enqueue', req.headers);
    if (!enqueueLimit.ok) return rateLimited(enqueueLimit.headers);
    const request = await enqueueCreatorLookup(db, address);
    if (request.status === 'no_launches') return apiError(404, 'no_launches', 'No Pons launches found for this wallet.');
    return apiData(
      null,
      { status: request.status === 'done' ? 'queued' : request.status, retryAfterSeconds: 300 },
      { status: 202, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store', ...limit.headers } },
    );
  } catch (e) {
    console.error('[api/creator]', e);
    return apiError(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/v1/launches?since=&risk=&stage=&pair=&sort=&limit= — recent scanned launches (the live feed).
 * risk: low|caution|high · stage: new|near|graduated · pair: ETH|USDG|Other · sort: newest|safest|riskiest
 * since: unix seconds, milliseconds or ISO date · limit: 1–100 (default 50)
 */
import { getFeed, parseFeedQuery } from '@kestrion/db';
import { apiData, apiError, corsPreflight, dbUnavailable, rateLimited } from '@/lib/apiResponse';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = await rateLimit('api', req.headers);
  if (!limit.ok) return rateLimited(limit.headers);
  const db = getDb();
  if (!db) return dbUnavailable();
  const q = parseFeedQuery(new URL(req.url).searchParams);
  try {
    const items = await getFeed(db, q);
    return apiData(
      items,
      { count: items.length, query: { ...q, since: q.since?.toISOString() ?? null } },
      { headers: { 'Cache-Control': 'public, max-age=15', ...limit.headers } },
    );
  } catch (e) {
    console.error('[api/launches]', e);
    return apiError(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

export function OPTIONS() {
  return corsPreflight();
}

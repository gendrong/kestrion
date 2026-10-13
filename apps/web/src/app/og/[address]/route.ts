/**
 * GET /og/:address — the token's share image (1200×630 PNG), rendered by the ingest job and stored in D1.
 * The Worker only decodes stored bytes (rendering here would exceed the free plan's CPU limit).
 * No stored image (older token, not scanned yet) → redirect to the site's default image.
 * `?v=<scannedAt>` (added by the report page) makes the URL change with every new scan, so it can be cached long.
 */
import { getOgImage } from '@kestrion/db';
import { normalizeAddress } from '@/lib/address';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';
import { DEFAULT_OG_IMAGE } from '@/lib/site';

export const dynamic = 'force-dynamic';

const fallback = (req: Request) =>
  new Response(null, { status: 302, headers: { Location: new URL(DEFAULT_OG_IMAGE, req.url).toString(), 'Cache-Control': 'public, max-age=300' } });

export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const address = normalizeAddress((await params).address);
  if (!address) return fallback(req);
  const limit = await rateLimit('image', req.headers);
  if (!limit.ok) return new Response('Too many requests', { status: 429, headers: limit.headers });

  const db = getDb();
  if (!db) return fallback(req);
  try {
    const img = await getOgImage(db, address);
    if (!img) return fallback(req);
    const bytes = Uint8Array.from(atob(img.pngBase64), (c) => c.charCodeAt(0));
    const versioned = new URL(req.url).searchParams.get('v') === img.scannedAt;
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': versioned ? 'public, max-age=604800, immutable' : 'public, max-age=600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    console.error('[og]', e);
    return fallback(req);
  }
}

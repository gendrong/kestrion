/**
 * GET /img/:cid — token logos, proxied from IPFS only (CLAUDE.md §11: never trust token metadata).
 * Only raster images up to 2 MB pass; SVG is refused (it can carry scripts).
 * Public gateways rate-limit often, so several are tried in order and results are kept in Cloudflare's edge cache
 * (a CID never changes, so each logo is fetched from IPFS about once per location).
 */
import { rateLimit } from '@/lib/rateLimit';

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;
/** Tried in order. ipfs.io / dweb.link / pinata often answer 429 to Cloudflare's shared egress IPs (tested 2026-10-12). */
const GATEWAYS = [
  'https://ipfs.filebase.io/ipfs/',
  'https://4everland.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
const HEADERS = {
  'Cache-Control': 'public, max-age=604800, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

/** `tried` = what each gateway answered (e.g. "ipfs.io:429,gateway.pinata.cloud:200 text/html"), for debugging. */
const notFound = (tried = '') =>
  new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=600', ...(tried ? { 'X-Img-Gateways': tried } : {}) } });

/** Cloudflare's per-location cache (absent outside Workers). */
const edgeCache = (): Cache | undefined => (globalThis as { caches?: { default?: Cache } }).caches?.default;

async function fetchFromIpfs(cid: string, tried: string[]): Promise<{ type: string; body: ArrayBuffer } | null> {
  for (const gateway of GATEWAYS) {
    const host = new URL(gateway).hostname;
    try {
      const res = await fetch(`${gateway}${cid}`, { headers: { accept: ALLOWED.join(',') }, signal: AbortSignal.timeout(6000) });
      const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      tried.push(`${host}:${res.status} ${type}`);
      if (!res.ok) continue; // 429 / 5xx: try the next gateway
      if (!ALLOWED.includes(type)) continue; // e.g. an HTML error page from this gateway
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
      const body = await res.arrayBuffer();
      return body.byteLength > MAX_BYTES ? null : { type, body };
    } catch (e) {
      tried.push(`${host}:${(e as Error).name}`); // timeout or network error: next gateway
    }
  }
  return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!CID_RE.test(cid)) return notFound();

  const cache = edgeCache();
  const cacheKey = new Request(`https://kestrion-img.cache/${cid}`);
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;

  const limit = await rateLimit('image', req.headers);
  if (!limit.ok) return new Response('Too many requests', { status: 429, headers: limit.headers });

  const tried: string[] = [];
  const img = await fetchFromIpfs(cid, tried);
  if (!img) return notFound(tried.join(','));
  const response = new Response(img.body, { headers: { 'Content-Type': img.type, ...HEADERS } });
  await cache?.put(cacheKey, response.clone()).catch(() => {});
  return response;
}

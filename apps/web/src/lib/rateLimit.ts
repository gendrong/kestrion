/**
 * Rate limiting with the Cloudflare Workers Rate Limiting binding (configured in wrangler.jsonc).
 * Limits are per Cloudflare location and approximate (by design). Without the binding (local `next start`)
 * every request is allowed.
 * Docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
import 'server-only';
import { cfEnv, type RateLimiterBinding } from './cloudflare';

export type LimitKind = 'api' | 'enqueue' | 'image';

/** Must match wrangler.jsonc (requests per 60 s per IP). */
export const LIMITS: Record<LimitKind, number> = { api: 60, enqueue: 10, image: 240 };

/** Client IP from Cloudflare / proxy headers. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ??
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export interface LimitResult {
  ok: boolean;
  headers: Record<string, string>;
}

export async function rateLimit(kind: LimitKind, headers: Headers): Promise<LimitResult> {
  const env = cfEnv();
  const binding: RateLimiterBinding | undefined =
    kind === 'api' ? env.API_LIMITER : kind === 'enqueue' ? env.ENQUEUE_LIMITER : env.IMAGE_LIMITER;
  if (!binding) return { ok: true, headers: {} };
  try {
    const { success } = await binding.limit({ key: `${kind}:${clientIp(headers)}` });
    return success
      ? { ok: true, headers: { 'X-RateLimit-Limit': String(LIMITS[kind]) } }
      : { ok: false, headers: { 'X-RateLimit-Limit': String(LIMITS[kind]), 'Retry-After': '60' } };
  } catch (e) {
    // If the limiter fails, don't take the site down with it.
    console.error('[ratelimit] unavailable', e);
    return { ok: true, headers: {} };
  }
}

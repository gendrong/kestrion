/**
 * Rate limiting with the Cloudflare Workers Rate Limiting binding (configured in wrangler.jsonc).
 * Limits are per Cloudflare location and approximate (by design). Without the binding (local `next start`)
 * every request is allowed.
 * Docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
import 'server-only';
import { cfEnv, type RateLimiterBinding } from './cloudflare';

export type LimitKind = 'api' | 'apiKey' | 'enqueue' | 'image';

/** Must match wrangler.jsonc (requests per 60 s; per IP, or per key for 'apiKey'). */
export const LIMITS: Record<LimitKind, number> = { api: 60, apiKey: 600, enqueue: 10, image: 240 };

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

/** `subject` replaces the client IP as the counter key (e.g. an API key id). */
export async function rateLimit(kind: LimitKind, headers: Headers, subject?: string): Promise<LimitResult> {
  const env = cfEnv();
  const binding: RateLimiterBinding | undefined =
    kind === 'api'
      ? env.API_LIMITER
      : kind === 'apiKey'
        ? env.API_KEY_LIMITER
        : kind === 'enqueue'
          ? env.ENQUEUE_LIMITER
          : env.IMAGE_LIMITER;
  if (!binding) return { ok: true, headers: {} };
  try {
    const { success } = await binding.limit({ key: `${kind}:${subject ?? clientIp(headers)}` });
    return success
      ? { ok: true, headers: { 'X-RateLimit-Limit': String(LIMITS[kind]) } }
      : { ok: false, headers: { 'X-RateLimit-Limit': String(LIMITS[kind]), 'Retry-After': '60' } };
  } catch (e) {
    // If the limiter fails, don't take the site down with it.
    console.error('[ratelimit] unavailable', e);
    return { ok: true, headers: {} };
  }
}

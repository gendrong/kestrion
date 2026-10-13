import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1DatabaseLike } from '@kestrion/db';

/** Bindings declared in wrangler.jsonc. */
export interface RateLimiterBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
export interface KestrionEnv {
  DB?: D1DatabaseLike;
  API_LIMITER?: RateLimiterBinding;
  ENQUEUE_LIMITER?: RateLimiterBinding;
  IMAGE_LIMITER?: RateLimiterBinding;
  /** Per API key (higher limit than per IP). */
  API_KEY_LIMITER?: RateLimiterBinding;
  /** Per API key of a Holder account (Phase 7). */
  HOLDER_KEY_LIMITER?: RateLimiterBinding;
  /** Comma-separated wallet addresses allowed on /admin (wrangler.jsonc "vars"). */
  ADMIN_WALLETS?: string;
}

/** Cloudflare bindings, or {} when not running on Workers (e.g. plain `next start`). */
export function cfEnv(): KestrionEnv {
  try {
    return getCloudflareContext().env as unknown as KestrionEnv;
  } catch {
    return {};
  }
}

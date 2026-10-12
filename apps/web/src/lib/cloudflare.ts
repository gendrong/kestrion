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
}

/** Cloudflare bindings, or {} when not running on Workers (e.g. plain `next start`). */
export function cfEnv(): KestrionEnv {
  try {
    return getCloudflareContext().env as unknown as KestrionEnv;
  } catch {
    return {};
  }
}

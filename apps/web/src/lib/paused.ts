/**
 * When D1 refuses writes (free plan: 100,000 rows written per day, reset 00:00 UTC), routes that save something
 * answer "paused" instead of crashing: reading reports keeps working, saving waits a few hours.
 */
import 'server-only';

export const isWriteQuotaError = (e: unknown) => /exceeded D1|row write limit|daily .*limit|SQLITE_FULL/i.test(String((e as Error)?.message ?? e));

export const PAUSED_MESSAGE = 'Saving is paused for a few hours (daily database limit). Reports and the live feed stay available.';

/** Wrap a route handler: a write-quota error becomes a 503 "paused" answer; other errors still surface. */
export function withPausedWrites<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (!isWriteQuotaError(e)) throw e;
      console.warn('[paused] D1 write refused');
      return Response.json({ error: PAUSED_MESSAGE, paused: true }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' } });
    }
  };
}

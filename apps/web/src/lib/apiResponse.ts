/** Consistent API responses: success = { data, meta }, error = { error: { code, message } }. CORS open for GET. */

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400',
} as const;

export type ApiErrorCode =
  | 'invalid_address'
  | 'invalid_api_key'
  | 'unauthorized'
  | 'not_a_launch'
  | 'no_launches'
  | 'rate_limited'
  | 'unavailable'
  | 'internal_error';

/** JSON.stringify that turns bigints into strings (stored reports are JSON-safe; this is a safety net). */
export const toJson = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

export function apiData(data: unknown, meta: Record<string, unknown> = {}, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(toJson({ data, meta }), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...init.headers },
  });
}

export function apiError(status: number, code: ApiErrorCode, message: string, headers: Record<string, string> = {}) {
  return new Response(toJson({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...headers },
  });
}

export const rateLimited = (headers: Record<string, string>) =>
  apiError(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.', headers);

export const dbUnavailable = () => apiError(503, 'unavailable', 'The database is not configured or unreachable. Try again later.');

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

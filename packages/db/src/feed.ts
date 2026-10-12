/** Pure feed helpers (no network): stages, filter parsing. Safe to import in the browser via `@kestrion/db/feed`. */

export type Stage = 'new' | 'near' | 'graduated';
export type RiskFilter = 'low' | 'caution' | 'high';
export type PairFilter = 'ETH' | 'USDG' | 'Other';
export type SortOrder = 'newest' | 'safest' | 'riskiest';

/** "Near graduation" = bonding progress at or above this %. */
export const NEAR_GRADUATION_PCT = 50;

export function stageOf(curve: { graduated: boolean; progressPct: number } | null): Stage {
  if (!curve) return 'new';
  if (curve.graduated) return 'graduated';
  return curve.progressPct >= NEAR_GRADUATION_PCT ? 'near' : 'new';
}

export const RISK_LABELS: Record<RiskFilter, string> = { low: 'Low risk', caution: 'Caution', high: 'High risk' };

export interface FeedQuery {
  stage?: Stage;
  pair?: PairFilter;
  risk?: RiskFilter;
  sort: SortOrder;
  /** Only launches at or after this time. */
  since?: Date;
  limit: number;
}

export const FEED_MAX_LIMIT = 100;
export const FEED_DEFAULT_LIMIT = 50;

/** Parse untrusted query-string values into a safe FeedQuery (unknown values are ignored). */
export function parseFeedQuery(params: URLSearchParams | Record<string, string | undefined>): FeedQuery {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k]) ?? undefined;
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
    v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

  const limitRaw = Number.parseInt(get('limit') ?? '', 10);
  const sinceRaw = get('since');
  let since: Date | undefined;
  if (sinceRaw) {
    const n = Number(sinceRaw);
    const d = Number.isFinite(n) && /^\d+$/.test(sinceRaw) ? new Date(n * (n < 1e12 ? 1000 : 1)) : new Date(sinceRaw);
    if (!Number.isNaN(d.getTime())) since = d;
  }
  return {
    stage: pick(get('stage'), ['new', 'near', 'graduated'] as const),
    pair: pick(get('pair'), ['ETH', 'USDG', 'Other'] as const),
    risk: pick(get('risk'), ['low', 'caution', 'high'] as const),
    sort: pick(get('sort'), ['newest', 'safest', 'riskiest'] as const) ?? 'newest',
    since,
    limit: Number.isFinite(limitRaw) ? Math.min(FEED_MAX_LIMIT, Math.max(1, limitRaw)) : FEED_DEFAULT_LIMIT,
  };
}

/** One row of the live feed (what the API returns and the home page renders). */
export interface FeedItem {
  address: string;
  name: string;
  symbol: string;
  logoCid: string | null;
  launchTime: string;
  pairType: PairFilter;
  pairSymbol: string;
  curveProgress: number | null;
  graduated: boolean;
  stage: Stage | null;
  score: number | null;
  label: string | null;
  lastScannedAt: string | null;
  factory: string;
}

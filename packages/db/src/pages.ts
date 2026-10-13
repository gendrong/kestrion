/** Read models for the creator page, /today and share images. */
import { RISK_LABELS, type FeedItem } from './feed';
import { FEED_COLUMNS, getFeed, toFeedItem, type Db } from './repo';

const lc = (a: string) => a.toLowerCase();

/** Scanned tokens launched by this wallet, newest first. */
export async function getCreatorTokens(db: Db, creator: string, limit = 200): Promise<FeedItem[]> {
  const n = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${FEED_COLUMNS} FROM tokens WHERE creator = ? AND score IS NOT NULL ORDER BY launch_time DESC LIMIT ${n}`,
    [lc(creator)],
  );
  return rows.map(toFeedItem);
}

export interface ScoreChangeItem {
  token: string;
  name: string;
  symbol: string;
  logoCid: string | null;
  oldScore: number;
  newScore: number;
  /** Current label of the token. */
  label: string | null;
  reason: string | null;
  changedAt: string;
}

export interface TodayData {
  since: string;
  /** Scanned launches in the window, per risk label. */
  counts: { total: number; low: number; caution: number; high: number };
  riskiest: FeedItem[];
  cleanest: FeedItem[];
  changes: ScoreChangeItem[];
}

/** Launches of the last `hours` hours: lowest and highest scores, and the biggest score changes. */
export async function getToday(db: Db, opts: { hours?: number; limit?: number; now?: number } = {}): Promise<TodayData> {
  const since = new Date((opts.now ?? Date.now()) - (opts.hours ?? 24) * 3_600_000);
  const limit = opts.limit ?? 10;
  const [countRows, riskiest, cleanest, changeRows] = await Promise.all([
    db.all<{ label: string; n: number }>(
      `SELECT label, COUNT(*) AS n FROM tokens WHERE launch_time >= ? AND score IS NOT NULL GROUP BY label`,
      [since.toISOString()],
    ),
    getFeed(db, { sort: 'riskiest', since, limit }),
    getFeed(db, { sort: 'safest', since, limit }),
    db.all<Record<string, unknown>>(
      `SELECT c.token, c.old_score, c.new_score, c.reason, c.changed_at, t.name, t.symbol, t.logo_cid, t.label
         FROM score_changes c JOIN tokens t ON t.address = c.token
        WHERE c.changed_at >= ?
        ORDER BY ABS(c.new_score - c.old_score) DESC, c.changed_at DESC
        LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`,
      [since.toISOString()],
    ),
  ]);
  const count = (label: string) => Number(countRows.find((r) => r.label === label)?.n ?? 0);
  const counts = { low: count(RISK_LABELS.low), caution: count(RISK_LABELS.caution), high: count(RISK_LABELS.high) };
  const total = counts.low + counts.caution + counts.high;
  // With few launches the two lists would overlap: split them (lower half / upper half) instead.
  const nRisky = Math.min(limit, Math.ceil(total / 2));
  const nClean = Math.min(limit, total - nRisky);
  return {
    since: since.toISOString(),
    counts: { total, ...counts },
    riskiest: riskiest.slice(0, nRisky),
    cleanest: cleanest.slice(0, nClean),
    changes: changeRows.map((r) => ({
      token: r.token as string,
      name: r.name as string,
      symbol: r.symbol as string,
      logoCid: (r.logo_cid as string | null) ?? null,
      oldScore: Number(r.old_score),
      newScore: Number(r.new_score),
      label: (r.label as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      changedAt: r.changed_at as string,
    })),
  };
}

/** Share images are kept only for tokens launched within this many days (older ones use the default image). */
export const OG_RETENTION_DAYS = 14;

export async function saveOgImage(db: Db, token: string, scannedAt: string, pngBase64: string): Promise<void> {
  await db.run(
    `INSERT INTO og_images (token, scanned_at, png_base64, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET scanned_at = excluded.scanned_at, png_base64 = excluded.png_base64, created_at = excluded.created_at`,
    [lc(token), scannedAt, pngBase64, new Date().toISOString()],
  );
}

export async function getOgImage(db: Db, token: string): Promise<{ pngBase64: string; scannedAt: string } | null> {
  const r = (await db.all<{ png_base64: string; scanned_at: string }>(`SELECT png_base64, scanned_at FROM og_images WHERE token = ? LIMIT 1`, [lc(token)]))[0];
  return r ? { pngBase64: r.png_base64, scannedAt: r.scanned_at } : null;
}

/** Delete share images of tokens launched before the retention window. Returns how many were removed. */
export async function pruneOgImages(db: Db, now = Date.now()): Promise<number> {
  const before = new Date(now - OG_RETENTION_DAYS * 86_400_000).toISOString();
  const r = await db.run(`DELETE FROM og_images WHERE token IN (SELECT address FROM tokens WHERE launch_time < ?)`, [before]);
  return r.changes;
}

export interface RescanCandidate {
  address: string;
  depth: 'quick' | 'full';
  watched: boolean;
}

/**
 * Tokens due for a rescan: every watched token not scanned within `watchedEveryMs`, then tokens launched in the last
 * `recentHours` not scanned within `recentEveryMs` (least recently scanned first).
 */
export async function rescanCandidates(
  db: Db,
  opts: { watchedEveryMs: number; recentHours: number; recentEveryMs: number; limit: number; now?: number },
): Promise<RescanCandidate[]> {
  const now = opts.now ?? Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const n = Math.max(1, Math.min(500, Math.floor(opts.limit)));
  const [watched, recent] = await Promise.all([
    db.all<{ address: string; scan_depth: string | null }>(
      `SELECT address, scan_depth FROM tokens
        WHERE address IN (SELECT DISTINCT token FROM watchlist) AND (last_scanned_at IS NULL OR last_scanned_at < ?)
        ORDER BY last_scanned_at LIMIT ${n}`,
      [iso(now - opts.watchedEveryMs)],
    ),
    db.all<{ address: string; scan_depth: string | null }>(
      `SELECT address, scan_depth FROM tokens
        WHERE launch_time >= ? AND last_scanned_at < ? AND address NOT IN (SELECT DISTINCT token FROM watchlist)
        ORDER BY last_scanned_at LIMIT ${n}`,
      [iso(now - opts.recentHours * 3_600_000), iso(now - opts.recentEveryMs)],
    ),
  ]);
  const depth = (d: string | null) => (d === 'quick' ? 'quick' : 'full') as 'quick' | 'full';
  return [
    ...watched.map((r) => ({ address: r.address, depth: depth(r.scan_depth), watched: true })),
    ...recent.map((r) => ({ address: r.address, depth: depth(r.scan_depth), watched: false })),
  ].slice(0, n);
}

export interface ScorePoint {
  scannedAt: string;
  score: number;
  label: string;
  engineVersion: string;
}

/** Every stored scan's score for a token, oldest first (the report page's score history). */
export async function getScoreHistory(db: Db, token: string, limit = 100): Promise<ScorePoint[]> {
  const rows = await db.all<{ scanned_at: string; score: number; label: string; engine_version: string }>(
    `SELECT scanned_at, score, label, engine_version FROM scans WHERE token = ? ORDER BY scanned_at DESC, id DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`,
    [lc(token)],
  );
  return rows.reverse().map((r) => ({ scannedAt: r.scanned_at, score: Number(r.score), label: r.label, engineVersion: r.engine_version }));
}

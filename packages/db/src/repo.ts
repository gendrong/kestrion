/** Typed database access used by the website and the jobs (D1 / SQLite). Addresses are stored lower-case. */
import { RISK_LABELS, type FeedItem, type FeedQuery, type Stage } from './feed';
import type { SqlClient, SqlValue } from './sql';

export type Db = SqlClient;

const lc = (a: string) => a.toLowerCase();
const nowIso = () => new Date().toISOString();
const parseJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
/** LIMIT can't be bound as a string parameter over the D1 HTTP API, so it is inlined as a clamped integer. */
const limitOf = (n: number, max = 100) => Math.max(1, Math.min(max, Math.floor(Number.isFinite(n) ? n : 1)));

/** What the jobs store for one scan (built from the engine's FullScan). */
export interface ScanRecord {
  token: {
    address: string;
    launchpad: string;
    factory: string;
    name: string;
    symbol: string;
    creator: string;
    deployer: string;
    paired_token: string;
    pair_type: 'ETH' | 'USDG' | 'Other';
    pair_symbol: string;
    pool: string | null;
    launch_block: string;
    launch_time: string;
    metadata: { logoCid: string | null } & Record<string, unknown>;
  };
  scan: {
    scanned_at: string;
    score: number;
    label: string;
    checks: unknown;
    /** Full report; its `checks` are stored separately (not twice). */
    report: Record<string, unknown>;
    engine_version: string;
    summary: string;
    curve_progress: number | null;
    graduated: boolean;
    stage: Stage;
    change_reason?: string;
  };
}

/**
 * Save one scan atomically (one D1 batch = one transaction): upsert the token, record a score change if the
 * score moved, insert the scan, copy its summary onto the token, and mark a queued request as done.
 */
export async function recordScan(db: Db, rec: ScanRecord): Promise<void> {
  const t = rec.token;
  const s = rec.scan;
  const address = lc(t.address);
  const { checks: _omit, ...reportWithoutChecks } = s.report;
  await db.batch([
    {
      sql: `INSERT INTO tokens (address, launchpad, factory, name, symbol, creator, deployer, paired_token, pair_type, pair_symbol,
                                pool, launch_block, launch_time, metadata, logo_cid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET
              name = excluded.name, symbol = excluded.symbol, metadata = excluded.metadata, logo_cid = excluded.logo_cid`,
      params: [
        address, t.launchpad, t.factory, t.name, t.symbol, lc(t.creator), lc(t.deployer), lc(t.paired_token), t.pair_type,
        t.pair_symbol, t.pool ? lc(t.pool) : null, t.launch_block, t.launch_time, JSON.stringify(t.metadata), t.metadata.logoCid ?? null,
      ],
    },
    {
      // Uses the token's previous score (the update below runs after this statement).
      sql: `INSERT INTO score_changes (token, old_score, new_score, reason, changed_at)
            SELECT address, score, ?, ?, ? FROM tokens WHERE address = ? AND score IS NOT NULL AND score <> ?`,
      params: [s.score, s.change_reason ?? null, s.scanned_at, address, s.score],
    },
    {
      sql: `INSERT INTO scans (token, scanned_at, score, label, checks, report, engine_version, summary)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [address, s.scanned_at, s.score, s.label, JSON.stringify(s.checks), JSON.stringify(reportWithoutChecks), s.engine_version, s.summary],
    },
    {
      sql: `UPDATE tokens SET
              latest_scan_id = (SELECT id FROM scans WHERE token = ? ORDER BY id DESC LIMIT 1),
              score = ?, label = ?, curve_progress = ?, graduated = ?, stage = ?, last_scanned_at = ?
            WHERE address = ?`,
      params: [address, s.score, s.label, s.curve_progress, s.graduated ? 1 : 0, s.stage, s.scanned_at, address],
    },
    {
      sql: `UPDATE scan_requests SET status = 'done', error = NULL, updated_at = ? WHERE token = ?`,
      params: [nowIso(), address],
    },
  ]);
}

export interface LatestScan<R = unknown> {
  report: R;
  scannedAt: string;
}

export async function getLatestScan<R = unknown>(db: Db, address: string): Promise<LatestScan<R> | null> {
  const rows = await db.all<{ report: string; checks: string; scanned_at: string }>(
    `SELECT report, checks, scanned_at FROM scans WHERE token = ? ORDER BY scanned_at DESC, id DESC LIMIT 1`,
    [lc(address)],
  );
  const row = rows[0];
  if (!row) return null;
  const report = { ...parseJson<Record<string, unknown>>(row.report, {}), checks: parseJson<unknown[]>(row.checks, []) };
  return { report: report as R, scannedAt: row.scanned_at };
}

export async function isScanned(db: Db, address: string): Promise<boolean> {
  const rows = await db.all(`SELECT 1 AS x FROM tokens WHERE address = ? AND last_scanned_at IS NOT NULL LIMIT 1`, [lc(address)]);
  return rows.length > 0;
}

export async function getFeed(db: Db, q: FeedQuery): Promise<FeedItem[]> {
  const where = ['score IS NOT NULL'];
  const params: SqlValue[] = [];
  if (q.stage) (where.push('stage = ?'), params.push(q.stage));
  if (q.pair) (where.push('pair_type = ?'), params.push(q.pair));
  if (q.risk) (where.push('label = ?'), params.push(RISK_LABELS[q.risk]));
  if (q.since) (where.push('launch_time >= ?'), params.push(q.since.toISOString()));
  const order =
    q.sort === 'safest' ? 'score DESC, launch_time DESC' : q.sort === 'riskiest' ? 'score ASC, launch_time DESC' : 'launch_time DESC';
  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${FEED_COLUMNS} FROM tokens WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limitOf(q.limit)}`,
    params,
  );
  return rows.map(toFeedItem);
}

/** Columns needed for a FeedItem (see toFeedItem). */
export const FEED_COLUMNS = `address, name, symbol, logo_cid, launch_time, pair_type, pair_symbol, curve_progress, graduated, stage, score, label,
  last_scanned_at, factory, creator`;

export function toFeedItem(r: Record<string, unknown>): FeedItem {
  return {
    address: r.address as string,
    name: r.name as string,
    symbol: r.symbol as string,
    logoCid: (r.logo_cid as string | null) ?? null,
    launchTime: r.launch_time as string,
    pairType: r.pair_type as FeedItem['pairType'],
    pairSymbol: r.pair_symbol as string,
    curveProgress: r.curve_progress === null || r.curve_progress === undefined ? null : Number(r.curve_progress),
    graduated: Number(r.graduated) === 1,
    stage: (r.stage as Stage | null) ?? null,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    label: (r.label as string | null) ?? null,
    lastScannedAt: (r.last_scanned_at as string | null) ?? null,
    factory: r.factory as string,
    creator: r.creator as string,
  };
}

export type ScanRequestStatus = 'queued' | 'scanning' | 'done' | 'failed' | 'not_a_launch';

/** `error` of a not_a_launch request whose address turned out to be a wallet (the website redirects to its creator page). */
export const WALLET_MARK = 'wallet';

export interface ScanRequest {
  token: string;
  status: ScanRequestStatus;
  attempts: number;
  error: string | null;
  requested_at: string;
  updated_at: string;
}

const toRequest = (r: Record<string, unknown>): ScanRequest => ({
  token: r.token as string,
  status: r.status as ScanRequestStatus,
  attempts: Number(r.attempts),
  error: (r.error as string | null) ?? null,
  requested_at: r.requested_at as string,
  updated_at: r.updated_at as string,
});

export async function getScanRequest(db: Db, address: string): Promise<ScanRequest | null> {
  const rows = await db.all(`SELECT * FROM scan_requests WHERE token = ? LIMIT 1`, [lc(address)]);
  return rows[0] ? toRequest(rows[0]) : null;
}

/**
 * Ask the jobs to scan a token. New requests are queued; failed ones are re-queued (max 3 attempts);
 * queued/scanning/done/not_a_launch requests are left alone. Returns the current request.
 */
export async function enqueueScan(db: Db, address: string): Promise<ScanRequest> {
  const token = lc(address);
  const now = nowIso();
  const [, , rows] = await db.batch([
    { sql: `INSERT OR IGNORE INTO scan_requests (token, requested_at, status, attempts, updated_at) VALUES (?, ?, 'queued', 0, ?)`, params: [token, now, now] },
    { sql: `UPDATE scan_requests SET status = 'queued', updated_at = ? WHERE token = ? AND status = 'failed' AND attempts < 3`, params: [now, token] },
    { sql: `SELECT * FROM scan_requests WHERE token = ?`, params: [token] },
  ]);
  const row = rows?.[0];
  if (!row) throw new Error('enqueueScan: request not found after insert');
  return toRequest(row);
}

/** Take up to `limit` queued requests (or ones stuck in 'scanning' for 20+ minutes). */
export async function claimScanRequests(db: Db, limit: number): Promise<ScanRequest[]> {
  const now = nowIso();
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  const rows = await db.all(
    `UPDATE scan_requests SET status = 'scanning', attempts = attempts + 1, updated_at = ?
      WHERE token IN (
        SELECT token FROM scan_requests
         WHERE status = 'queued' OR (status = 'scanning' AND updated_at < ?)
         ORDER BY requested_at LIMIT ${limitOf(limit, 20)})
      RETURNING *`,
    [now, stale],
  );
  return rows.map(toRequest);
}

export async function finishScanRequest(db: Db, address: string, status: Exclude<ScanRequestStatus, 'scanning'>, error?: string) {
  await db.run(`UPDATE scan_requests SET status = ?, error = ?, updated_at = ? WHERE token = ?`, [
    status,
    error?.slice(0, 500) ?? null,
    nowIso(),
    lc(address),
  ]);
}

export interface JobState {
  job: string;
  last_block: number | null;
  last_run: string | null;
  status: string | null;
  error: string | null;
  stats: Record<string, unknown>;
}

export async function getJobState(db: Db, job: string): Promise<JobState | null> {
  const r = (await db.all(`SELECT * FROM job_state WHERE job = ? LIMIT 1`, [job]))[0];
  if (!r) return null;
  return {
    job: r.job as string,
    last_block: r.last_block === null || r.last_block === undefined ? null : Number(r.last_block),
    last_run: (r.last_run as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    stats: parseJson(r.stats, {}),
  };
}

/** Upsert a job's state. Fields left out keep their stored value. */
export async function setJobState(db: Db, job: string, patch: Partial<Omit<JobState, 'job' | 'last_run'>>) {
  await db.run(
    `INSERT INTO job_state (job, last_block, last_run, status, error, stats) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (job) DO UPDATE SET
       last_block = COALESCE(excluded.last_block, job_state.last_block),
       last_run = excluded.last_run,
       status = COALESCE(excluded.status, job_state.status),
       error = excluded.error,
       stats = CASE WHEN ? THEN excluded.stats ELSE job_state.stats END`,
    [
      job,
      patch.last_block ?? null,
      nowIso(),
      patch.status ?? null,
      patch.error ?? null,
      JSON.stringify(patch.stats ?? {}),
      patch.stats ? 1 : 0,
    ],
  );
}

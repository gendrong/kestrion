/** API keys, report flags and the admin page's data. */
import type { User } from './accounts';
import type { Db, JobState } from './repo';
import { tierOf, type Tier } from './tiers';

const lc = (a: string) => a.toLowerCase();
const nowIso = () => new Date().toISOString();

// ── API keys ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Active keys one account may have at the same time. */
export const MAX_API_KEYS = 5;

export interface ApiKeyInfo {
  id: number;
  name: string;
  prefix: string;
  tier: Tier;
  createdAt: string;
  lastUsed: string | null;
}

/** Store a new key (the caller generated it and shows it once). Null when the user already has the maximum. */
export async function createApiKey(db: Db, user: User, keyHash: string, prefix: string, name: string): Promise<number | null> {
  const rows = await db.all<{ id: number }>(
    `INSERT INTO api_keys (user_wallet, key_hash, tier, name, prefix)
     SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM api_keys WHERE user_wallet = ? AND revoked_at IS NULL) < ?
     RETURNING id`,
    [lc(user.wallet), keyHash, user.tier, name.slice(0, 60), prefix, lc(user.wallet), MAX_API_KEYS],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function listApiKeys(db: Db, wallet: string): Promise<ApiKeyInfo[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, name, prefix, tier, created_at, last_used FROM api_keys WHERE user_wallet = ? AND revoked_at IS NULL ORDER BY id DESC`,
    [lc(wallet)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: (r.name as string) || 'API key',
    prefix: r.prefix as string,
    tier: tierOf(r.tier as string),
    createdAt: r.created_at as string,
    lastUsed: (r.last_used as string | null) ?? null,
  }));
}

export async function revokeApiKey(db: Db, wallet: string, id: number): Promise<boolean> {
  const r = await db.run(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_wallet = ? AND revoked_at IS NULL`, [nowIso(), id, lc(wallet)]);
  return r.changes > 0;
}

/** Only touch last_used this often (one database write per key per few minutes, not per request). */
const LAST_USED_EVERY_MS = 5 * 60_000;

/** The active key with this hash (and mark it used), or null. */
export async function useApiKey(db: Db, keyHash: string): Promise<{ id: number; wallet: string; tier: Tier } | null> {
  const r = (
    await db.all<Record<string, unknown>>(
      `SELECT k.id, k.user_wallet, u.tier, k.last_used FROM api_keys k JOIN users u ON u.wallet = k.user_wallet
        WHERE k.key_hash = ? AND k.revoked_at IS NULL LIMIT 1`,
      [keyHash],
    )
  )[0];
  if (!r) return null;
  const last = r.last_used ? Date.parse(r.last_used as string) : 0;
  if (Date.now() - last > LAST_USED_EVERY_MS) await db.run(`UPDATE api_keys SET last_used = ? WHERE id = ?`, [nowIso(), Number(r.id)]).catch(() => {});
  return { id: Number(r.id), wallet: r.user_wallet as string, tier: tierOf(r.tier as string) };
}

// ── Flags ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FlagType = 'false_positive' | 'missed_risk';
export type FlagStatus = 'open' | 'reviewed' | 'dismissed';

export interface Flag {
  id: number;
  token: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  score: number | null;
  wallet: string | null;
  type: FlagType;
  note: string | null;
  status: FlagStatus;
  createdAt: string;
  reviewedAt: string | null;
}

/** Flag a report. One open flag per user, token and type (a repeat updates the note). */
export async function createFlag(db: Db, user: User, token: string, type: FlagType, note: string | null): Promise<void> {
  const clean = note?.trim().slice(0, 1000) || null;
  const [, existing] = await db.batch([
    {
      sql: `UPDATE flags SET note = ?, created_at = ? WHERE token = ? AND user_wallet = ? AND type = ? AND status = 'open'`,
      params: [clean, nowIso(), lc(token), lc(user.wallet), type],
    },
    { sql: `SELECT id FROM flags WHERE token = ? AND user_wallet = ? AND type = ? AND status = 'open' LIMIT 1`, params: [lc(token), lc(user.wallet), type] },
  ]);
  if (existing && existing.length > 0) return;
  await db.run(`INSERT INTO flags (token, user_wallet, type, note) VALUES (?, ?, ?, ?)`, [lc(token), lc(user.wallet), type, clean]);
}

export async function listFlags(db: Db, status: FlagStatus | 'all' = 'open', limit = 100): Promise<Flag[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT f.*, t.name AS t_name, t.symbol AS t_symbol, t.score AS t_score FROM flags f LEFT JOIN tokens t ON t.address = f.token
      ${status === 'all' ? '' : 'WHERE f.status = ?'} ORDER BY f.created_at DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`,
    status === 'all' ? [] : [status],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    token: r.token as string,
    tokenName: (r.t_name as string | null) ?? null,
    tokenSymbol: (r.t_symbol as string | null) ?? null,
    score: r.t_score === null || r.t_score === undefined ? null : Number(r.t_score),
    wallet: (r.user_wallet as string | null) ?? null,
    type: r.type as FlagType,
    note: (r.note as string | null) ?? null,
    status: r.status as FlagStatus,
    createdAt: r.created_at as string,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
  }));
}

export async function setFlagStatus(db: Db, id: number, status: FlagStatus, admin: string): Promise<void> {
  await db.run(`UPDATE flags SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`, [status, nowIso(), lc(admin), id]);
}

// ── Admin overview ───────────────────────────────────────────────────────────────────────────────────────────────

export interface AdminOverview {
  jobs: JobState[];
  /** Tokens per score decile (0–9, 10–19, … 90–100). */
  distribution: number[];
  counts: { tokens: number; scans24h: number; quick: number; queued: number; failed: number; users: number; openFlags: number; indexed: number };
}

export async function adminOverview(db: Db): Promise<AdminOverview> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [jobs, dist, counts] = await db.batch([
    { sql: `SELECT * FROM job_state ORDER BY job` },
    { sql: `SELECT MIN(score / 10, 9) AS bucket, COUNT(*) AS n FROM tokens WHERE score IS NOT NULL GROUP BY bucket` },
    {
      sql: `SELECT (SELECT COUNT(*) FROM tokens WHERE score IS NOT NULL) AS tokens,
                   (SELECT COUNT(*) FROM scans WHERE scanned_at >= ?) AS scans24h,
                   (SELECT COUNT(*) FROM tokens WHERE scan_depth = 'quick') AS quick,
                   (SELECT COUNT(*) FROM scan_requests WHERE status IN ('queued', 'scanning')) AS queued,
                   (SELECT COUNT(*) FROM scan_requests WHERE status = 'failed') AS failed,
                   (SELECT COUNT(*) FROM users) AS users,
                   (SELECT COUNT(*) FROM flags WHERE status = 'open') AS open_flags,
                   (SELECT COUNT(*) FROM launch_index) AS indexed`,
      params: [dayAgo],
    },
  ]);
  const distribution = Array.from({ length: 10 }, () => 0);
  for (const r of dist ?? []) distribution[Math.max(0, Math.min(9, Number(r.bucket)))] = Number(r.n);
  const c = (counts ?? [])[0] ?? {};
  const n = (k: string) => Number(c[k] ?? 0);
  return {
    jobs: (jobs ?? []).map((r) => ({
      job: r.job as string,
      last_block: r.last_block === null || r.last_block === undefined ? null : Number(r.last_block),
      last_run: (r.last_run as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      error: (r.error as string | null) ?? null,
      stats: (() => {
        try {
          return JSON.parse(String(r.stats ?? '{}')) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    })),
    distribution,
    counts: {
      tokens: n('tokens'),
      scans24h: n('scans24h'),
      quick: n('quick'),
      queued: n('queued'),
      failed: n('failed'),
      users: n('users'),
      openFlags: n('open_flags'),
      indexed: n('indexed'),
    },
  };
}

// ── Optional AI summaries ────────────────────────────────────────────────────────────────────────────────────────

/** Store the AI summary of the token's latest scan (written by the jobs). */
export async function saveAiSummary(db: Db, token: string, scannedAt: string, summary: string): Promise<void> {
  await db.run(`UPDATE scans SET ai_summary = ? WHERE token = ? AND scanned_at = ?`, [summary.slice(0, 600), lc(token), scannedAt]);
}

export async function getAiSummary(db: Db, token: string): Promise<string | null> {
  const r = (await db.all<{ ai_summary: string | null }>(`SELECT ai_summary FROM scans WHERE token = ? ORDER BY scanned_at DESC, id DESC LIMIT 1`, [lc(token)]))[0];
  return r?.ai_summary ?? null;
}

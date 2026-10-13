/** Accounts: SIWE nonces, sessions, watchlist, followed creators and notifications. Wallets are stored lower-case. */
import type { FeedItem } from './feed';
import { FEED_COLUMNS, toFeedItem, type Db } from './repo';
import { TIERS, tierOf, type Tier } from './tiers';

const lc = (a: string) => a.toLowerCase();
const nowIso = () => new Date().toISOString();

// ── SIWE nonces ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A nonce is valid this long after it was handed out. */
export const NONCE_TTL_MS = 10 * 60_000;

export async function saveNonce(db: Db, nonce: string): Promise<void> {
  await db.run(`INSERT INTO siwe_nonces (nonce, created_at) VALUES (?, ?)`, [nonce, nowIso()]);
}

/** Mark a nonce used. True only for a nonce we issued, that is fresh and was never used before. */
export async function consumeNonce(db: Db, nonce: string): Promise<boolean> {
  const fresh = new Date(Date.now() - NONCE_TTL_MS).toISOString();
  const rows = await db.all(
    `UPDATE siwe_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND created_at >= ? RETURNING nonce`,
    [nowIso(), nonce, fresh],
  );
  return rows.length === 1;
}

// ── Users & sessions ─────────────────────────────────────────────────────────────────────────────────────────────

export interface User {
  wallet: string;
  tier: Tier;
  createdAt: string;
}

const toUser = (r: Record<string, unknown>): User => ({
  wallet: r.wallet as string,
  tier: tierOf(r.tier as string | null),
  createdAt: r.created_at as string,
});

/** The users row for this wallet, created on first sign-in (tier Free). */
export async function upsertUser(db: Db, wallet: string): Promise<User> {
  const [, rows] = await db.batch([
    { sql: `INSERT OR IGNORE INTO users (wallet) VALUES (?)`, params: [lc(wallet)] },
    { sql: `SELECT * FROM users WHERE wallet = ?`, params: [lc(wallet)] },
  ]);
  const r = rows?.[0];
  if (!r) throw new Error('upsertUser: user not found after insert');
  return toUser(r);
}

/** Sessions last this long. */
export const SESSION_TTL_MS = 30 * 86_400_000;

export async function createSession(db: Db, wallet: string, idHash: string): Promise<void> {
  const now = Date.now();
  await db.run(`INSERT INTO sessions (id_hash, user_wallet, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`, [
    idHash,
    lc(wallet),
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString(),
    new Date(now).toISOString(),
  ]);
}

/** The signed-in user for a session (null when unknown or expired). */
export async function getSessionUser(db: Db, idHash: string): Promise<User | null> {
  const r = (
    await db.all(
      `SELECT u.* FROM sessions s JOIN users u ON u.wallet = s.user_wallet WHERE s.id_hash = ? AND s.expires_at > ? LIMIT 1`,
      [idHash, nowIso()],
    )
  )[0];
  return r ? toUser(r) : null;
}

export async function deleteSession(db: Db, idHash: string): Promise<void> {
  await db.run(`DELETE FROM sessions WHERE id_hash = ?`, [idHash]);
}

/** Housekeeping for the jobs: expired sessions and old nonces. */
export async function pruneAuth(db: Db): Promise<void> {
  const now = nowIso();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  await db.batch([
    { sql: `DELETE FROM sessions WHERE expires_at < ?`, params: [now] },
    { sql: `DELETE FROM siwe_nonces WHERE created_at < ?`, params: [dayAgo] },
  ]);
}

// ── Watchlist & follows ──────────────────────────────────────────────────────────────────────────────────────────

export type AddResult = { ok: true } | { ok: false; reason: 'limit'; limit: number };

async function addWithLimit(db: Db, table: 'watchlist' | 'followed_creators', column: 'token' | 'creator', user: User, value: string, limit: number): Promise<AddResult> {
  // One statement: insert only while the user is under the limit (no race between count and insert).
  const r = await db.run(
    `INSERT OR IGNORE INTO ${table} (user_wallet, ${column})
     SELECT ?, ? WHERE (SELECT COUNT(*) FROM ${table} WHERE user_wallet = ?) < ?`,
    [lc(user.wallet), lc(value), lc(user.wallet), limit],
  );
  if (r.changes > 0) return { ok: true };
  const exists = await db.all(`SELECT 1 AS x FROM ${table} WHERE user_wallet = ? AND ${column} = ? LIMIT 1`, [lc(user.wallet), lc(value)]);
  return exists.length > 0 ? { ok: true } : { ok: false, reason: 'limit', limit };
}

/** Watch a scanned token (the token must exist in `tokens`). */
export const addToWatchlist = (db: Db, user: User, token: string) => addWithLimit(db, 'watchlist', 'token', user, token, TIERS[user.tier].watchlist);
export const followCreator = (db: Db, user: User, creator: string) => addWithLimit(db, 'followed_creators', 'creator', user, creator, TIERS[user.tier].follows);

export async function removeFromWatchlist(db: Db, user: User, token: string) {
  await db.run(`DELETE FROM watchlist WHERE user_wallet = ? AND token = ?`, [lc(user.wallet), lc(token)]);
}
export async function unfollowCreator(db: Db, user: User, creator: string) {
  await db.run(`DELETE FROM followed_creators WHERE user_wallet = ? AND creator = ?`, [lc(user.wallet), lc(creator)]);
}

export async function isWatching(db: Db, wallet: string, token: string): Promise<boolean> {
  return (await db.all(`SELECT 1 AS x FROM watchlist WHERE user_wallet = ? AND token = ? LIMIT 1`, [lc(wallet), lc(token)])).length > 0;
}
export async function isFollowing(db: Db, wallet: string, creator: string): Promise<boolean> {
  return (await db.all(`SELECT 1 AS x FROM followed_creators WHERE user_wallet = ? AND creator = ? LIMIT 1`, [lc(wallet), lc(creator)])).length > 0;
}

export interface WatchedToken extends FeedItem {
  addedAt: string;
  /** The latest score change since the token was added, if any. */
  change: { oldScore: number; newScore: number; changedAt: string; reason: string | null } | null;
}

export async function listWatchlist(db: Db, wallet: string): Promise<WatchedToken[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT ${FEED_COLUMNS.split(',').map((c) => `t.${c.trim()}`).join(', ')}, w.created_at AS added_at,
            c.old_score, c.new_score, c.changed_at, c.reason
       FROM watchlist w
       JOIN tokens t ON t.address = w.token
       LEFT JOIN score_changes c ON c.id = (
         SELECT id FROM score_changes WHERE token = w.token AND changed_at >= w.created_at ORDER BY changed_at DESC, id DESC LIMIT 1)
      WHERE w.user_wallet = ?
      ORDER BY w.created_at DESC`,
    [lc(wallet)],
  );
  return rows.map((r) => ({
    ...toFeedItem(r),
    addedAt: r.added_at as string,
    change:
      r.old_score === null || r.old_score === undefined
        ? null
        : { oldScore: Number(r.old_score), newScore: Number(r.new_score), changedAt: r.changed_at as string, reason: (r.reason as string | null) ?? null },
  }));
}

export interface FollowedCreator {
  creator: string;
  followedAt: string;
  launches: number | null;
  lastLaunch: { token: string; name: string; symbol: string; score: number | null; label: string | null; launchTime: string } | null;
}

export async function listFollowedCreators(db: Db, wallet: string): Promise<FollowedCreator[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT f.creator, f.created_at, c.total_launches,
            t.address AS t_address, t.name AS t_name, t.symbol AS t_symbol, t.score AS t_score, t.label AS t_label, t.launch_time AS t_time
       FROM followed_creators f
       LEFT JOIN creators c ON c.address = f.creator
       LEFT JOIN tokens t ON t.address = (SELECT address FROM tokens WHERE creator = f.creator ORDER BY launch_time DESC LIMIT 1)
      WHERE f.user_wallet = ?
      ORDER BY f.created_at DESC`,
    [lc(wallet)],
  );
  return rows.map((r) => ({
    creator: r.creator as string,
    followedAt: r.created_at as string,
    launches: r.total_launches === null || r.total_launches === undefined ? null : Number(r.total_launches),
    lastLaunch: r.t_address
      ? {
          token: r.t_address as string,
          name: r.t_name as string,
          symbol: r.t_symbol as string,
          score: r.t_score === null ? null : Number(r.t_score),
          label: (r.t_label as string | null) ?? null,
          launchTime: r.t_time as string,
        }
      : null,
  }));
}

/** Every watched token (the rescan job checks them every hour). */
export async function watchedTokens(db: Db): Promise<string[]> {
  return (await db.all<{ token: string }>(`SELECT DISTINCT token FROM watchlist`)).map((r) => r.token);
}

// ── Notifications ────────────────────────────────────────────────────────────────────────────────────────────────

export type NotificationType = 'score_changed' | 'creator_launched';

export interface Notification {
  id: number;
  type: NotificationType;
  token: string | null;
  creator: string | null;
  message: string;
  createdAt: string;
  readAt: string | null;
}

/** Tell everyone following one of these creator wallets that it launched `token` (once per user and token). */
export async function notifyCreatorLaunch(db: Db, creators: string[], token: string, message: string): Promise<number> {
  const list = [...new Set(creators.map(lc))].slice(0, 10);
  if (list.length === 0) return 0;
  const r = await db.run(
    `INSERT INTO notifications (user_wallet, type, token, creator, message, created_at)
     SELECT DISTINCT f.user_wallet, 'creator_launched', ?, f.creator, ?, ?
       FROM followed_creators f
      WHERE f.creator IN (${list.map(() => '?').join(', ')})
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_wallet = f.user_wallet AND n.type = 'creator_launched' AND n.token = ?)
      GROUP BY f.user_wallet`,
    [lc(token), message.slice(0, 300), nowIso(), ...list, lc(token)],
  );
  return r.changes;
}

export async function listNotifications(db: Db, wallet: string, limit = 50): Promise<Notification[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT * FROM notifications WHERE user_wallet = ? ORDER BY created_at DESC, id DESC LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}`,
    [lc(wallet)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type as NotificationType,
    token: (r.token as string | null) ?? null,
    creator: (r.creator as string | null) ?? null,
    message: r.message as string,
    createdAt: r.created_at as string,
    readAt: (r.read_at as string | null) ?? null,
  }));
}

export async function unreadCount(db: Db, wallet: string): Promise<number> {
  const [r] = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_wallet = ? AND read_at IS NULL`, [lc(wallet)]);
  return Number(r?.n ?? 0);
}

/** Mark some (or all, when `ids` is omitted) of a user's notifications as read. */
export async function markNotificationsRead(db: Db, wallet: string, ids?: number[]): Promise<void> {
  const now = nowIso();
  if (!ids) {
    await db.run(`UPDATE notifications SET read_at = ? WHERE user_wallet = ? AND read_at IS NULL`, [now, lc(wallet)]);
    return;
  }
  const list = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 90);
  if (list.length === 0) return;
  await db.run(`UPDATE notifications SET read_at = ? WHERE user_wallet = ? AND read_at IS NULL AND id IN (${list.map(() => '?').join(', ')})`, [
    now,
    lc(wallet),
    ...list,
  ]);
}

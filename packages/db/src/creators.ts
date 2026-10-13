/** Creators: what the jobs learned about each launching wallet, plus on-demand lookups of unknown wallets. */
import type { Db } from './repo';

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

/** Max launches / linked wallets kept per creator. */
export const CREATOR_MAX_LAUNCHES = 200;
export const CREATOR_MAX_LINKED = 100;

export interface CreatorLaunchRow {
  token: string;
  factoryId: string;
  launchBlock: string;
  launchTime: string | null;
  name?: string;
  symbol?: string;
  graduated?: boolean | null;
  /** null = outcome unknown. */
  diedFast?: boolean | null;
}

export interface LinkedWalletRow {
  address: string;
  reasons: string[];
  /** Tokens whose scan linked this wallet to the creator (most recent first, max 5). */
  seenIn: string[];
}

/** One scan's view of the creator (the engine's CreatorSnapshot, JSON-safe). */
export interface CreatorSnapshotInput {
  address: string;
  firstSeen: string | null;
  fundingSource: string | null;
  funder: string | null;
  funderLabel: string | null;
  launches: CreatorLaunchRow[] | null;
  searchPartial: boolean;
  linkedWallets: { address: string; reasons: string[] }[] | null;
}

export interface Creator {
  address: string;
  firstSeen: string | null;
  fundingSource: string | null;
  funder: string | null;
  funderLabel: string | null;
  /** Launches found on-chain (including scanned ones). null = never searched successfully. */
  totalLaunches: number | null;
  searchPartial: boolean;
  launches: CreatorLaunchRow[];
  linkedWallets: LinkedWalletRow[];
  updatedAt: string | null;
}

/**
 * Combine what we knew with a new scan's snapshot. A successful launch search is a full on-chain list, so it
 * replaces the old one, but details (names, outcomes) the new scan didn't analyse are kept from before.
 * Linked wallets accumulate across scans of the creator's tokens.
 */
export function mergeCreator(old: Creator | null, snap: CreatorSnapshotInput, token: string, observedAt: string): Creator {
  const oldLaunches = new Map((old?.launches ?? []).map((l) => [lc(l.token), l]));
  let launches = old?.launches ?? [];
  if (snap.launches) {
    const fresh = snap.launches.map((l) => {
      const o = oldLaunches.get(lc(l.token));
      return {
        ...o,
        // null = "unknown in this scan": keep what an earlier scan knew.
        ...Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined && v !== null)),
        token: lc(l.token),
      } as CreatorLaunchRow;
    });
    const seen = new Set(fresh.map((l) => l.token));
    // Keep launches an earlier search found but this one missed (e.g. it was capped).
    const kept = (old?.launches ?? []).filter((l) => !seen.has(lc(l.token)));
    launches = [...fresh, ...kept]
      .sort((a, b) => (BigInt(a.launchBlock) > BigInt(b.launchBlock) ? -1 : BigInt(a.launchBlock) < BigInt(b.launchBlock) ? 1 : 0))
      .slice(0, CREATOR_MAX_LAUNCHES);
  }

  const linked = new Map((old?.linkedWallets ?? []).map((w) => [lc(w.address), { ...w, reasons: [...w.reasons], seenIn: [...w.seenIn] }]));
  for (const w of snap.linkedWallets ?? []) {
    const k = lc(w.address);
    const cur = linked.get(k) ?? { address: k, reasons: [], seenIn: [] };
    for (const r of w.reasons) if (!cur.reasons.includes(r)) cur.reasons.push(r);
    cur.seenIn = [lc(token), ...cur.seenIn.filter((t) => t !== lc(token))].slice(0, 5);
    linked.set(k, cur);
  }

  return {
    address: lc(snap.address),
    firstSeen: snap.firstSeen ?? old?.firstSeen ?? null,
    fundingSource: snap.fundingSource ?? old?.fundingSource ?? null,
    funder: snap.funder ? lc(snap.funder) : (old?.funder ?? null),
    funderLabel: snap.funder ? snap.funderLabel : (old?.funderLabel ?? null),
    totalLaunches: snap.launches ? launches.length : (old?.totalLaunches ?? null),
    searchPartial: snap.launches ? snap.searchPartial : (old?.searchPartial ?? false),
    launches,
    linkedWallets: [...linked.values()].slice(0, CREATOR_MAX_LINKED),
    updatedAt: observedAt,
  };
}

function toCreator(r: Record<string, unknown>): Creator {
  const stats = parseJson<{ funder?: string | null; funderLabel?: string | null; searchPartial?: boolean; launches?: CreatorLaunchRow[]; linkedWallets?: LinkedWalletRow[] }>(r.stats, {});
  return {
    address: r.address as string,
    firstSeen: (r.first_seen as string | null) ?? null,
    fundingSource: (r.funding_source as string | null) ?? null,
    funder: stats.funder ?? null,
    funderLabel: stats.funderLabel ?? null,
    totalLaunches: r.total_launches === null || r.total_launches === undefined ? null : Number(r.total_launches),
    searchPartial: stats.searchPartial ?? false,
    launches: stats.launches ?? [],
    linkedWallets: stats.linkedWallets ?? [],
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

export async function getCreator(db: Db, address: string): Promise<Creator | null> {
  const r = (await db.all(`SELECT * FROM creators WHERE address = ? LIMIT 1`, [lc(address)]))[0];
  return r ? toCreator(r) : null;
}

/** Store a scan's creator snapshot (merged with what we had) and close any lookup request for this wallet. */
export async function saveCreatorSnapshot(db: Db, snap: CreatorSnapshotInput, token: string, observedAt = nowIso()): Promise<Creator> {
  const merged = mergeCreator(await getCreator(db, snap.address), snap, token, observedAt);
  const ageDays = merged.firstSeen ? (Date.parse(observedAt) - Date.parse(merged.firstSeen)) / 86_400_000 : null;
  const stats = {
    funder: merged.funder,
    funderLabel: merged.funderLabel,
    searchPartial: merged.searchPartial,
    launches: merged.launches,
    linkedWallets: merged.linkedWallets,
  };
  await db.batch([
    {
      sql: `INSERT INTO creators (address, first_seen, wallet_age_days, funding_source, total_launches, stats, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET
              first_seen = excluded.first_seen, wallet_age_days = excluded.wallet_age_days, funding_source = excluded.funding_source,
              total_launches = excluded.total_launches, stats = excluded.stats, updated_at = excluded.updated_at`,
      params: [merged.address, merged.firstSeen, ageDays, merged.fundingSource, merged.totalLaunches ?? 0, JSON.stringify(stats), observedAt],
    },
    {
      sql: `UPDATE creator_requests SET status = 'done', error = NULL, updated_at = ? WHERE address = ? AND status IN ('queued', 'searching', 'failed')`,
      params: [observedAt, merged.address],
    },
  ]);
  return merged;
}

/** Is this wallet a creator we know (stored profile, or a scanned token it launched)? */
export async function isKnownCreator(db: Db, address: string): Promise<boolean> {
  const a = lc(address);
  const rows = await db.all(
    `SELECT 1 AS x FROM creators WHERE address = ? UNION ALL SELECT 1 AS x FROM tokens WHERE creator = ? LIMIT 1`,
    [a, a],
  );
  return rows.length > 0;
}

export type CreatorRequestStatus = 'queued' | 'searching' | 'done' | 'no_launches' | 'failed';

export interface CreatorRequest {
  address: string;
  status: CreatorRequestStatus;
  attempts: number;
  error: string | null;
  requested_at: string;
  updated_at: string;
}

const toRequest = (r: Record<string, unknown>): CreatorRequest => ({
  address: r.address as string,
  status: r.status as CreatorRequestStatus,
  attempts: Number(r.attempts),
  error: (r.error as string | null) ?? null,
  requested_at: r.requested_at as string,
  updated_at: r.updated_at as string,
});

export async function getCreatorRequest(db: Db, address: string): Promise<CreatorRequest | null> {
  const r = (await db.all(`SELECT * FROM creator_requests WHERE address = ? LIMIT 1`, [lc(address)]))[0];
  return r ? toRequest(r) : null;
}

/**
 * Ask the jobs to search a wallet's launches. New requests are queued; failed ones are re-queued (max 3 attempts);
 * a "no launches" answer older than a day is re-checked (the wallet may have launched since).
 */
export async function enqueueCreatorLookup(db: Db, address: string): Promise<CreatorRequest> {
  const a = lc(address);
  const now = nowIso();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [, , rows] = await db.batch([
    { sql: `INSERT OR IGNORE INTO creator_requests (address, requested_at, status, attempts, updated_at) VALUES (?, ?, 'queued', 0, ?)`, params: [a, now, now] },
    {
      sql: `UPDATE creator_requests SET status = 'queued', attempts = CASE WHEN status = 'no_launches' THEN 0 ELSE attempts END, updated_at = ?
             WHERE address = ? AND ((status = 'failed' AND attempts < 3) OR (status = 'no_launches' AND updated_at < ?))`,
      params: [now, a, dayAgo],
    },
    { sql: `SELECT * FROM creator_requests WHERE address = ?`, params: [a] },
  ]);
  const row = rows?.[0];
  if (!row) throw new Error('enqueueCreatorLookup: request not found after insert');
  return toRequest(row);
}

/** Take up to `limit` queued lookups (or ones stuck in 'searching' for 20+ minutes). */
export async function claimCreatorRequests(db: Db, limit: number): Promise<CreatorRequest[]> {
  const n = Math.max(1, Math.min(20, Math.floor(limit)));
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  const rows = await db.all(
    `UPDATE creator_requests SET status = 'searching', attempts = attempts + 1, updated_at = ?
      WHERE address IN (
        SELECT address FROM creator_requests
         WHERE status = 'queued' OR (status = 'searching' AND updated_at < ?)
         ORDER BY requested_at LIMIT ${n})
      RETURNING *`,
    [nowIso(), stale],
  );
  return rows.map(toRequest);
}

export async function finishCreatorRequest(db: Db, address: string, status: Exclude<CreatorRequestStatus, 'searching'>, error?: string) {
  await db.run(`UPDATE creator_requests SET status = ?, error = ?, updated_at = ? WHERE address = ?`, [
    status,
    error?.slice(0, 500) ?? null,
    nowIso(),
    lc(address),
  ]);
}

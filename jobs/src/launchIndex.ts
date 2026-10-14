/**
 * Our index of every Pons launch (D1 table launch_index), read from the factories' TokenLaunched events over the
 * free RPC. The first runs backfill it from each factory's first block (a time slice per run, several runs in total);
 * after that each run only adds the newest blocks. Creator history then comes from this table instead of explorer
 * searches over 60M+ blocks.
 */
import { getJobState, insertLaunches, launchesByDeployers, setJobState, type Db, type IndexedLaunch } from '@kestrion/db';
import type { DiscoveredLaunch, EngineContext, LaunchIndex, PonsAdapter, PriorLaunchRef } from '@kestrion/engine';
import { errText } from './errors';

/** Blocks per step (the RPC answers ≤ 20k per eth_getLogs, so ~10 calls; one step at a time: the public RPC answers 403 to bursts). */
const WINDOW = 200_000n;
/**
 * D1's free tier allows 100,000 rows written per day (each launch ≈ 2 rows: the row + the deployer index). The
 * backfill may use this many launches per UTC day; the rest is left for scans (seen 2026-10-14: an unthrottled
 * backfill used the whole day's quota in ~30 minutes and every later write failed until midnight UTC).
 */
export const BACKFILL_LAUNCHES_PER_DAY = Number(process.env.INGEST_INDEX_LAUNCHES_PER_DAY ?? 20_000);
const BUDGET_JOB = 'index:budget';

/** A factory counts as fully indexed when its cursor is this close to the head (one run's worth of blocks). */
const CAUGHT_UP = 30_000n;

const jobOf = (factoryId: string) => `index:${factoryId}`;

/** Launch times from two block timestamps around the window (linear in between; blocks are ~0.1 s apart). */
async function estimateTimes(ctx: EngineContext, from: bigint, to: bigint, launches: DiscoveredLaunch[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (launches.length === 0) return out;
  const [a, b] = await Promise.all([ctx.rpc.getBlock({ blockNumber: from }), ctx.rpc.getBlock({ blockNumber: to })]);
  const t0 = Number(a.timestamp);
  const t1 = Number(b.timestamp);
  const span = Number(to - from) || 1;
  for (const l of launches) {
    const t = t0 + ((t1 - t0) * Number(l.blockNumber - from)) / span;
    out.set(l.token.toLowerCase(), new Date(Math.round(t) * 1000).toISOString());
  }
  return out;
}

const toRow = (l: DiscoveredLaunch, time: string | null): IndexedLaunch => ({
  token: l.token,
  factory: l.factoryId,
  deployer: l.deployer,
  curveOrPool: l.curveOrPool ?? null,
  pairToken: l.pairToken ?? null,
  graduationThreshold: l.graduationThreshold !== undefined ? l.graduationThreshold.toString() : null,
  launchBlock: Number(l.blockNumber),
  launchTime: time,
  txHash: l.txHash,
});

/** Add launches the ingest run discovered anyway (exact block, estimated time). */
export async function indexDiscovered(db: Db, ctx: EngineContext, launches: DiscoveredLaunch[], from: bigint, to: bigint) {
  if (launches.length === 0) return;
  const times = await estimateTimes(ctx, from, to, launches).catch(() => new Map<string, string>());
  await insertLaunches(db, launches.map((l) => toRow(l, times.get(l.token.toLowerCase()) ?? null)));
}

/**
 * Extend the index of each factory until `deadline` (ms timestamp). Returns whether every factory is complete.
 * The cursor (job_state 'index:<factory>') only moves past blocks that were read, so a failed step is retried.
 */
export async function extendIndex(
  db: Db,
  ctx: EngineContext,
  adapter: PonsAdapter,
  latest: bigint,
  deadline: number,
  log: (m: string) => void,
): Promise<boolean> {
  let complete = true;
  // Today's write budget for the backfill (deadline 0 = only report completeness, write nothing).
  const day = new Date().toISOString().slice(0, 10);
  const b = deadline > 0 ? await getJobState(db, BUDGET_JOB).catch(() => null) : null;
  let used = b?.stats.day === day && typeof b.stats.used === 'number' ? b.stats.used : 0;
  const remaining = () => BACKFILL_LAUNCHES_PER_DAY - used;
  for (const f of adapter.factories) {
    const end = f.endBlock ?? latest;
    const state = await getJobState(db, jobOf(f.id));
    let cursor = state?.last_block != null ? BigInt(state.last_block) : f.startBlock - 1n;
    let added = 0;
    while (cursor < end && Date.now() < deadline && remaining() > 0) {
      const from = cursor + 1n;
      const to = from + WINDOW - 1n > end ? end : from + WINDOW - 1n;
      try {
        const found = (await adapter.discoverLaunches(f.id, from, to)).sort((x, y) => (x.blockNumber < y.blockNumber ? -1 : x.blockNumber > y.blockNumber ? 1 : 0));
        // Over today's budget: store the first ones and stop just before the first one left out.
        let take = found;
        let next = to;
        if (found.length > remaining()) {
          take = found.slice(0, remaining());
          next = found[remaining()]!.blockNumber - 1n;
        }
        // Times are a nice-to-have: a failed block read must not stop the backfill.
        const times = await estimateTimes(ctx, from, to, take).catch(() => new Map<string, string>());
        await insertLaunches(db, take.map((l) => toRow(l, times.get(l.token.toLowerCase()) ?? null)));
        added += take.length;
        used += take.length;
        cursor = next;
        await setJobState(db, jobOf(f.id), { last_block: Number(cursor), status: cursor >= end ? 'ok' : 'partial', error: null, stats: { added } });
        await setJobState(db, BUDGET_JOB, { status: remaining() > 0 ? 'ok' : 'daily limit reached', error: null, stats: { day, used, limit: BACKFILL_LAUNCHES_PER_DAY } });
      } catch (e) {
        const msg = errText(e);
        log(`index ${f.id}: ERROR at block ${from}: ${msg}`);
        await setJobState(db, jobOf(f.id), { status: 'error', error: msg.slice(0, 500) }).catch(() => {});
        break;
      }
    }
    if (added > 0 || cursor < end) log(`index ${f.id}: +${added} launches, at block ${cursor} of ${end}`);
    if (cursor < end - (f.endBlock ? 0n : CAUGHT_UP)) complete = false;
  }
  return complete;
}

/** The engine's view of the index. `complete` = every factory is fully indexed. */
export function launchIndexFor(db: Db, complete: boolean): LaunchIndex {
  return {
    async byDeployers(deployers) {
      const rows = await launchesByDeployers(db, deployers);
      const refs: PriorLaunchRef[] = rows.map((r) => ({
        factoryId: r.factory as PriorLaunchRef['factoryId'],
        token: r.token as PriorLaunchRef['token'],
        launchBlock: BigInt(r.launchBlock),
        launchTime: r.launchTime ? Math.floor(Date.parse(r.launchTime) / 1000) : undefined,
        curve: r.factory === 'pons-v2' && r.curveOrPool ? (r.curveOrPool as PriorLaunchRef['token']) : undefined,
        graduationThreshold: r.graduationThreshold ? BigInt(r.graduationThreshold) : undefined,
      }));
      return { refs, complete };
    },
  };
}

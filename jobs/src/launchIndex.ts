/**
 * Our index of every Pons launch (D1 table launch_index), read from the factories' TokenLaunched events over the
 * free RPC. The first runs backfill it from each factory's first block (a time slice per run, several runs in total);
 * after that each run only adds the newest blocks. Creator history then comes from this table instead of explorer
 * searches over 60M+ blocks.
 */
import { getJobState, insertLaunches, launchesByDeployers, setJobState, type Db, type IndexedLaunch } from '@kestrion/db';
import type { DiscoveredLaunch, EngineContext, LaunchIndex, PonsAdapter, PriorLaunchRef } from '@kestrion/engine';
import { errText } from './errors';

/** Blocks per step (the RPC answers ≤ 20k per eth_getLogs, so ~10 calls), and steps read in parallel. */
const WINDOW = 200_000n;
const PARALLEL = 4;
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
  for (const f of adapter.factories) {
    const end = f.endBlock ?? latest;
    const state = await getJobState(db, jobOf(f.id));
    let cursor = state?.last_block != null ? BigInt(state.last_block) : f.startBlock - 1n;
    let added = 0;
    while (cursor < end && Date.now() < deadline) {
      const steps: [bigint, bigint][] = [];
      for (let from = cursor + 1n; steps.length < PARALLEL && from <= end; from += WINDOW) {
        steps.push([from, from + WINDOW - 1n > end ? end : from + WINDOW - 1n]);
      }
      try {
        const found = await Promise.all(steps.map(([a, b]) => adapter.discoverLaunches(f.id, a, b).then((l) => ({ a, b, l }))));
        for (const s of found) {
          const times = await estimateTimes(ctx, s.a, s.b, s.l);
          await insertLaunches(db, s.l.map((l) => toRow(l, times.get(l.token.toLowerCase()) ?? null)));
          added += s.l.length;
        }
        cursor = steps[steps.length - 1]![1];
        await setJobState(db, jobOf(f.id), { last_block: Number(cursor), status: cursor >= end ? 'ok' : 'partial', error: null, stats: { added } });
      } catch (e) {
        const msg = errText(e);
        log(`index ${f.id}: ERROR at block ${steps[0]?.[0]}: ${msg}`);
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

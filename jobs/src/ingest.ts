/**
 * ingest — run every ~5 minutes by GitHub Actions (.github/workflows/ingest.yml).
 *
 * The explorer's free tier allows ~5,000 calls a day and Pons has ~1,300 launches a day, so:
 * - every new launch gets a QUICK scan (free RPC + ~2 explorer calls for the creator wallet);
 * - a FULL scan (funding traces of early buyers, outcomes of the creator's earlier launches) runs for tokens people
 *   open on the website and for launches gaining traction, only while the day's credits allow it.
 *
 * Each run:
 * 1. Wallet lookups (creator_requests): the wallet's launches come from our launch index; the newest get queued.
 * 2. The scan_requests queue (tokens people asked about), bounded so new launches still get most of the run.
 * 3. New launches of each factory (quick scans), which are also added to the launch index.
 * 4. Launches with many buyers in this run's blocks are queued for a full scan.
 * 5. Once an hour: rescans (watched tokens, then recent ones) — see rescan.ts.
 * 6. The launch index is extended (backfill from each factory's first block, a time slice per run).
 * 7. Whatever time is left goes back to the queue.
 * Every scan also updates the creator's profile (creators table) and, for recent launches, renders a share image.
 *
 * Idempotent: the last processed block is stored per factory in job_state, already-scanned tokens are skipped,
 * and a failed scan is put on the queue to be retried. Stops starting new work when the time budget runs out.
 */
import {
  claimCreatorRequests,
  claimScanRequests,
  enqueueCreatorLookup,
  enqueueScan,
  finishCreatorRequest,
  finishScanRequest,
  getJobState,
  isScanned,
  pruneAuth,
  pruneOgImages,
  quickScannedByPool,
  requeueScanRequest,
  saveCreatorSnapshot,
  setJobState,
  WALLET_MARK,
  type ScanDepth,
} from '@kestrion/db';
import { getLogsChunked, isContract, PonsAdapter, TOPICS, type DiscoveredLaunch } from '@kestrion/engine';
import { errText } from './errors';
import { extendIndex, indexDiscovered, launchIndexFor } from './launchIndex';
import { processRescans, rescanDue } from './rescan';
import { budget, env, lastError, loadBudget, log, newCtx, openDb, saveBudget, scanAndStore, started, timeLeft, type Outcome, type ScanEnv } from './runtime';

/** First run only: how far back to look (blocks). ~3,000 blocks ≈ 5 minutes. */
const INITIAL_LOOKBACK = BigInt(process.env.INGEST_INITIAL_LOOKBACK_BLOCKS ?? 3_000);
/** Never read more than this many blocks per factory per run (keeps one run bounded). */
const MAX_RANGE = 200_000n;
/**
 * If the cursor is further behind than this (~30 min of blocks, e.g. the job was paused), jump close to the head:
 * new launches matter most. Skipped older launches still reach the launch index and are scanned on demand.
 */
const MAX_LAG = BigInt(process.env.INGEST_MAX_LAG_BLOCKS ?? 18_000);
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 5);
/** Time reserved for the scan_requests queue at the start of each run, so busy launch periods don't starve it. */
const QUEUE_FIRST_MS = Number(process.env.INGEST_QUEUE_FIRST_MS ?? 90_000);
/** Time per run for extending the launch index (the first runs backfill it). */
const INDEX_SLICE_MS = Number(process.env.INGEST_INDEX_SLICE_MS ?? 120_000);
/** Time for the hourly rescans. */
const RESCAN_SLICE_MS = Number(process.env.INGEST_RESCAN_SLICE_MS ?? 150_000);
/** Wallet lookups per run, and how many of a looked-up wallet's newest launches get queued for a scan. */
const CREATOR_LOOKUPS_PER_RUN = 10;
const CREATOR_LOOKUP_SCANS = 3;
/** "Gaining traction": at least this many buys from this many different wallets within one run's blocks. */
const TRACTION_BUYS = 10;
const TRACTION_BUYERS = 6;
const PROMOTIONS_PER_RUN = 8;

/** Run `fn` over items with limited concurrency, stopping new work when the budget is spent. */
async function runWithBudget<T>(items: T[], fn: (item: T) => Promise<void>): Promise<number> {
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length && timeLeft() > 90_000) {
        const item = items[next++] as T;
        await fn(item);
        done++;
      }
    }),
  );
  return done;
}

async function ingestFactory(se: ScanEnv, adapter: PonsAdapter, factoryId: DiscoveredLaunch['factoryId'], latest: bigint) {
  const { db } = se;
  const job = `ingest:${factoryId}`;
  const state = await getJobState(db, job);
  let from = state?.last_block != null ? BigInt(state.last_block) + 1n : latest - INITIAL_LOOKBACK;
  let skipped = 0n;
  if (latest - from > MAX_LAG) {
    skipped = latest - INITIAL_LOOKBACK - from;
    from = latest - INITIAL_LOOKBACK;
    log(`${factoryId}: cursor was ${skipped} blocks behind; jumping ahead (older launches are scanned on demand)`);
  }
  if (from > latest) return { from, to: latest };
  const to = latest - from > MAX_RANGE ? from + MAX_RANGE - 1n : latest;

  const launches = (await adapter.discoverLaunches(factoryId, from, to)).sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
  log(`${factoryId}: blocks ${from}–${to}: ${launches.length} launch(es)`);
  await indexDiscovered(db, newCtx(), launches, from, to).catch((e) => log(`  ! index: ${errText(e)}`));

  const results = new Map<string, Outcome>();
  await runWithBudget(launches, async (l) => {
    const token = l.token.toLowerCase();
    if (await isScanned(db, token)) return void results.set(token, 'skipped');
    const outcome = await scanAndStore(se, token, 'quick', { txHash: l.txHash, newLaunch: true });
    results.set(token, outcome);
    // A failed scan goes to the queue so it is retried by a later run (the block cursor still moves on).
    if (outcome === 'failed') await enqueueScan(db, token, 'quick').catch(() => {});
  });

  // Move the cursor only past launches we actually handled (in block order).
  const firstUnhandled = launches.find((l) => !results.has(l.token.toLowerCase()));
  const lastBlock = firstUnhandled ? firstUnhandled.blockNumber - 1n : to;
  const count = (o: Outcome) => [...results.values()].filter((x) => x === o).length;
  await setJobState(db, job, {
    last_block: Number(lastBlock),
    status: firstUnhandled ? 'partial' : 'ok',
    error: null,
    stats: {
      from: Number(from),
      to: Number(to),
      launches: launches.length,
      scanned: count('scanned'),
      skipped: count('skipped'),
      failed: count('failed'),
      blocksSkippedBehind: Number(skipped),
      lastScanError: lastError.scan,
    },
  });
  return { from, to };
}

/** Scan requested tokens until the queue is empty, the run's budget is spent, or `untilMs` (absolute time) passes. */
async function processQueue(se: ScanEnv, untilMs = Number.POSITIVE_INFINITY) {
  const { db } = se;
  let processed = 0;
  while (timeLeft() > 90_000 && Date.now() < untilMs) {
    const fullAllowed = budget.allowFullScan();
    const batch = await claimScanRequests(db, CONCURRENCY, { fullAllowed });
    if (batch.length === 0) break;
    log(`queue: scanning ${batch.length} requested token(s)${fullAllowed ? '' : ' (credits low: quick scans only)'}`);
    await Promise.all(
      batch.map(async (r) => {
        const depth: ScanDepth = r.depth === 'full' && budget.allowFullScan() ? 'full' : 'quick';
        const outcome = await scanAndStore(se, r.token, depth);
        if (outcome === 'scanned') {
          // recordScan() closes the request, except a full request that only got a quick scan: it waits for credits.
          if (r.depth === 'full' && depth === 'quick') await requeueScanRequest(db, r.token).catch(() => {});
          return;
        }
        if (outcome === 'not_a_launch') {
          // Someone pasted a wallet into the token search: look up its launches instead (the page then redirects).
          const wallet = await isContract(newCtx(), r.token as `0x${string}`).then((c) => !c, () => false);
          if (wallet) await enqueueCreatorLookup(db, r.token).catch(() => {});
          return finishScanRequest(db, r.token, 'not_a_launch', wallet ? WALLET_MARK : 'Not a Pons launch');
        }
        await finishScanRequest(db, r.token, r.attempts >= 3 ? 'failed' : 'queued', 'Scan failed; will retry');
      }),
    );
    processed += batch.length;
  }
  return processed;
}

/**
 * Wallet lookups from the website: the wallet's launches from our index (or, before the index is complete, an
 * explorer search when credits allow). The list is stored right away (the creator page shows it) and the newest
 * few unscanned launches are queued.
 */
async function processCreatorLookups(se: ScanEnv, adapter: PonsAdapter) {
  const { db } = se;
  if (!se.indexComplete && !budget.allowFullScan()) return 0; // wait for the index or for credits
  const batch = await claimCreatorRequests(db, CREATOR_LOOKUPS_PER_RUN);
  for (const r of batch) {
    try {
      const addr = r.address as `0x${string}`;
      const { refs, partial } = se.indexComplete
        ? await se.index.byDeployers([addr]).then((x) => ({ refs: x.refs, partial: !x.complete }))
        : await adapter.findLaunchesByCreator([addr]);
      if (refs.length === 0) {
        await finishCreatorRequest(db, r.address, 'no_launches');
        log(`wallet ${r.address}: no Pons launches`);
        continue;
      }
      const newest = [...refs].sort((a, b) => (a.launchBlock > b.launchBlock ? -1 : 1));
      await saveCreatorSnapshot(
        db,
        {
          address: r.address,
          firstSeen: null,
          fundingSource: null,
          funder: null,
          funderLabel: null,
          launches: newest.map((l) => ({
            token: l.token,
            factoryId: l.factoryId,
            launchBlock: l.launchBlock.toString(),
            launchTime: l.launchTime !== undefined ? new Date(l.launchTime * 1000).toISOString() : null,
          })),
          searchPartial: partial,
          linkedWallets: null,
        },
        newest[0]!.token,
      );
      let queued = 0;
      for (const l of newest) {
        if (queued >= CREATOR_LOOKUP_SCANS) break;
        if (await isScanned(db, l.token)) continue;
        await enqueueScan(db, l.token, 'quick');
        queued++;
      }
      log(`wallet ${r.address}: ${refs.length} launch(es), ${queued} queued for scanning`);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0] ?? 'failed';
      log(`wallet ${r.address}: ERROR ${msg}`);
      await finishCreatorRequest(db, r.address, r.attempts >= 3 ? 'failed' : 'queued', msg).catch(() => {});
    }
  }
  return batch.length;
}

/**
 * Launches gaining traction: many buys from different wallets in this run's blocks (one eth_getLogs over all Pons
 * curves, free). Their quick report is upgraded to a full scan while credits allow.
 */
async function promoteTraction(se: ScanEnv, from: bigint, to: bigint) {
  if (!budget.allowFullScan() || to < from) return 0;
  const ctx = newCtx();
  const logs = await getLogsChunked(ctx.rpc, { topics: [TOPICS.v2CurveBuy] }, from, to);
  const byCurve = new Map<string, { buys: number; buyers: Set<string> }>();
  for (const l of logs) {
    const k = l.address.toLowerCase();
    const c = byCurve.get(k) ?? { buys: 0, buyers: new Set<string>() };
    c.buys++;
    if (l.topics[2]) c.buyers.add(l.topics[2].toLowerCase());
    byCurve.set(k, c);
  }
  const hot = [...byCurve.entries()]
    .filter(([, c]) => c.buys >= TRACTION_BUYS && c.buyers.size >= TRACTION_BUYERS)
    .sort((a, b) => b[1].buyers.size - a[1].buyers.size)
    .map(([curve]) => curve);
  if (hot.length === 0) return 0;
  const tokens = (await quickScannedByPool(se.db, hot)).slice(0, PROMOTIONS_PER_RUN);
  for (const t of tokens) await enqueueScan(se.db, t.address, 'full');
  if (tokens.length) log(`traction: ${tokens.length} launch(es) queued for a full scan`);
  return tokens.length;
}

async function main() {
  const db = openDb();
  if (!env.BLOCKSCOUT_API_KEY) log('warning: BLOCKSCOUT_API_KEY not set; explorer-based checks will be unknown');
  await loadBudget(db);
  const ctx = newCtx();
  const adapter = new PonsAdapter(ctx);
  const latest = await ctx.rpc.getBlockNumber();
  log(`latest block ${latest}; explorer credits left: ${budget.remaining ?? 'unknown'}${budget.allowFullScan() ? '' : ' (full scans paused)'}`);

  // Is the launch index complete? (Cursors only; extending it happens later in the run.)
  let indexComplete = await extendIndex(db, ctx, adapter, latest, 0, log);
  const se: ScanEnv = { db, index: launchIndexFor(db, indexComplete), indexComplete };

  // 1. Wallets people looked up.
  const lookups = await processCreatorLookups(se, adapter).catch((e) => (log(`wallet lookups: ERROR ${errText(e)}`), 0));

  // 2. Tokens people asked about on the website (bounded, so new launches still get most of the run).
  let queued = await processQueue(se, Date.now() + QUEUE_FIRST_MS);

  // 3. New launches (quick scans) + 4. launches gaining traction.
  let promoted = 0;
  for (const f of adapter.factories) {
    try {
      const range = await ingestFactory(se, adapter, f.id, latest);
      if (f.id === 'pons-v2') promoted = await promoteTraction(se, range.from, range.to).catch((e) => (log(`traction: ERROR ${errText(e)}`), 0));
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0] ?? 'failed';
      log(`${f.id}: ERROR ${msg}`);
      await setJobState(db, `ingest:${f.id}`, { status: 'error', error: msg.slice(0, 500) }).catch(() => {});
    }
  }

  // 5. Hourly rescans (watched tokens first).
  let rescanned = 0;
  if (timeLeft() > 150_000 && (await rescanDue(se))) {
    rescanned = await processRescans(se, Date.now() + Math.min(RESCAN_SLICE_MS, timeLeft() - 120_000)).catch((e) => (log(`rescan: ERROR ${errText(e)}`), 0));
  }

  // 6. Extend the launch index (backfill), leaving time for the queue.
  if (!indexComplete && timeLeft() > 150_000) {
    indexComplete = await extendIndex(db, ctx, adapter, latest, Date.now() + Math.min(INDEX_SLICE_MS, timeLeft() - 120_000), log);
    se.indexComplete = indexComplete;
    se.index = launchIndexFor(db, indexComplete);
  }

  // 7. Whatever time is left goes back to the queue; wallets found in it get their lookup now.
  queued += await processQueue(se);
  await processCreatorLookups(se, adapter).catch(() => 0);
  const pruned = await pruneOgImages(db).catch(() => 0);
  await pruneAuth(db).catch(() => {});
  await saveBudget(db);
  await setJobState(db, 'ingest:queue', {
    status: 'ok',
    error: null,
    stats: { processed: queued, walletLookups: lookups, promoted, rescanned, indexComplete, creditsLeft: budget.remaining, shareImagesPruned: pruned },
  });
  log(`done (${(Date.now() - started) / 1000}s); explorer credits left: ${budget.remaining ?? 'unknown'}`);
}

main().catch((e) => {
  console.error('ingest failed:', e);
  process.exit(1);
});

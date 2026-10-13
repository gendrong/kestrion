/**
 * ingest — run every 5 minutes by GitHub Actions (.github/workflows/ingest.yml).
 *
 * 1. For each factory: read launch events since the last processed block, scan each new token, store it.
 * 2. Then work through the scan_requests queue (tokens people asked about on the website).
 * 3. Wallet lookups (creator_requests): find a wallet's launches on-chain and queue the newest ones for scanning.
 * Every scan also updates the creator's profile (creators table) and, for recent launches, renders a share image.
 *
 * Idempotent: the last processed block is stored per factory in job_state, already-scanned tokens are skipped,
 * and a failed scan is put on the queue to be retried. Stops starting new work when the time budget runs out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimCreatorRequests,
  claimScanRequests,
  createD1HttpClient,
  enqueueCreatorLookup,
  enqueueScan,
  finishCreatorRequest,
  finishScanRequest,
  getJobState,
  isScanned,
  OG_RETENTION_DAYS,
  WALLET_MARK,
  pruneOgImages,
  recordScan,
  saveCreatorSnapshot,
  saveOgImage,
  setJobState,
  type Db,
} from '@kestrion/db';
import {
  BLOCKSCOUT,
  createEngineContext,
  isContract,
  NotALaunchError,
  PonsAdapter,
  RateLimiter,
  scanTokenFull,
  type DiscoveredLaunch,
  type FullScan,
} from '@kestrion/engine';
import { toScanRecord } from './record';

// Local runs read the root .env; on GitHub Actions the variables come from repository secrets.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const started = Date.now();
const BUDGET_MS = Number(process.env.INGEST_TIME_BUDGET_MS ?? 8 * 60_000);
/** First run only: how far back to look (blocks). ~3,000 blocks ≈ 5 minutes. */
const INITIAL_LOOKBACK = BigInt(process.env.INGEST_INITIAL_LOOKBACK_BLOCKS ?? 3_000);
/** Never read more than this many blocks per factory per run (keeps one run bounded). */
const MAX_RANGE = 200_000n;
/**
 * If the cursor is further behind than this (~30 min of blocks, e.g. the job was paused), jump close to the head:
 * new launches matter most. Skipped older launches are still scanned on demand through the queue.
 */
const MAX_LAG = BigInt(process.env.INGEST_MAX_LAG_BLOCKS ?? 18_000);
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 5);
/** Time reserved for the scan_requests queue at the start of each run, so busy launch periods don't starve it. */
const QUEUE_FIRST_MS = Number(process.env.INGEST_QUEUE_FIRST_MS ?? 90_000);
/** Wallet lookups per run, and how many of a looked-up wallet's newest launches get queued for a full scan. */
const CREATOR_LOOKUPS_PER_RUN = 5;
const CREATOR_LOOKUP_SCANS = 3;
const FACTORY_NAME: Record<string, string> = { 'pons-v2': 'Pons V2', 'pons-v1-active': 'Pons V1', 'pons-v1-legacy': 'Pons V1 (legacy)' };

const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s`;
const log = (msg: string) => console.log(`${elapsed()}  ${msg}`);
const timeLeft = () => BUDGET_MS - (Date.now() - started);

const env = {
  BLOCKSCOUT_API_KEY: process.env.BLOCKSCOUT_API_KEY,
  RPC_URL: process.env.RPC_URL,
  FALLBACK_RPC_URL: process.env.FALLBACK_RPC_URL,
};
const limiter = new RateLimiter(BLOCKSCOUT.requestsPerSecond);
const newCtx = () => createEngineContext(env, () => {}, { blockscoutLimiter: limiter });

type Outcome = 'scanned' | 'skipped' | 'not_a_launch' | 'failed';

async function scanAndStore(db: Db, token: string): Promise<Outcome> {
  const t0 = Date.now();
  try {
    const full = await scanTokenFull(newCtx(), token);
    await recordScan(db, toScanRecord(full));
    // Extras: a failure here never fails the scan itself.
    await saveCreatorSnapshot(db, full.creator, token, full.report.scannedAt).catch((e) => log(`  ! creator profile ${token}: ${(e as Error).message}`));
    await storeShareImage(db, full).catch((e) => log(`  ! share image ${token}: ${(e as Error).message}`));
    log(`  ✓ ${full.launch.symbol.padEnd(12)} ${token}  score ${full.report.score} (${full.report.label}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return 'scanned';
  } catch (e) {
    if (e instanceof NotALaunchError) return 'not_a_launch';
    log(`  ✗ ${token}: ${(e as Error).message.split('\n')[0]}`);
    return 'failed';
  }
}

/** Render and store the share image of a recent launch (older ones use the site's default image). */
async function storeShareImage(db: Db, full: FullScan) {
  const { report, launch } = full;
  if (Date.now() - launch.launchTime * 1000 > OG_RETENTION_DAYS * 86_400_000) return;
  // Loaded on first use: if the image libraries ever fail to load, only share images are affected, not scanning.
  const { renderTokenOg } = await import('./og');
  const png = await renderTokenOg({
    name: report.token.name,
    symbol: report.token.symbol,
    score: report.score,
    label: report.label,
    subtitle: `${FACTORY_NAME[launch.factoryId] ?? 'Pons'} · ${launch.pairSymbol || launch.pairType} pair`,
  });
  await saveOgImage(db, launch.token, report.scannedAt, png.toString('base64'));
}

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

async function ingestFactory(db: Db, adapter: PonsAdapter, factoryId: DiscoveredLaunch['factoryId'], latest: bigint) {
  const job = `ingest:${factoryId}`;
  const state = await getJobState(db, job);
  let from = state?.last_block != null ? BigInt(state.last_block) + 1n : latest - INITIAL_LOOKBACK;
  let skipped = 0n;
  if (latest - from > MAX_LAG) {
    skipped = latest - INITIAL_LOOKBACK - from;
    from = latest - INITIAL_LOOKBACK;
    log(`${factoryId}: cursor was ${skipped} blocks behind; jumping ahead (older launches are scanned on demand)`);
  }
  if (from > latest) return;
  const to = latest - from > MAX_RANGE ? from + MAX_RANGE - 1n : latest;

  const launches = (await adapter.discoverLaunches(factoryId, from, to)).sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
  log(`${factoryId}: blocks ${from}–${to}: ${launches.length} launch(es)`);

  const results = new Map<string, Outcome>();
  await runWithBudget(launches, async (l) => {
    const token = l.token.toLowerCase();
    if (await isScanned(db, token)) return void results.set(token, 'skipped');
    const outcome = await scanAndStore(db, token);
    results.set(token, outcome);
    // A failed scan goes to the queue so it is retried by a later run (the block cursor still moves on).
    if (outcome === 'failed') await enqueueScan(db, token).catch(() => {});
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
    },
  });
}

/** Scan requested tokens until the queue is empty, the run's budget is spent, or `untilMs` (absolute time) passes. */
async function processQueue(db: Db, untilMs = Number.POSITIVE_INFINITY) {
  let processed = 0;
  while (timeLeft() > 90_000 && Date.now() < untilMs) {
    const batch = await claimScanRequests(db, CONCURRENCY);
    if (batch.length === 0) break;
    log(`queue: scanning ${batch.length} requested token(s)`);
    await Promise.all(
      batch.map(async (r) => {
        const outcome = await scanAndStore(db, r.token);
        if (outcome === 'scanned') return; // record_scan() marks the request done
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
 * Wallet lookups from the website: search the wallet's Pons launches on-chain, store the list right away
 * (the creator page can show it), and queue the newest few for a full scan (which fills in scores and details).
 */
async function processCreatorLookups(db: Db, adapter: PonsAdapter) {
  const batch = await claimCreatorRequests(db, CREATOR_LOOKUPS_PER_RUN);
  for (const r of batch) {
    try {
      const { refs, partial } = await adapter.findLaunchesByCreator([r.address as `0x${string}`]);
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
        await enqueueScan(db, l.token);
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

/** D1 over the Cloudflare REST API (the job runs on GitHub, outside Cloudflare). */
function openDb(): Db {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = process.env.D1_DATABASE_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_D1_TOKEN?.trim() || process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !databaseId || !apiToken) {
    throw new Error('Database not configured: set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_D1_TOKEN (or CLOUDFLARE_API_TOKEN).');
  }
  return createD1HttpClient({ accountId, databaseId, apiToken });
}

async function main() {
  const db = openDb();
  if (!env.BLOCKSCOUT_API_KEY) log('warning: BLOCKSCOUT_API_KEY not set; explorer-based checks will be unknown');
  const ctx = newCtx();
  const adapter = new PonsAdapter(ctx);
  const latest = await ctx.rpc.getBlockNumber();
  log(`latest block ${latest}`);

  // 1. Wallets people looked up (quick: a few log searches each), so their launches join this run's queue.
  const lookups = await processCreatorLookups(db, adapter).catch((e) => (log(`wallet lookups: ERROR ${(e as Error).message}`), 0));

  // 2. Tokens people asked about on the website (bounded, so new launches still get most of the run).
  let queued = await processQueue(db, Date.now() + QUEUE_FIRST_MS);

  // 3. New launches.
  for (const f of adapter.factories) {
    try {
      await ingestFactory(db, adapter, f.id, latest);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0] ?? 'failed';
      log(`${f.id}: ERROR ${msg}`);
      await setJobState(db, `ingest:${f.id}`, { status: 'error', error: msg.slice(0, 500) }).catch(() => {});
    }
  }
  // 4. Whatever time is left goes back to the queue.
  queued += await processQueue(db);
  // Wallets found in the token queue during this run get their lookup now instead of next run.
  await processCreatorLookups(db, adapter).catch(() => 0);
  const pruned = await pruneOgImages(db).catch(() => 0);
  await setJobState(db, 'ingest:queue', { status: 'ok', error: null, stats: { processed: queued, walletLookups: lookups, shareImagesPruned: pruned } });
  log(`done (${(Date.now() - started) / 1000}s)`);
}

main().catch((e) => {
  console.error('ingest failed:', e);
  process.exit(1);
});

/**
 * Shared by the jobs (ingest, rescan, the rescan test): environment, logging, the run's explorer credit budget and
 * RPC rate limit, and "scan one token and store everything" (report, score change + reason, creator profile,
 * followers' notifications, share image).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createD1HttpClient,
  getCreator,
  getJobState,
  getLatestScan,
  notifyCreatorLaunch,
  OG_RETENTION_DAYS,
  recordScan,
  saveAiSummary,
  saveCreatorSnapshot,
  saveOgImage,
  setJobState,
  type Db,
  type ScanDepth,
} from '@kestrion/db';
import {
  BLOCKSCOUT,
  createEngineContext,
  CreditBudget,
  newSharedCaches,
  NotALaunchError,
  RateLimiter,
  scanTokenFull,
  type CreatorProfile,
  type EngineConfig,
  type FullScan,
  type FunderKind,
  type LaunchIndex,
  type ScanReport,
} from '@kestrion/engine';
import { aiSummary } from './aiSummary';
import { errText } from './errors';
import { toScanRecord } from './record';

// Local runs read the root .env; on GitHub Actions the variables come from repository secrets.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const started = Date.now();
export const BUDGET_MS = Number(process.env.INGEST_TIME_BUDGET_MS ?? 8 * 60_000);
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s`;
export const log = (msg: string) => console.log(`${elapsed()}  ${msg}`);
export const timeLeft = () => BUDGET_MS - (Date.now() - started);

export const env = {
  BLOCKSCOUT_API_KEY: process.env.BLOCKSCOUT_API_KEY,
  RPC_URL: process.env.RPC_URL,
  FALLBACK_RPC_URL: process.env.FALLBACK_RPC_URL,
};
// Shared by every scan of this run: the explorer rate limit, the day's credit budget, wallet/funder lookups.
const limiter = new RateLimiter(BLOCKSCOUT.requestsPerSecond);
export const budget = new CreditBudget();
const shared = newSharedCaches();
/** The public RPC rate-limits bursts (seen 2026-10-13 when quick scans ran 5 at a time): start at ~10 requests/s and slow down when it answers 403/429. */
const rpcLimiter = new RateLimiter(Number(process.env.INGEST_RPC_RPS ?? 10), 2);
export const newCtx = () => createEngineContext(env, () => {}, { blockscoutLimiter: limiter, budget, shared, rpcLimiter });

const FACTORY_NAME: Record<string, string> = { 'pons-v2': 'Pons V2', 'pons-v1-active': 'Pons V1', 'pons-v1-legacy': 'Pons V1 (legacy)' };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export type Outcome = 'scanned' | 'skipped' | 'not_a_launch' | 'failed';

/** Last scan error of this run (stored in job_state so failures can be diagnosed without the GitHub log). */
export const lastError: { scan: string | null } = { scan: null };

/** Per-run scan settings that need the database. */
export interface ScanEnv {
  db: Db;
  index: LaunchIndex;
  indexComplete: boolean;
}

/** A stored creator profile, so repeat creators cost no explorer calls in quick scans. */
export async function knownCreatorProfile(db: Db, address: string): Promise<CreatorProfile | null> {
  const c = await getCreator(db, address);
  if (!c?.firstSeen || !c.fundingSource) return null;
  const firstSeen = Math.floor(Date.parse(c.firstSeen) / 1000);
  return {
    address: address as CreatorProfile['address'],
    firstSeen,
    ageDays: (Date.now() / 1000 - firstSeen) / 86400,
    funder: (c.funder ?? undefined) as CreatorProfile['funder'],
    funderKind: c.fundingSource as FunderKind,
    funderLabel: c.funderLabel ?? undefined,
  };
}

/** Why a score moved: which checks changed (and whether the scan depth did). Short, factual, for score_changes. */
export function describeChange(prev: Pick<ScanReport, 'checks' | 'scanDepth' | 'engineVersion'>, next: ScanReport): string | undefined {
  const parts: string[] = [];
  const prevDepth = prev.scanDepth ?? 'full';
  const nextDepth = next.scanDepth ?? 'full';
  if (prevDepth !== nextDepth) parts.push(nextDepth === 'full' ? 'full scan' : 'quick scan');
  for (const c of next.checks) {
    const p = prev.checks.find((x) => x.id === c.id);
    if (!p || p.status !== c.status) parts.push(`${c.title}: ${p?.status ?? 'new'} → ${c.status}`);
    else if (p.deduction !== c.deduction) parts.push(`${c.title}: −${p.deduction} → −${c.deduction}`);
  }
  if (parts.length === 0 && prev.engineVersion !== next.engineVersion) parts.push(`engine ${prev.engineVersion} → ${next.engineVersion}`);
  return parts.length ? parts.slice(0, 3).join('; ') + (parts.length > 3 ? '; …' : '') : undefined;
}

export interface ScanOpts {
  /** Known launch tx (from the factory event). */
  txHash?: `0x${string}`;
  /** A brand-new launch: notify the creator's followers. */
  newLaunch?: boolean;
  /** Test runs only: a different scoring config, and the reason recorded with the score change. */
  cfg?: EngineConfig;
  reason?: string;
}

/** Scan one token and store the report, its score change (with the reason), the creator profile and extras. */
export async function scanAndStore(se: ScanEnv, token: string, depth: ScanDepth, opts: ScanOpts = {}): Promise<Outcome> {
  const { db } = se;
  const t0 = Date.now();
  try {
    const prev = await getLatestScan<ScanReport>(db, token).catch(() => null);
    const full = await scanTokenFull(newCtx(), token, {
      depth,
      cfg: opts.cfg,
      hint: { txHash: opts.txHash },
      // A full scan wants the complete creator history: use the index only once it covers every block.
      launchIndex: depth === 'quick' || se.indexComplete ? se.index : undefined,
      knownCreator: depth === 'quick' ? (a) => knownCreatorProfile(db, a) : undefined,
    });
    const reason = opts.reason ?? (prev ? describeChange(prev.report, full.report) : undefined);
    await recordScan(db, toScanRecord(full, reason));
    // Extras: a failure here never fails the scan itself.
    await saveCreatorSnapshot(db, full.creator, token, full.report.scannedAt).catch((e) => log(`  ! creator profile ${token}: ${errText(e)}`));
    if (opts.newLaunch) {
      const l = full.launch;
      const message = `${short(l.creator)} launched ${l.name.slice(0, 60) || 'a token'} ($${l.symbol.slice(0, 20)}): score ${full.report.score} (${full.report.label})`;
      await notifyCreatorLaunch(db, [l.creator, l.deployer, l.launchTxFrom], token, message).catch((e) => log(`  ! notify followers ${token}: ${errText(e)}`));
    }
    await storeShareImage(db, full).catch((e) => log(`  ! share image ${token}: ${errText(e)}`));
    // Optional AI summary for full scans (off without GEMINI_API_KEY); it never changes the score.
    if (depth === 'full') {
      await aiSummary(full.report)
        .then((text) => (text ? saveAiSummary(db, token, full.report.scannedAt, text) : undefined))
        .catch((e) => log(`  ! AI summary ${token}: ${errText(e)}`));
    }
    const moved = prev && prev.report.score !== full.report.score ? ` (was ${prev.report.score})` : '';
    log(
      `  ✓ ${full.launch.symbol.slice(0, 12).padEnd(12)} ${token}  ${depth.padEnd(5)} score ${full.report.score}${moved} (${full.report.label}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
    return 'scanned';
  } catch (e) {
    if (e instanceof NotALaunchError) return 'not_a_launch';
    lastError.scan = `${token}: ${errText(e)}`;
    log(`  ✗ ${lastError.scan}`);
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

/** The credit budget survives between runs (same UTC day): the first scans of a run then know where they stand. */
export async function loadBudget(db: Db) {
  const s = await getJobState(db, 'explorer:credits').catch(() => null);
  const day = new Date().toISOString().slice(0, 10);
  if (s?.stats.day === day && typeof s.stats.remaining === 'number') {
    budget.remaining = s.stats.remaining;
    budget.exhausted = s.stats.remaining < 1000;
  }
}
export async function saveBudget(db: Db) {
  if (budget.remaining === null) return;
  await setJobState(db, 'explorer:credits', {
    status: budget.exhausted ? 'exhausted' : 'ok',
    error: null,
    stats: { day: new Date().toISOString().slice(0, 10), remaining: budget.remaining },
  }).catch(() => {});
}

/** D1 over the Cloudflare REST API (the jobs run on GitHub, outside Cloudflare). */
export function openDb(): Db {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const databaseId = process.env.D1_DATABASE_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_D1_TOKEN?.trim() || process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !databaseId || !apiToken) {
    throw new Error('Database not configured: set CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID and CLOUDFLARE_D1_TOKEN (or CLOUDFLARE_API_TOKEN).');
  }
  return createD1HttpClient({ accountId, databaseId, apiToken });
}

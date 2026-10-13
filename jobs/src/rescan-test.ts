/**
 * Test the "watchlisted token's score changed → notification" path without waiting for a real change.
 *
 *   npm run rescan:test -w @kestrion/jobs -- <token address>            rescan with a TWEAKED config (score changes)
 *   npm run rescan:test -w @kestrion/jobs -- <token address> --normal   rescan with the real config (score goes back)
 *
 * Also on GitHub: Actions → "rescan-test" → Run workflow (the laptop's network may block the public RPC).
 * The tweak makes holder concentration fail at 0% and every "unknown" check deduct 10 points more, so the score
 * moves for almost any token. The change is stored like a real one (reason starts with "test:"), so everyone
 * watching the token gets a notification. Run it again with --normal to restore the real score.
 */
import { getLatestScan, type Db } from '@kestrion/db';
import { ENGINE_CONFIG, PonsAdapter, type EngineConfig, type ScanReport } from '@kestrion/engine';
import { extendIndex, launchIndexFor } from './launchIndex';
import { loadBudget, log, newCtx, openDb, saveBudget, scanAndStore } from './runtime';

const TWEAKED: EngineConfig = {
  ...ENGINE_CONFIG,
  checks: { ...ENGINE_CONFIG.checks, holders: { ...ENGINE_CONFIG.checks.holders, warnAtPct: 0, failAtPct: 0 } },
  weights: Object.fromEntries(
    Object.entries(ENGINE_CONFIG.weights).map(([id, w]) => [id, { ...w, unknown: id === 'pairType' ? 0 : w.unknown + 10 }]),
  ) as EngineConfig['weights'],
};

async function latestNotification(db: Db, token: string) {
  const rows = await db.all<{ user_wallet: string; message: string; created_at: string }>(
    `SELECT user_wallet, message, created_at FROM notifications WHERE token = ? ORDER BY id DESC LIMIT 3`,
    [token],
  );
  return rows;
}

async function main() {
  const [tokenArg, flag] = process.argv.slice(2);
  const token = tokenArg?.toLowerCase();
  if (!token || !/^0x[0-9a-f]{40}$/.test(token)) {
    console.error('Usage: npm run rescan:test -w @kestrion/jobs -- <token address> [--normal]');
    process.exit(2);
  }
  const normal = flag === '--normal';
  const db = openDb();
  await loadBudget(db);
  const before = await getLatestScan<ScanReport>(db, token);
  if (!before) throw new Error('This token has no report yet: open it on the website first.');
  const ctx = newCtx();
  const latest = await ctx.rpc.getBlockNumber();
  const complete = await extendIndex(db, ctx, new PonsAdapter(ctx), latest, 0, () => {});
  const se = { db, index: launchIndexFor(db, complete), indexComplete: complete };

  log(`${normal ? 'Normal' : 'Tweaked'} rescan of ${token} (score now ${before.report.score}, ${before.report.scanDepth ?? 'full'} scan)…`);
  const outcome = await scanAndStore(se, token, before.report.scanDepth ?? 'full', {
    cfg: normal ? undefined : TWEAKED,
    reason: normal ? 'test: rescan with the normal config' : 'test: tweaked config (holder concentration fails at 0%, unknown checks −10 more)',
  });
  await saveBudget(db);
  const after = await getLatestScan<ScanReport>(db, token);
  log(`outcome: ${outcome}; score ${before.report.score} → ${after?.report.score}`);
  for (const n of await latestNotification(db, token)) log(`notification for ${n.user_wallet}: ${n.message} (${n.created_at})`);
  const watchers = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM watchlist WHERE token = ?`, [token]);
  if (Number(watchers[0]?.n ?? 0) === 0) log('Nobody watches this token yet: add it to your watchlist first, then run this again.');
}

main().catch((e) => {
  console.error('rescan test failed:', e);
  process.exit(1);
});

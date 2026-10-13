/**
 * Rescans (CLAUDE.md §5 "rescan"): every watched token about once an hour, then as many tokens from the last 72 hours
 * as fit (least recently scanned first). Runs inside the ingest chain once an hour instead of as a second workflow:
 * two jobs at once would double the load on the public RPC, which already throttles bursts.
 *
 * A score change is stored in score_changes with its reason (recordScan), and watchers get a notification.
 * A token's depth is kept: a full report is only rescanned when the day's explorer credits allow a full scan
 * (a quick rescan would change the score for no reason other than missing data).
 */
import { getJobState, rescanCandidates, setJobState } from '@kestrion/db';
import { budget, log, scanAndStore, type Outcome, type ScanEnv } from './runtime';

export const RESCAN_EVERY_MS = 55 * 60_000;
const WATCHED_EVERY_MS = 55 * 60_000;
const RECENT_HOURS = 72;
const RECENT_EVERY_MS = 6 * 3_600_000;
const CONCURRENCY = 3;

/** Is an hourly rescan due (job_state 'rescan')? */
export async function rescanDue(se: ScanEnv): Promise<boolean> {
  const s = await getJobState(se.db, 'rescan').catch(() => null);
  return !s?.last_run || Date.now() - Date.parse(s.last_run) >= RESCAN_EVERY_MS;
}

export async function processRescans(se: ScanEnv, deadline: number) {
  const candidates = await rescanCandidates(se.db, {
    watchedEveryMs: WATCHED_EVERY_MS,
    recentHours: RECENT_HOURS,
    recentEveryMs: RECENT_EVERY_MS,
    limit: 200,
  });
  const counts: Record<Outcome | 'deferred', number> = { scanned: 0, skipped: 0, not_a_launch: 0, failed: 0, deferred: 0 };
  let watchedDone = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
      while (next < candidates.length && Date.now() < deadline) {
        const c = candidates[next++]!;
        if (c.depth === 'full' && !budget.allowFullScan()) {
          counts.deferred++; // keep the full report until credits allow a full rescan
          continue;
        }
        const outcome = await scanAndStore(se, c.address, c.depth);
        counts[outcome]++;
        if (c.watched && outcome === 'scanned') watchedDone++;
      }
    }),
  );
  const watched = candidates.filter((c) => c.watched).length;
  log(`rescan: ${counts.scanned} rescanned (${watchedDone}/${watched} watched), ${counts.failed} failed, ${counts.deferred} full ones waiting for credits`);
  await setJobState(se.db, 'rescan', {
    status: counts.failed > counts.scanned ? 'partial' : 'ok',
    error: null,
    stats: { candidates: candidates.length, watched, watchedDone, ...counts },
  });
  return counts.scanned;
}

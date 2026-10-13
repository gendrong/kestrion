import { beforeEach, describe, expect, it } from 'vitest';
import { parseFeedQuery } from '../src/feed';
import {
  claimScanRequests,
  enqueueScan,
  finishScanRequest,
  getFeed,
  getJobState,
  getLatestScan,
  getScanRequest,
  isScanned,
  recordScan,
  setJobState,
  type Db,
  type ScanRecord,
} from '../src/repo';
import { addr, rec } from './fixtures';
import { testDb } from './sqlite';

let db: Db;
beforeEach(() => {
  db = testDb();
});

describe('recordScan + getLatestScan', () => {
  it('stores the token and scan, lower-cases addresses, and rebuilds the full report', async () => {
    await recordScan(db, rec(1));
    expect(await isScanned(db, addr(1))).toBe(true);
    const latest = await getLatestScan<{ score: number; checks: unknown[] }>(db, addr(1).toUpperCase().replace('0X', '0x'));
    expect(latest?.report.score).toBe(80);
    expect(latest?.report.checks).toEqual([{ id: 'holders', status: 'pass' }]);
  });

  it('records a score change only when the score moves', async () => {
    await recordScan(db, rec(1, { score: 80 }));
    await recordScan(db, rec(1, { score: 80 }));
    await recordScan(db, rec(1, { score: 35 }));
    const changes = await db.all<{ old_score: number; new_score: number }>('SELECT old_score, new_score FROM score_changes');
    expect(changes).toEqual([{ old_score: 80, new_score: 35 }]);
    const [token] = await db.all<{ score: number; label: string }>('SELECT score, label FROM tokens');
    expect(token).toEqual({ score: 35, label: 'High risk' });
    expect((await getLatestScan<{ score: number }>(db, addr(1)))?.report.score).toBe(35);
  });

  it('marks a queued scan request as done', async () => {
    await enqueueScan(db, addr(1));
    await recordScan(db, rec(1));
    expect((await getScanRequest(db, addr(1)))?.status).toBe('done');
  });

  it('returns null for unknown tokens', async () => {
    expect(await getLatestScan(db, addr(99))).toBeNull();
    expect(await isScanned(db, addr(99))).toBe(false);
  });
});

describe('getFeed', () => {
  beforeEach(async () => {
    await recordScan(db, rec(1, { score: 90, launchMin: 1 }));
    await recordScan(db, rec(2, { score: 20, launchMin: 2, stage: 'near' }));
    await recordScan(db, rec(3, { score: 55, launchMin: 3, stage: 'graduated', pair: 'USDG' }));
  });
  it('sorts newest / safest / riskiest', async () => {
    const symbols = async (sort: string) => (await getFeed(db, parseFeedQuery({ sort }))).map((i) => i.symbol);
    expect(await symbols('newest')).toEqual(['T3', 'T2', 'T1']);
    expect(await symbols('safest')).toEqual(['T1', 'T3', 'T2']);
    expect(await symbols('riskiest')).toEqual(['T2', 'T3', 'T1']);
  });
  it('filters by stage, pair, risk and since; maps types', async () => {
    expect((await getFeed(db, parseFeedQuery({ stage: 'near' }))).map((i) => i.symbol)).toEqual(['T2']);
    expect((await getFeed(db, parseFeedQuery({ pair: 'USDG' }))).map((i) => i.symbol)).toEqual(['T3']);
    expect((await getFeed(db, parseFeedQuery({ risk: 'low' }))).map((i) => i.symbol)).toEqual(['T1']);
    expect((await getFeed(db, parseFeedQuery({ since: '2026-10-08T12:02:00Z' }))).length).toBe(2);
    const [g] = await getFeed(db, parseFeedQuery({ stage: 'graduated' }));
    expect(g).toMatchObject({ graduated: true, score: 55, curveProgress: 12.5, pairType: 'USDG' });
  });
  it('treats hostile filter values as no filter', async () => {
    expect((await getFeed(db, parseFeedQuery({ stage: "near' OR 1=1 --", limit: '2' }))).length).toBe(2);
  });
});

describe('scan queue', () => {
  it('enqueues once, claims, and finishes', async () => {
    expect((await enqueueScan(db, addr(5))).status).toBe('queued');
    expect((await enqueueScan(db, addr(5))).status).toBe('queued');
    const claimed = await claimScanRequests(db, 5);
    expect(claimed.map((r) => [r.token, r.status, r.attempts])).toEqual([[addr(5), 'scanning', 1]]);
    expect(await claimScanRequests(db, 5)).toEqual([]); // already being scanned
    await finishScanRequest(db, addr(5), 'not_a_launch', 'Not a Pons launch');
    expect((await enqueueScan(db, addr(5))).status).toBe('not_a_launch'); // stays as is
  });
  it('re-queues failed requests until 3 attempts', async () => {
    await enqueueScan(db, addr(6));
    for (let i = 0; i < 3; i++) {
      await claimScanRequests(db, 1);
      await finishScanRequest(db, addr(6), 'failed');
      await enqueueScan(db, addr(6));
    }
    expect(await getScanRequest(db, addr(6))).toMatchObject({ status: 'failed', attempts: 3 });
  });
});

describe('job state', () => {
  it('upserts and keeps fields that are not given', async () => {
    await setJobState(db, 'ingest:pons-v2', { last_block: 100, status: 'ok', stats: { scanned: 2 } });
    await setJobState(db, 'ingest:pons-v2', { status: 'error', error: 'boom' });
    expect(await getJobState(db, 'ingest:pons-v2')).toMatchObject({ last_block: 100, status: 'error', error: 'boom', stats: { scanned: 2 } });
    expect(await getJobState(db, 'missing')).toBeNull();
  });
});

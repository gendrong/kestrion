import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimCreatorRequests,
  enqueueCreatorLookup,
  finishCreatorRequest,
  getCreator,
  getCreatorRequest,
  isKnownCreator,
  mergeCreator,
  saveCreatorSnapshot,
  type CreatorSnapshotInput,
} from '../src/creators';
import { getCreatorTokens, getOgImage, getToday, pruneOgImages, saveOgImage } from '../src/pages';
import { recordScan, type Db } from '../src/repo';
import { addr, rec } from './fixtures';
import { testDb } from './sqlite';

const CREATOR = addr(0xc0);
const upper = (a: string) => `0x${a.slice(2).toUpperCase()}`;
const snap = (over: Partial<CreatorSnapshotInput> = {}): CreatorSnapshotInput => ({
  address: upper(CREATOR),
  firstSeen: '2026-01-01T00:00:00.000Z',
  fundingSource: 'exchange',
  funder: addr(0xf0),
  funderLabel: 'Some Exchange',
  launches: [
    { token: addr(2), factoryId: 'pons-v2', launchBlock: '200', launchTime: '2026-10-02T00:00:00.000Z', name: 'Two', symbol: 'TWO', graduated: false, diedFast: null },
    { token: addr(1), factoryId: 'pons-v2', launchBlock: '100', launchTime: '2026-10-01T00:00:00.000Z', name: 'One', symbol: 'ONE', graduated: false, diedFast: true },
  ],
  searchPartial: false,
  linkedWallets: [{ address: addr(0xa1), reasons: ['funded by the creator'] }],
  ...over,
});

let db: Db;
beforeEach(() => {
  db = testDb();
});

describe('mergeCreator', () => {
  it('replaces the launch list with a new search but keeps details the new scan did not analyse', () => {
    const first = mergeCreator(null, snap(), addr(2), '2026-10-02T00:00:00.000Z');
    const next = mergeCreator(
      first,
      snap({
        launches: [
          { token: addr(3), factoryId: 'pons-v2', launchBlock: '300', launchTime: null, name: 'Three', symbol: 'THREE' },
          { token: addr(2), factoryId: 'pons-v2', launchBlock: '200', launchTime: null },
          { token: addr(1), factoryId: 'pons-v2', launchBlock: '100', launchTime: null },
        ],
        linkedWallets: [
          { address: addr(0xa1), reasons: ['same funding wallet as the creator'] },
          { address: addr(0xa2), reasons: ['deployer'] },
        ],
      }),
      addr(3),
      '2026-10-03T00:00:00.000Z',
    );
    expect(next.totalLaunches).toBe(3);
    expect(next.launches.map((l) => l.name)).toEqual(['Three', 'Two', 'One']);
    expect(next.launches[2]).toMatchObject({ diedFast: true, launchTime: '2026-10-01T00:00:00.000Z' });
    expect(next.linkedWallets).toEqual([
      { address: addr(0xa1), reasons: ['funded by the creator', 'same funding wallet as the creator'], seenIn: [addr(3), addr(2)] },
      { address: addr(0xa2), reasons: ['deployer'], seenIn: [addr(3)] },
    ]);
  });

  it('keeps the old list when the new launch search failed', () => {
    const first = mergeCreator(null, snap(), addr(2), '2026-10-02T00:00:00.000Z');
    const next = mergeCreator(first, snap({ launches: null, fundingSource: null, funder: null }), addr(2), '2026-10-03T00:00:00.000Z');
    expect(next.totalLaunches).toBe(2);
    expect(next.fundingSource).toBe('exchange');
    expect(next.funder).toBe(addr(0xf0));
  });
});

describe('creators table', () => {
  it('saves, reads back and recognises a creator', async () => {
    expect(await isKnownCreator(db, CREATOR)).toBe(false);
    await saveCreatorSnapshot(db, snap(), addr(2), '2026-10-02T00:00:00.000Z');
    const c = await getCreator(db, CREATOR);
    expect(c).toMatchObject({ address: CREATOR, totalLaunches: 2, fundingSource: 'exchange', funderLabel: 'Some Exchange' });
    expect(c?.launches).toHaveLength(2);
    expect(await isKnownCreator(db, upper(CREATOR))).toBe(true);
  });

  it('a creator of a scanned token counts as known even without a profile', async () => {
    await recordScan(db, rec(5, { creator: CREATOR }));
    expect(await isKnownCreator(db, CREATOR)).toBe(true);
    expect((await getCreatorTokens(db, CREATOR)).map((t) => t.address)).toEqual([addr(5)]);
  });
});

describe('creator lookups', () => {
  it('queues once, claims, and is closed when the profile is saved', async () => {
    expect((await enqueueCreatorLookup(db, CREATOR)).status).toBe('queued');
    expect((await enqueueCreatorLookup(db, CREATOR)).status).toBe('queued');
    const claimed = await claimCreatorRequests(db, 5);
    expect(claimed.map((r) => [r.address, r.status, r.attempts])).toEqual([[CREATOR, 'searching', 1]]);
    expect(await claimCreatorRequests(db, 5)).toEqual([]);
    await saveCreatorSnapshot(db, snap(), addr(2));
    expect((await getCreatorRequest(db, CREATOR))?.status).toBe('done');
  });

  it('records "no launches" and re-queues failures up to 3 attempts', async () => {
    await enqueueCreatorLookup(db, CREATOR);
    await claimCreatorRequests(db, 1);
    await finishCreatorRequest(db, CREATOR, 'no_launches');
    // A fresh "no launches" answer is not re-checked yet.
    expect((await enqueueCreatorLookup(db, CREATOR)).status).toBe('no_launches');
    const other = addr(0xc1);
    await enqueueCreatorLookup(db, other);
    for (let i = 0; i < 3; i++) {
      await claimCreatorRequests(db, 1);
      await finishCreatorRequest(db, other, 'failed', 'boom');
      await enqueueCreatorLookup(db, other);
    }
    expect(await getCreatorRequest(db, other)).toMatchObject({ status: 'failed', attempts: 3 });
  });
});

describe('getToday', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it('lists the lowest and highest scores of the last 24h without overlap, and score changes', async () => {
    const scores = [10, 35, 55, 72, 90];
    for (const [i, score] of scores.entries()) await recordScan(db, rec(i + 1, { score, launchTime: hoursAgo(i + 1) }));
    await recordScan(db, rec(9, { score: 5, launchTime: hoursAgo(30) })); // older than 24h
    const rescan = rec(2, { score: 60, launchTime: hoursAgo(2) });
    await recordScan(db, { ...rescan, scan: { ...rescan.scan, scanned_at: hoursAgo(0.5) } });

    const t = await getToday(db, { now, limit: 10 });
    expect(t.counts).toEqual({ total: 5, low: 2, caution: 2, high: 1 });
    expect(t.riskiest.map((x) => x.score)).toEqual([10, 55, 60]);
    expect(t.cleanest.map((x) => x.score)).toEqual([90, 72]);
    expect(t.changes).toMatchObject([{ token: addr(2), oldScore: 35, newScore: 60, label: 'Caution' }]);
  });
});

describe('share images', () => {
  it('stores, replaces and prunes old ones', async () => {
    await recordScan(db, rec(1, { launchTime: new Date().toISOString() }));
    await recordScan(db, rec(2, { launchTime: '2026-01-01T00:00:00.000Z' }));
    await saveOgImage(db, addr(1), 'a', 'AAAA');
    await saveOgImage(db, addr(1), 'b', 'BBBB');
    await saveOgImage(db, addr(2), 'a', 'CCCC');
    expect(await getOgImage(db, addr(1))).toEqual({ pngBase64: 'BBBB', scannedAt: 'b' });
    expect(await pruneOgImages(db)).toBe(1);
    expect(await getOgImage(db, addr(2))).toBeNull();
  });
});

describe('launch index', () => {
  it('stores launches in chunks, ignores duplicates and finds them by deployer', async () => {
    const { insertLaunches, launchesByDeployers, getIndexedLaunch } = await import('../src/launchIndex');
    const rows = Array.from({ length: 30 }, (_, i) => ({
      token: upper(addr(0x5000 + i)),
      factory: 'pons-v2',
      deployer: i % 3 === 0 ? CREATOR : addr(0xd0),
      curveOrPool: addr(0x6000 + i),
      pairToken: addr(0),
      graduationThreshold: '4200000000000000000',
      launchBlock: 1000 + i,
      launchTime: null,
      txHash: `0x${'ab'.repeat(32)}`,
    }));
    await insertLaunches(db, rows);
    await insertLaunches(db, rows.slice(0, 5));
    const mine = await launchesByDeployers(db, [upper(CREATOR)]);
    expect(mine).toHaveLength(10);
    expect(mine[0]!.launchBlock).toBe(1027);
    expect((await getIndexedLaunch(db, addr(0x5001)))?.deployer).toBe(addr(0xd0));
  });
});

describe('scan depth in the queue', () => {
  it('a full-scan request upgrades a finished quick one; a quick scan does not close a full request', async () => {
    const { claimScanRequests, enqueueScan, getScanRequest, requeueScanRequest } = await import('../src/repo');
    const t = addr(0x77);
    await enqueueScan(db, t, 'quick');
    await claimScanRequests(db, 5);
    await recordScan(db, { ...rec(0x77), scan: { ...rec(0x77).scan, depth: 'quick' } });
    expect(await getScanRequest(db, t)).toMatchObject({ status: 'done', depth: 'quick' });

    expect(await enqueueScan(db, t, 'full')).toMatchObject({ status: 'queued', depth: 'full', attempts: 0 });
    // Credits low: a full request for a token that already has a report waits.
    expect(await claimScanRequests(db, 5, { fullAllowed: false })).toEqual([]);
    const [claimed] = await claimScanRequests(db, 5, { fullAllowed: true });
    expect(claimed).toMatchObject({ token: t, depth: 'full' });
    await recordScan(db, { ...rec(0x77), scan: { ...rec(0x77).scan, depth: 'quick' } });
    expect((await getScanRequest(db, t))?.status).toBe('scanning');
    await requeueScanRequest(db, t);
    expect(await getScanRequest(db, t)).toMatchObject({ status: 'queued', attempts: 0 });
    const [again] = await claimScanRequests(db, 5);
    expect(again?.token).toBe(t);
    await recordScan(db, { ...rec(0x77), scan: { ...rec(0x77).scan, depth: 'full' } });
    expect((await getScanRequest(db, t))?.status).toBe('done');
    const [tok] = await db.all<{ scan_depth: string }>('SELECT scan_depth FROM tokens WHERE address = ?', [t]);
    expect(tok?.scan_depth).toBe('full');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { upsertUser } from '../src/accounts';
import {
  adminOverview,
  createApiKey,
  createFlag,
  getAiSummary,
  listApiKeys,
  listFlags,
  MAX_API_KEYS,
  revokeApiKey,
  saveAiSummary,
  setFlagStatus,
  useApiKey,
} from '../src/admin';
import { recordScan, setJobState, type Db } from '../src/repo';
import { addr, rec } from './fixtures';
import { testDb } from './sqlite';

let db: Db;
beforeEach(() => {
  db = testDb();
});
const WALLET = `0x${'cd'.repeat(20)}`;

describe('API keys', () => {
  it('creates up to the maximum, finds a key by hash, and revokes it', async () => {
    const u = await upsertUser(db, WALLET);
    for (let i = 0; i < MAX_API_KEYS; i++) expect(await createApiKey(db, u, `hash${i}`, `kest_${i}`, `key ${i}`)).not.toBeNull();
    expect(await createApiKey(db, u, 'hashX', 'kest_X', 'too many')).toBeNull();
    const keys = await listApiKeys(db, u.wallet);
    expect(keys).toHaveLength(MAX_API_KEYS);
    expect(await useApiKey(db, 'hash0')).toMatchObject({ wallet: u.wallet, tier: 'free' });
    expect(await useApiKey(db, 'nope')).toBeNull();
    const k0 = keys.find((k) => k.prefix === 'kest_0')!;
    expect(await revokeApiKey(db, u.wallet, k0.id)).toBe(true);
    expect(await useApiKey(db, 'hash0')).toBeNull();
    expect(await revokeApiKey(db, `0x${'ee'.repeat(20)}`, keys[1]!.id)).toBe(false); // not the owner
  });
});

describe('flags', () => {
  it('keeps one open flag per user, token and type, and can be reviewed', async () => {
    const u = await upsertUser(db, WALLET);
    await recordScan(db, rec(1));
    await createFlag(db, u, addr(1), 'false_positive', 'looks fine to me');
    await createFlag(db, u, addr(1), 'false_positive', 'updated note');
    await createFlag(db, u, addr(1), 'missed_risk', null);
    const open = await listFlags(db, 'open');
    expect(open).toHaveLength(2);
    expect(open.find((f) => f.type === 'false_positive')).toMatchObject({ note: 'updated note', tokenName: 'Token 1' });
    await setFlagStatus(db, open[0]!.id, 'reviewed', WALLET);
    expect(await listFlags(db, 'open')).toHaveLength(1);
    expect((await listFlags(db, 'all')).map((f) => f.status).sort()).toEqual(['open', 'reviewed']);
  });
});

describe('admin overview and AI summaries', () => {
  it('counts tokens per score decile and lists job states', async () => {
    for (const [i, score] of [5, 15, 72, 95, 100].entries()) await recordScan(db, rec(i + 1, { score }));
    await setJobState(db, 'ingest:pons-v2', { last_block: 5, status: 'ok', stats: { scanned: 3 } });
    const o = await adminOverview(db);
    expect(o.distribution).toEqual([1, 1, 0, 0, 0, 0, 0, 1, 0, 2]);
    expect(o.counts.tokens).toBe(5);
    expect(o.jobs[0]).toMatchObject({ job: 'ingest:pons-v2', stats: { scanned: 3 } });
  });

  it('stores the AI summary on the latest scan', async () => {
    const r = rec(1);
    await recordScan(db, r);
    await saveAiSummary(db, addr(1), r.scan.scanned_at, 'Plain summary.');
    expect(await getAiSummary(db, addr(1))).toBe('Plain summary.');
  });
});

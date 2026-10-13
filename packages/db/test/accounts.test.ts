import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToWatchlist,
  consumeNonce,
  createSession,
  deleteSession,
  followCreator,
  getSessionUser,
  isWatching,
  listFollowedCreators,
  listNotifications,
  listWatchlist,
  markNotificationsRead,
  notifyCreatorLaunch,
  removeFromWatchlist,
  saveNonce,
  unreadCount,
  upsertUser,
  watchedTokens,
} from '../src/accounts';
import { recordScan, type Db } from '../src/repo';
import { TIERS } from '../src/tiers';
import { addr, rec } from './fixtures';
import { testDb } from './sqlite';

let db: Db;
beforeEach(() => {
  db = testDb();
});
const WALLET = `0x${'AB'.repeat(20)}`;

describe('SIWE nonces and sessions', () => {
  it('a nonce works once', async () => {
    await saveNonce(db, 'n1');
    expect(await consumeNonce(db, 'n1')).toBe(true);
    expect(await consumeNonce(db, 'n1')).toBe(false);
    expect(await consumeNonce(db, 'never-issued')).toBe(false);
  });

  it('creates the user on first sign-in and resolves the session', async () => {
    const u = await upsertUser(db, WALLET);
    expect(u).toMatchObject({ wallet: WALLET.toLowerCase(), tier: 'free' });
    await createSession(db, WALLET, 'hash1');
    expect((await getSessionUser(db, 'hash1'))?.wallet).toBe(WALLET.toLowerCase());
    await deleteSession(db, 'hash1');
    expect(await getSessionUser(db, 'hash1')).toBeNull();
  });
});

describe('watchlist and follows', () => {
  it('enforces the Free limits and treats a repeat add as ok', async () => {
    const u = await upsertUser(db, WALLET);
    for (let i = 1; i <= TIERS.free.watchlist + 1; i++) await recordScan(db, rec(i));
    for (let i = 1; i <= TIERS.free.watchlist; i++) expect(await addToWatchlist(db, u, addr(i))).toEqual({ ok: true });
    expect(await addToWatchlist(db, u, addr(1))).toEqual({ ok: true });
    expect(await addToWatchlist(db, u, addr(TIERS.free.watchlist + 1))).toEqual({ ok: false, reason: 'limit', limit: TIERS.free.watchlist });
    await removeFromWatchlist(db, u, addr(1));
    expect(await isWatching(db, u.wallet, addr(1))).toBe(false);
    expect(await watchedTokens(db)).toHaveLength(TIERS.free.watchlist - 1);
    for (let i = 0; i < TIERS.free.follows; i++) expect((await followCreator(db, u, addr(0xc00 + i))).ok).toBe(true);
    expect((await followCreator(db, u, addr(0xcff))).ok).toBe(false);
  });
});

describe('notifications', () => {
  it('a watched token’s score change notifies the watcher, with the reason', async () => {
    const u = await upsertUser(db, WALLET);
    await recordScan(db, rec(1, { score: 80 }));
    await addToWatchlist(db, u, addr(1));
    const next = rec(1, { score: 35 });
    await recordScan(db, { ...next, scan: { ...next.scan, change_reason: 'Sell pressure: pass → fail' } });
    await recordScan(db, rec(1, { score: 35 })); // same score: no new notification
    const list = await listNotifications(db, u.wallet);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'score_changed', token: addr(1), message: 'Token 1 ($T1): score 80 → 35 · Sell pressure: pass → fail' });
    const watched = await listWatchlist(db, u.wallet);
    expect(watched[0]?.change).toMatchObject({ oldScore: 80, newScore: 35 });
    expect(await unreadCount(db, u.wallet)).toBe(1);
    await markNotificationsRead(db, u.wallet);
    expect(await unreadCount(db, u.wallet)).toBe(0);
  });

  it('a followed creator’s new launch notifies followers once', async () => {
    const u = await upsertUser(db, WALLET);
    await followCreator(db, u, addr(0xc0));
    await recordScan(db, rec(9));
    expect(await notifyCreatorLaunch(db, [addr(0xc0), addr(0xc1)], addr(9), 'launched X')).toBe(1);
    expect(await notifyCreatorLaunch(db, [addr(0xc0)], addr(9), 'launched X')).toBe(0);
    expect((await listNotifications(db, u.wallet))[0]).toMatchObject({ type: 'creator_launched', creator: addr(0xc0) });
    expect(await listFollowedCreators(db, u.wallet)).toMatchObject([{ creator: addr(0xc0), lastLaunch: null }]);
  });
});

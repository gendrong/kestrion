import { beforeEach, describe, expect, it } from 'vitest';
import { addToWatchlist, createSession, getSessionUser, setUserBalance, upsertUser, usersForBalanceRefresh } from '../src/accounts';
import { recordScan, type Db } from '../src/repo';
import { TIERS, tierForBalance, toRawUnits } from '../src/tiers';
import { addr, rec } from './fixtures';
import { testDb } from './sqlite';

describe('Holder tier rule', () => {
  it('is off without a threshold: everyone is Free', () => {
    expect(tierForBalance(10n ** 30n, 18, null)).toBe('free');
  });

  it('compares the balance with the threshold in whole tokens (decimals read on-chain)', () => {
    expect(toRawUnits('100000', 18)).toBe(100000n * 10n ** 18n);
    expect(toRawUnits('1.5', 6)).toBe(1_500_000n);
    expect(tierForBalance(toRawUnits('100000', 18), 18, '100000')).toBe('holder');
    expect(tierForBalance(toRawUnits('99999.999999', 18), 18, '100000')).toBe('free');
    expect(() => toRawUnits('1e5', 18)).toThrow();
  });
});

describe('tiers in the database', () => {
  let db: Db;
  beforeEach(() => {
    db = testDb();
  });
  const W = `0x${'12'.repeat(20)}`;

  it('a Holder gets the bigger limits, and drops back to Free when the balance is gone', async () => {
    await upsertUser(db, W);
    await createSession(db, W, 'h');
    await setUserBalance(db, W, 5n, 'holder');
    const holder = (await getSessionUser(db, 'h'))!;
    expect(holder.tier).toBe('holder');
    for (let i = 1; i <= TIERS.free.watchlist + 2; i++) {
      await recordScan(db, rec(i));
      expect((await addToWatchlist(db, holder, addr(i))).ok).toBe(true);
    }
    expect(await usersForBalanceRefresh(db)).toEqual([{ wallet: W, tier: 'holder' }]);
    await setUserBalance(db, W, 0n, 'free');
    const free = (await getSessionUser(db, 'h'))!;
    expect(free.tier).toBe('free');
    // Items above the Free limit stay, but no new ones can be added.
    await recordScan(db, rec(99));
    expect((await addToWatchlist(db, free, addr(99))).ok).toBe(false);
  });
});

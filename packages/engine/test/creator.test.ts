import { describe, expect, it } from 'vitest';
import { buildCreatorSnapshot, MAX_CREATOR_LAUNCHES } from '../src/scan/creator';
import { err, ok, type PriorLaunch } from '../src/types';
import { A, CREATOR, FUNDER, launch, makeData, TOKEN } from './fixtures';

const prior = (n: number, over: Partial<PriorLaunch> = {}): PriorLaunch => ({
  token: A(0x1000 + n),
  factoryId: 'pons-v2',
  name: `Old ${n}`,
  symbol: `OLD${n}`,
  launchBlock: BigInt(500 + n),
  launchTime: 1_700_000_000 + n,
  graduated: false,
  diedFast: n % 2 === 0,
  ...over,
});

describe('creator snapshot', () => {
  it('lists the scanned token plus every prior launch, newest first, with details where analysed', () => {
    const analysed = [prior(2), prior(1)];
    const all = [prior(3), prior(2), prior(1)].map((p) => ({ token: p.token, factoryId: p.factoryId, launchBlock: p.launchBlock, launchTime: p.launchTime }));
    const s = buildCreatorSnapshot(makeData({ priorLaunches: ok({ launches: analysed, total: 3, partial: true, all }) }));
    expect(s.address).toBe(CREATOR);
    expect(s.launches?.map((l) => l.token)).toEqual([TOKEN, A(0x1003), A(0x1002), A(0x1001)]);
    expect(s.launches?.[0]).toMatchObject({ name: launch().name, graduated: false, diedFast: null });
    expect(s.launches?.[1]?.name).toBeUndefined(); // counted, not analysed
    expect(s.launches?.[2]).toMatchObject({ name: 'Old 2', diedFast: true });
    expect(s.searchPartial).toBe(true);
  });

  it('keeps wallet age, funding and linked wallets (without the creator itself)', () => {
    const s = buildCreatorSnapshot(
      makeData({ linked: ok([{ address: CREATOR, reasons: ['creator'] }, { address: A(7), reasons: ['funded by the creator'] }]) }),
    );
    expect(s.fundingSource).toBe('exchange');
    expect(s.funder).toBe(FUNDER);
    expect(s.firstSeen).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(s.linkedWallets).toEqual([{ address: A(7), reasons: ['funded by the creator'] }]);
  });

  it('says "unknown" (null) instead of empty when a source failed', () => {
    const s = buildCreatorSnapshot(makeData({ priorLaunches: err('x'), linked: err('y'), creatorWallet: err('z') }));
    expect(s.launches).toBeNull();
    expect(s.linkedWallets).toBeNull();
    expect(s.fundingSource).toBeNull();
  });

  it('caps very long launch lists', () => {
    const many = Array.from({ length: 400 }, (_, i) => prior(i));
    const s = buildCreatorSnapshot(makeData({ priorLaunches: ok({ launches: [], total: 400, partial: false, all: many }) }));
    expect(s.launches).toHaveLength(MAX_CREATOR_LAUNCHES);
  });
});

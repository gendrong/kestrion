import { describe, expect, it } from 'vitest';
import { FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT, parseFeedQuery, stageOf } from '../src/feed';

describe('stageOf', () => {
  it('maps curve state to feed stages', () => {
    expect(stageOf({ graduated: true, progressPct: 100 })).toBe('graduated');
    expect(stageOf({ graduated: false, progressPct: 61 })).toBe('near');
    expect(stageOf({ graduated: false, progressPct: 50 })).toBe('near');
    expect(stageOf({ graduated: false, progressPct: 3 })).toBe('new');
    expect(stageOf(null)).toBe('new');
  });
});

describe('parseFeedQuery (untrusted query strings)', () => {
  it('uses safe defaults', () => {
    expect(parseFeedQuery(new URLSearchParams(''))).toEqual({ stage: undefined, pair: undefined, risk: undefined, sort: 'newest', since: undefined, limit: FEED_DEFAULT_LIMIT });
  });
  it('accepts known values', () => {
    const q = parseFeedQuery(new URLSearchParams('stage=near&pair=USDG&risk=high&sort=riskiest&limit=20'));
    expect(q).toMatchObject({ stage: 'near', pair: 'USDG', risk: 'high', sort: 'riskiest', limit: 20 });
  });
  it('ignores unknown values and clamps the limit', () => {
    const q = parseFeedQuery(new URLSearchParams("stage=';drop table&pair=BTC&risk=x&sort=y&limit=99999"));
    expect(q).toMatchObject({ stage: undefined, pair: undefined, risk: undefined, sort: 'newest', limit: FEED_MAX_LIMIT });
    expect(parseFeedQuery(new URLSearchParams('limit=-5')).limit).toBe(1);
  });
  it('parses since as unix seconds, milliseconds or ISO; ignores junk', () => {
    expect(parseFeedQuery(new URLSearchParams('since=1791400000')).since?.toISOString()).toBe(new Date(1791400000 * 1000).toISOString());
    expect(parseFeedQuery(new URLSearchParams('since=1791400000000')).since?.getTime()).toBe(1791400000000);
    expect(parseFeedQuery(new URLSearchParams('since=2026-10-08T00:00:00Z')).since?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(parseFeedQuery(new URLSearchParams('since=yesterday')).since).toBeUndefined();
  });
});

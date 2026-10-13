import { describe, expect, it } from 'vitest';
import { checkClusterBuy } from '../src/checks/clusterBuy';
import { CREDITS, CreditBudget } from '../src/explorer/budget';
import { QUICK_SCAN_NO_TRACE } from '../src/scan/collect';
import { buildLedger, ledgerHolders, ledgerTransfersOf } from '../src/scan/ledger';
import { ENGINE_CONFIG as cfg } from '../src/scoring/config';
import { err } from '../src/types';
import { A, buy, CREATOR, makeData } from './fixtures';

describe('explorer credit budget', () => {
  const at = (iso: string) => () => Date.parse(iso);

  it('allows full scans only from what quick scans won’t need before the daily reset', () => {
    const b = new CreditBudget(at('2026-10-13T12:00:00Z'));
    expect(b.allowFullScan()).toBe(true); // nothing known yet
    const needed = 12 * CREDITS.launchesPerHour * CREDITS.perQuickScan + CREDITS.reserve;
    expect(b.reservedForQuickScans()).toBe(needed);
    b.observe(200, String(needed - 1));
    expect(b.allowFullScan()).toBe(false);
    expect(b.canCall()).toBe(true);
    b.observe(200, String(needed + 1000));
    expect(b.allowFullScan()).toBe(true);
  });

  it('stops all calls when credits run out (402 or below the floor)', () => {
    const b = new CreditBudget();
    b.observe(200, String(CREDITS.floor - 1));
    expect(b.canCall()).toBe(false);
    const c = new CreditBudget();
    c.observe(402, null);
    expect(c.canCall()).toBe(false);
    expect(c.allowFullScan()).toBe(false);
  });

  it('ignores responses without the header', () => {
    const b = new CreditBudget();
    b.observe(200, null);
    expect(b.remaining).toBeNull();
    expect(b.canCall()).toBe(true);
  });
});

describe('transfer ledger (holders and flows from RPC logs)', () => {
  const t = (from: number, to: number, value: bigint) => ({ from: A(from), to: A(to), value, block: 1n });
  const ledger = buildLedger([t(0, 1, 1000n), t(1, 2, 300n), t(1, 3, 200n), t(2, 1, 50n)]);

  it('computes balances and ranks holders, skipping the zero address', () => {
    expect(ledgerHolders(ledger)).toEqual([
      { address: A(1), balance: 550n },
      { address: A(2), balance: 250n },
      { address: A(3), balance: 200n },
    ]);
  });

  it('lists one wallet’s transfers', () => {
    expect(ledgerTransfersOf(ledger, A(2))).toHaveLength(2);
  });
});

describe('quick scan', () => {
  it('cluster buy counts only the creator and says so; unknown when below the thresholds', () => {
    const d = makeData({ depth: 'quick', linked: err(QUICK_SCAN_NO_TRACE), earlyTrades: { ok: true, value: [buy(CREATOR, 1)] } });
    const r = checkClusterBuy(d, cfg);
    expect(r.status).toBe('unknown');
    expect(r.explanation).toContain('Quick scan');
  });

  it('still fails on the creator’s own buys alone', () => {
    const d = makeData({ depth: 'quick', linked: err(QUICK_SCAN_NO_TRACE), earlyTrades: { ok: true, value: [buy(CREATOR, 20)] } });
    expect(checkClusterBuy(d, cfg).status).toBe('fail');
  });
});

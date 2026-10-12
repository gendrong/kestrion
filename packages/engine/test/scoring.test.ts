import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks';
import { buildSummary } from '../src/report/build';
import { ENGINE_CONFIG as cfg } from '../src/scoring/config';
import { labelFor, scoreChecks } from '../src/scoring/score';
import type { CheckResult } from '../src/types';
import { makeData } from './fixtures';

const check = (id: CheckResult['id'], status: CheckResult['status']): CheckResult => ({ id, title: id, status, value: {}, explanation: `${id} is ${status}.` });

describe('scoring', () => {
  it('starts at 100 when everything passes', () => {
    const r = scoreChecks(runChecks(makeData(), cfg), cfg);
    expect(r.score).toBe(100);
    expect(r.label).toBe('Low risk');
  });
  it('deducts the configured weight per status', () => {
    const r = scoreChecks([check('exemptions', 'fail'), check('holders', 'warn'), check('sellPressure', 'unknown')], cfg);
    expect(r.checks.map((c) => c.deduction)).toEqual([cfg.weights.exemptions.fail, cfg.weights.holders.warn, cfg.weights.sellPressure.unknown]);
    expect(r.score).toBe(100 - 25 - 8 - 3);
  });
  it('never goes below 0', () => {
    const ids: CheckResult['id'][] = ['exemptions', 'clusterBuy', 'holders', 'creatorHistory', 'creatorWallet', 'sellPressure'];
    expect(scoreChecks(ids.map((id) => check(id, 'fail')), cfg).score).toBe(0);
  });
  it('treats unknown as a deduction, never a silent pass', () => {
    expect(scoreChecks([check('clusterBuy', 'unknown')], cfg).score).toBeLessThan(100);
  });
  it('uses the documented bands (70–100 low, 40–69 caution, 0–39 high)', () => {
    expect(labelFor(100, cfg)).toBe('Low risk');
    expect(labelFor(70, cfg)).toBe('Low risk');
    expect(labelFor(69, cfg)).toBe('Caution');
    expect(labelFor(40, cfg)).toBe('Caution');
    expect(labelFor(39, cfg)).toBe('High risk');
    expect(labelFor(0, cfg)).toBe('High risk');
  });
  it('informational checks deduct nothing', () => {
    expect(cfg.weights.pairType).toEqual({ warn: 0, fail: 0, unknown: 0 });
  });
});

describe('summary', () => {
  it('mentions the worst findings first and counts unknowns', () => {
    const { score, label, checks } = scoreChecks(
      [check('holders', 'warn'), check('exemptions', 'fail'), check('creatorWallet', 'unknown')],
      cfg,
    );
    const s = buildSummary(score, label, checks);
    expect(s.startsWith(`${label} (${score}/100). exemptions is fail. holders is warn.`)).toBe(true);
    expect(s).toMatch(/1 check could not be computed/);
  });
  it('says so when nothing was flagged', () => {
    const { score, label, checks } = scoreChecks([check('holders', 'pass')], cfg);
    expect(buildSummary(score, label, checks)).toBe('Low risk (100/100). No check raised a warning.');
  });
});

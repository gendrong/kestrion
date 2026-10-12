/** Check 6 (informational): bonding progress, graduation, time since launch. */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';
import { fmtAmount, fmtDuration } from '../util/format';
import { unknown } from './helpers';

const ID = 'curveState' as const;
const TITLE = 'Curve state';

export function checkCurveState(d: ScanData, _cfg: EngineConfig): CheckResult {
  if (!d.curve.ok) return unknown(ID, TITLE, d.curve.error);
  const s = d.curve.value;
  const age = d.now - d.launch.launchTime;
  const unit = d.launch.pairSymbol;
  const dec = d.launch.pairDecimals;
  const value = {
    progressPct: s.progressPct,
    raised: `${fmtAmount(s.raised, dec)} ${unit}`,
    graduationThreshold: `${fmtAmount(s.threshold, dec)} ${unit}`,
    graduated: s.graduated,
    phase: s.phase,
    ageSeconds: age,
  };
  if (s.phase === 'Rescued') {
    return { id: ID, title: TITLE, status: 'warn', value, explanation: `The launch got stuck and was marked "Rescued" by the protocol; launched ${fmtDuration(age)} ago.` };
  }
  return {
    id: ID,
    title: TITLE,
    status: 'pass',
    value,
    explanation: s.graduated
      ? `Graduated (${s.phase}); launched ${fmtDuration(age)} ago.`
      : `${s.progressPct}% of the way to graduation (${value.raised} of ${value.graduationThreshold}); launched ${fmtDuration(age)} ago.`,
  };
}

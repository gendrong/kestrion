/** Turns check results into a 0–100 score and a label. Pure function. */
import type { CheckResult, RiskLabel, ScoredCheck } from '../types';
import type { EngineConfig } from './config';

export function labelFor(score: number, cfg: EngineConfig): RiskLabel {
  if (score >= cfg.labels.low) return 'Low risk';
  if (score >= cfg.labels.caution) return 'Caution';
  return 'High risk';
}

export function scoreChecks(checks: CheckResult[], cfg: EngineConfig): { score: number; label: RiskLabel; checks: ScoredCheck[] } {
  const scored = checks.map((c) => ({ ...c, deduction: c.status === 'pass' ? 0 : cfg.weights[c.id][c.status] }));
  const total = scored.reduce((s, c) => s + c.deduction, 0);
  const score = Math.max(0, Math.min(100, 100 - total));
  return { score, label: labelFor(score, cfg), checks: scored };
}

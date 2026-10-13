/** Builds the JSON-safe report (used by the CLI now, the website and API later). */
import { rankHolders } from '../checks/holders';
import type { EngineConfig } from '../scoring/config';
import { scoreChecks } from '../scoring/score';
import type { CheckResult, RiskLabel, ScanData, ScanReport, ScoredCheck } from '../types';
import { ENGINE_VERSION } from '../version';

export const DISCLAIMER = 'Data, not advice. DYOR.';

/** 1–3 plain sentences built only from the check results (rule-based, no LLM). */
export function buildSummary(score: number, label: RiskLabel, checks: ScoredCheck[]): string {
  const concerns = [...checks.filter((c) => c.status === 'fail'), ...checks.filter((c) => c.status === 'warn')]
    .filter((c) => c.deduction > 0)
    .slice(0, 2)
    .map((c) => firstSentence(c.explanation));
  const unknowns = checks.filter((c) => c.status === 'unknown').length;
  let s = `${label} (${score}/100).`;
  s += concerns.length ? ` ${concerns.join(' ')}` : ' No check raised a warning.';
  if (unknowns > 0) s += ` ${unknowns} check${unknowns === 1 ? '' : 's'} could not be computed.`;
  return s;
}

const firstSentence = (text: string) => {
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
};

export function buildReport(data: ScanData, checks: CheckResult[], cfg: EngineConfig, notes: string[]): ScanReport {
  const { score, label, checks: scored } = scoreChecks(checks, cfg);
  const l = data.launch;
  return {
    engineVersion: ENGINE_VERSION,
    scannedAt: new Date(data.now * 1000).toISOString(),
    scanDepth: data.depth,
    token: { address: l.token, name: l.name, symbol: l.symbol, decimals: l.decimals, totalSupply: l.totalSupply.toString() },
    launchpad: { id: 'pons', factoryId: l.factoryId, version: l.version, factory: l.factoryAddress },
    launch: { block: l.launchBlock.toString(), time: new Date(l.launchTime * 1000).toISOString(), tx: l.launchTx },
    creator: { address: l.creator, deployer: l.deployer, deployerIsContract: l.deployerIsContract, feeRecipient: l.creatorFeeRecipient },
    pair: { type: l.pairType, symbol: l.pairSymbol, address: l.pairToken },
    curve: data.curve.ok
      ? {
          progressPct: data.curve.value.progressPct,
          raised: data.curve.value.raised.toString(),
          threshold: data.curve.value.threshold.toString(),
          graduated: data.curve.value.graduated,
          phase: data.curve.value.phase,
        }
      : null,
    score,
    label,
    checks: scored,
    topHolders: rankHolders(data).slice(0, 10),
    summary: buildSummary(score, label, scored),
    notes: [
      ...(data.depth === 'quick'
        ? ['Quick scan: early buyers’ funding and the outcome of the creator’s earlier launches are checked in a full scan.']
        : []),
      ...new Set(notes),
    ],
    disclaimer: DISCLAIMER,
  };
}

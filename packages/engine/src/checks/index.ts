import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';
import { checkClusterBuy } from './clusterBuy';
import { checkCreatorHistory } from './creatorHistory';
import { checkCreatorWallet } from './creatorWallet';
import { checkCurveState } from './curveState';
import { checkExemptions } from './exemptions';
import { checkHolders } from './holders';
import { checkPairType } from './pairType';
import { checkSellPressure } from './sellPressure';

/** The 8 checks, in report order (CLAUDE.md §7). */
export const CHECKS = [
  checkExemptions,
  checkClusterBuy,
  checkHolders,
  checkCreatorHistory,
  checkCreatorWallet,
  checkCurveState,
  checkPairType,
  checkSellPressure,
];

export function runChecks(d: ScanData, cfg: EngineConfig): CheckResult[] {
  return CHECKS.map((check) => check(d, cfg));
}

export {
  checkClusterBuy,
  checkCreatorHistory,
  checkCreatorWallet,
  checkCurveState,
  checkExemptions,
  checkHolders,
  checkPairType,
  checkSellPressure,
};

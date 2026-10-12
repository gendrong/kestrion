/** Check 7 (informational): what the token is paired with. */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';

export function checkPairType(d: ScanData, _cfg: EngineConfig): CheckResult {
  const l = d.launch;
  const explanation =
    l.pairType === 'ETH'
      ? 'Paired with ETH.'
      : l.pairType === 'USDG'
        ? 'Paired with USDG (a US-dollar stablecoin).'
        : `Paired with ${l.pairSymbol}, another token: its own price moves the value of this pair.`;
  return {
    id: 'pairType',
    title: 'Pair type',
    status: 'pass',
    value: { pairType: l.pairType, pairSymbol: l.pairSymbol, pairToken: l.pairToken },
    explanation,
  };
}

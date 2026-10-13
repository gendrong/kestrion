/** Shared test data. */
import type { ScanRecord } from '../src/repo';

export const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

export function rec(n: number, over: { score?: number; label?: string; stage?: 'new' | 'near' | 'graduated'; launchMin?: number; pair?: 'ETH' | 'USDG' | 'Other'; launchTime?: string; creator?: string } = {}): ScanRecord {
  const score = over.score ?? 80;
  return {
    token: {
      address: addr(n).toUpperCase().replace('0X', '0x'),
      launchpad: 'pons',
      factory: 'pons-v2',
      name: `Token ${n}`,
      symbol: `T${n}`,
      creator: over.creator ?? addr(1000 + n),
      deployer: addr(1000 + n),
      paired_token: addr(0),
      pair_type: over.pair ?? 'ETH',
      pair_symbol: 'ETH',
      pool: addr(2000 + n),
      launch_block: String(100 + n),
      launch_time: over.launchTime ?? new Date(Date.UTC(2026, 9, 8, 12, over.launchMin ?? n)).toISOString(),
      metadata: { logoCid: null, description: '', socials: {} },
    },
    scan: {
      scanned_at: new Date().toISOString(),
      score,
      label: over.label ?? (score >= 70 ? 'Low risk' : score >= 40 ? 'Caution' : 'High risk'),
      checks: [{ id: 'holders', status: 'pass' }],
      report: { score, summary: 'ok', checks: [{ id: 'holders', status: 'pass' }] },
      engine_version: '0.1.1',
      summary: 'ok',
      curve_progress: 12.5,
      graduated: over.stage === 'graduated',
      stage: over.stage ?? 'new',
    },
  };
}

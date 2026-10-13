/** Turn an engine scan into the row shape the database stores. */
import type { FullScan } from '@kestrion/engine';
import { stageOf, type ScanRecord } from '@kestrion/db';

export function toScanRecord(full: FullScan): ScanRecord {
  const { report, launch, metadata } = full;
  const curve = report.curve;
  return {
    token: {
      address: launch.token.toLowerCase(),
      launchpad: launch.launchpad,
      factory: launch.factoryId,
      name: launch.name.slice(0, 100),
      symbol: launch.symbol.slice(0, 40),
      creator: launch.creator.toLowerCase(),
      deployer: launch.deployer.toLowerCase(),
      paired_token: launch.pairToken.toLowerCase(),
      pair_type: launch.pairType,
      pair_symbol: launch.pairSymbol.slice(0, 40),
      pool: (launch.curve ?? launch.pool ?? null)?.toLowerCase() ?? null,
      launch_block: launch.launchBlock.toString(),
      launch_time: new Date(launch.launchTime * 1000).toISOString(),
      metadata: metadata as unknown as ScanRecord['token']['metadata'],
    },
    scan: {
      scanned_at: report.scannedAt,
      score: report.score,
      label: report.label,
      checks: report.checks,
      report: report as unknown as Record<string, unknown>,
      engine_version: report.engineVersion,
      summary: report.summary,
      curve_progress: curve ? curve.progressPct : null,
      graduated: curve?.graduated ?? false,
      stage: stageOf(curve ? { graduated: curve.graduated, progressPct: curve.progressPct } : null),
      depth: report.scanDepth ?? 'full',
    },
  };
}

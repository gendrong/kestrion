/** scanToken: the one function the CLI, the website and the jobs call. */
import { getAddress, isAddress, type Address } from 'viem';
import { PonsAdapter } from '../adapters/pons';
import type { LaunchpadAdapter } from '../adapters/types';
import { runChecks } from '../checks';
import type { EngineContext } from '../context';
import { buildReport } from '../report/build';
import { ENGINE_CONFIG, type EngineConfig } from '../scoring/config';
import type { CreatorSnapshot, LaunchInfo, ScanReport } from '../types';
import { cleanMetadata, type TokenMetadata } from '../util/media';
import { collectScanData } from './collect';
import { buildCreatorSnapshot } from './creator';

export class InvalidAddressError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid address (expected 0x followed by 40 hex characters).`);
    this.name = 'InvalidAddressError';
  }
}

/** Checksummed address, or null when `input` is not a valid 0x address. Use it to validate every user input. */
export function normalizeAddress(input: string): Address | null {
  const trimmed = input.trim();
  return isAddress(trimmed, { strict: false }) ? getAddress(trimmed) : null;
}

export interface FullScan {
  report: ScanReport;
  /** Launch details (curve/pool address, creator identities…) for storing in the database. */
  launch: LaunchInfo;
  /** Cleaned token metadata (logo CID, description, socials). */
  metadata: TokenMetadata;
  /** What this scan learned about the creator (all launches, wallet age, funding, linked wallets). */
  creator: CreatorSnapshot;
}

/** Scan and also return launch info + metadata (used by the ingest job). */
export async function scanTokenFull(
  ctx: EngineContext,
  input: string,
  opts: { cfg?: EngineConfig; adapter?: LaunchpadAdapter } = {},
): Promise<FullScan> {
  const token = normalizeAddress(input);
  if (!token) throw new InvalidAddressError(input);
  const cfg = opts.cfg ?? ENGINE_CONFIG;
  const adapter = opts.adapter ?? new PonsAdapter(ctx);

  const data = await collectScanData(ctx, adapter, token, cfg);
  const checks = runChecks(data, cfg);
  const metadata = await adapter
    .readTokenMetadata(data.launch)
    .catch(() => cleanMetadata({}));
  const notes = [...ctx.notes];
  const used = ctx.rpcStatus();
  const pub = used.find((u) => u.name === 'public RPC');
  if (pub && pub.failures > 0 && pub.successes === 0) notes.push('Public RPC unreachable: all chain reads used the fallback RPC.');
  return { report: buildReport(data, checks, cfg, notes), launch: data.launch, metadata, creator: buildCreatorSnapshot(data) };
}

export async function scanToken(
  ctx: EngineContext,
  input: string,
  opts: { cfg?: EngineConfig; adapter?: LaunchpadAdapter } = {},
): Promise<ScanReport> {
  return (await scanTokenFull(ctx, input, opts)).report;
}

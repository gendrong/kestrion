import type { Address } from 'viem';
import { AVG_BLOCK_TIME_SECONDS } from '../chain/config';
import { creatorIdentities, FUNDING_LINK_REASONS } from '../scan/wallets';
import type { CheckId, CheckResult, ScanData } from '../types';

export function unknown(id: CheckId, title: string, reason: string): CheckResult {
  return {
    id,
    title,
    status: 'unknown',
    value: { reason },
    explanation: `Could not be computed: ${reason}. Treated as unknown, not as a pass.`,
  };
}

/** Lower-cased creator identities (creator, launch tx sender, EOA deployer, fee recipient). */
export function creatorSet(d: ScanData): Set<string> {
  return new Set(creatorIdentities(d.launch).map((i) => i.address.toLowerCase()));
}

/** Creator identities + linked wallets (falls back to creator identities when linking failed). */
export function linkedSet(d: ScanData): Set<string> {
  const s = creatorSet(d);
  if (d.linked.ok) for (const w of d.linked.value) s.add(w.address.toLowerCase());
  return s;
}

/** Reasons a wallet is linked to the creator, if any. */
export function linkReasons(d: ScanData, address: Address): string[] {
  if (!d.linked.ok) return [];
  return d.linked.value.find((w) => w.address.toLowerCase() === address.toLowerCase())?.reasons ?? [];
}

export const isFundingLinked = (reasons: string[]) => reasons.some((r) => FUNDING_LINK_REASONS.includes(r));

export const approxSeconds = (blocks: number) => Math.round(blocks * AVG_BLOCK_TIME_SECONDS);

/** plural(2, 'wallet') → "2 wallets"; words ending in s/sh/ch/x get "es" ("2 launches"). */
export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? '' : /(s|sh|ch|x)$/.test(word) ? 'es' : 's'}`;

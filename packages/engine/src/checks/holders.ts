/** Check 3: how much of the supply the top holders own (pool, curve, lockers and burn excluded). */
import type { Address } from 'viem';
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, Holder, ScanData } from '../types';
import { pct, shortAddr } from '../util/format';
import { creatorSet, linkedSet, unknown } from './helpers';

const ID = 'holders' as const;
const TITLE = 'Holder concentration';

export interface LabeledHolder {
  address: Address;
  pct: number;
  label?: string;
}

/** Token lockers (e.g. "RobinhoodLocker") are excluded like pool and burn addresses. */
const isLocker = (h: Holder) => h.isContract && /lock/i.test(h.name ?? '');

/** Real holders (exclusions and lockers removed), largest first, with labels. Also used for the report's holder table. */
export function rankHolders(d: ScanData): LabeledHolder[] {
  if (!d.holders.ok) return [];
  const excluded = new Set(d.excluded.map((a) => a.toLowerCase()));
  for (const h of d.holders.value) if (isLocker(h)) excluded.add(h.address.toLowerCase());
  const creators = creatorSet(d);
  const linked = linkedSet(d);
  const label = (h: Holder) =>
    creators.has(h.address.toLowerCase())
      ? 'creator'
      : linked.has(h.address.toLowerCase())
        ? 'linked to creator'
        : h.isContract
          ? h.name || 'contract'
          : undefined;
  return d.holders.value
    .filter((h) => h.balance > 0n && !excluded.has(h.address.toLowerCase()))
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0))
    .map((h) => ({ address: h.address, pct: pct(h.balance, d.launch.totalSupply), label: label(h) }));
}

export function checkHolders(d: ScanData, cfg: EngineConfig): CheckResult {
  const c = cfg.checks.holders;
  if (!d.holders.ok) return unknown(ID, TITLE, d.holders.error);

  const ranked = rankHolders(d);
  const top = ranked.slice(0, c.topN);
  const topPct = Math.round(top.reduce((s, h) => s + h.pct, 0) * 100) / 100;
  const largest = top[0];
  const lockers = d.holders.value.filter(isLocker);
  const lockedPct = pct(
    lockers.reduce((s, h) => s + h.balance, 0n),
    d.launch.totalSupply,
  );
  const value = {
    topN: c.topN,
    topHoldersSupplyPct: topPct,
    largestHolderPct: largest?.pct ?? 0,
    largestHolderLabel: largest?.label ?? null,
    holdersCounted: ranked.length,
    excludedAddresses: d.excluded.length + lockers.length,
    lockedInLockersPct: lockedPct,
    top: top.map((h) => ({ address: h.address, pct: h.pct, label: h.label ?? null })),
  };

  if (!largest || topPct < 0.01) {
    return { id: ID, title: TITLE, status: 'pass', value, explanation: 'No wallet holds tokens outside the curve, pool and lockers yet.' };
  }
  const status = topPct >= c.failAtPct ? 'fail' : topPct >= c.warnAtPct ? 'warn' : 'pass';
  const who = largest.label ? `${largest.label} (${shortAddr(largest.address)})` : shortAddr(largest.address);
  return {
    id: ID,
    title: TITLE,
    status,
    value,
    explanation:
      `Top ${c.topN} holders own ${topPct}% of supply (excluding pool, curve, lockers and burn addresses). Largest holder: ${who} with ${largest.pct}%.` +
      (lockedPct > 0 ? ` ${lockedPct}% of supply sits in token lockers.` : ''),
  };
}

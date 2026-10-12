/** Client-safe formatting helpers (no engine runtime imports). */
import type { CheckStatus, RiskLabel } from '@kestrion/engine/types';

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export const LABEL_STYLE: Record<RiskLabel, { badge: string; score: string; bar: string }> = {
  'Low risk': { badge: 'bg-low-bg text-low-fg', score: 'text-ink', bar: 'bg-ink' },
  Caution: { badge: 'bg-caution-bg text-caution-fg', score: 'text-warn-num', bar: 'bg-warn-num' },
  'High risk': { badge: 'bg-high-bg text-high-fg', score: 'text-high', bar: 'bg-high' },
};

export const STATUS_STYLE: Record<CheckStatus, { chip: string; text: string; num: string }> = {
  pass: { chip: 'bg-low-bg text-low-fg', text: 'Pass', num: 'text-ink' },
  warn: { chip: 'bg-caution-bg text-caution-fg', text: 'Warn', num: 'text-warn-num' },
  fail: { chip: 'bg-high-bg text-high-fg', text: 'Fail', num: 'text-high' },
  unknown: { chip: 'bg-unknown-bg text-ink-2', text: 'Unknown', num: 'text-ink-3' },
};

export const FACTORY_NAME: Record<string, string> = {
  'pons-v2': 'Pons V2',
  'pons-v1-active': 'Pons V1',
  'pons-v1-legacy': 'Pons V1 (legacy)',
};

/** "boughtInEarlyWindowSupplyPct" → "Bought in early window supply %" */
export function humanKey(key: string): string {
  const spaced = key
    .replace(/Pct$/, ' %')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase();
}

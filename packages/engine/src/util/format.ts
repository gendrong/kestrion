import { formatUnits, type Address } from 'viem';

/** 1234567.891 → "1,234,567.89" (keeps up to `maxFrac` decimals, trims zeros). */
export function fmtAmount(value: bigint, decimals: number, maxFrac = 4): string {
  const negative = value < 0n;
  const [int = '0', frac = ''] = formatUnits(negative ? -value : value, decimals).split('.');
  const f = frac.slice(0, maxFrac).replace(/0+$/, '');
  return (negative ? '-' : '') + BigInt(int).toLocaleString('en-US') + (f ? `.${f}` : '');
}

/** part / whole as a percentage with 2 decimals (0 when whole is 0). */
export function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 10_000n) / whole) / 100;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const lower = (a: string) => a.toLowerCase() as Address;

/** Unique addresses, case-insensitive, keeping first spelling. */
export function uniqAddrs(list: (Address | undefined | null)[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of list) {
    if (!a) continue;
    const k = a.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}

/** 4000 s → "1h 6m". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

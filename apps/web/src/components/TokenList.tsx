import Link from 'next/link';
import { TokenAvatar } from '@/components/TokenAvatar';
import { LABEL_STYLE, shortAddr, timeAgo } from '@/lib/format';

export interface TokenListItem {
  address: string;
  name: string | null;
  symbol: string | null;
  logoCid: string | null;
  launchTime: string | null;
  /** null = not scanned yet. */
  score: number | null;
  label: string | null;
  /** Extra line under the name (e.g. outcome or score change). */
  note?: string;
  /** Badge text instead of the score (e.g. "80 → 35"). */
  badge?: string;
}

/** Compact list of tokens with risk badges (creator page, /today). Server-rendered. */
export function TokenList({ items, empty }: { items: TokenListItem[]; empty: string }) {
  if (items.length === 0) return <p className="px-1 py-6 text-ink-3">{empty}</p>;
  const now = Date.now();
  return (
    <ul className="flex flex-col">
      {items.map((t) => {
        const style = t.label ? LABEL_STYLE[t.label as keyof typeof LABEL_STYLE] : undefined;
        return (
          <li key={t.address} className="border-t border-line-soft first:border-t-0">
            <Link href={`/t/${t.address}`} className="flex items-center gap-3 py-3 hover:bg-paper/60 sm:px-2">
              <TokenAvatar name={t.name ?? t.symbol ?? '?'} logoCid={t.logoCid} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {t.name || (t.symbol ? `$${t.symbol}` : shortAddr(t.address))}
                  {t.name && t.symbol ? <span className="font-normal text-muted"> ${t.symbol}</span> : null}
                </span>
                <span className="block truncate text-[13px] text-muted">
                  {t.launchTime ? timeAgo(t.launchTime, now) : 'Launch time unknown'}
                  {t.note ? ` · ${t.note}` : ''}
                </span>
              </span>
              {t.score !== null ? (
                <span className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${style?.badge ?? 'bg-unknown-bg text-ink-2'}`}>
                  <span className="font-display">{t.badge ?? t.score}</span> {t.label}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-unknown-bg px-3 py-1.5 text-sm font-semibold text-ink-2">Not scanned</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

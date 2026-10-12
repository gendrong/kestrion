'use client';

import type { FeedItem, PairFilter, RiskFilter, SortOrder, Stage } from '@kestrion/db/feed';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TokenAvatar } from '@/components/TokenAvatar';
import { LABEL_STYLE } from '@/lib/format';

type Filters = { stage: Stage | 'all'; pair: PairFilter | 'all'; risk: RiskFilter | 'all'; sort: SortOrder };

const STAGES: [Filters['stage'], string][] = [
  ['all', 'All'],
  ['new', 'New'],
  ['near', 'Near graduation'],
  ['graduated', 'Graduated'],
];
const PAIRS: [Filters['pair'], string][] = [
  ['all', 'Any'],
  ['ETH', 'ETH'],
  ['USDG', 'USDG'],
  ['Other', 'Other'],
];
const RISKS: [Filters['risk'], string][] = [
  ['all', 'Any'],
  ['low', 'Low'],
  ['caution', 'Caution'],
  ['high', 'High'],
];
const SORTS: [SortOrder, string][] = [
  ['newest', 'Newest'],
  ['safest', 'Safest'],
  ['riskiest', 'Riskiest'],
];
/** Feed refresh interval (paused while the tab is hidden). Each refresh = 1 DB read + 1 rate-limit command. */
const REFRESH_MS = 60_000;

function age(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function query(f: Filters) {
  const p = new URLSearchParams({ sort: f.sort, limit: '50' });
  if (f.stage !== 'all') p.set('stage', f.stage);
  if (f.pair !== 'all') p.set('pair', f.pair);
  if (f.risk !== 'all') p.set('risk', f.risk);
  return p.toString();
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm text-muted">{label}</span>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`min-h-10 cursor-pointer rounded-full border px-3.5 text-sm font-semibold transition ${
            value === v ? 'border-ink bg-ink text-paper' : 'border-[#CFCCC0] text-ink-2 hover:border-ink'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function LiveFeed({ initial, initialNow }: { initial: FeedItem[]; initialNow: number }) {
  const [filters, setFilters] = useState<Filters>({ stage: 'all', pair: 'all', risk: 'all', sort: 'newest' });
  const [items, setItems] = useState(initial);
  const [now, setNow] = useState(initialNow);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const first = useRef(true);

  const load = useCallback(async (f: Filters) => {
    setStatus((s) => (s === 'error' ? 'loading' : s));
    try {
      const res = await fetch(`/api/v1/launches?${query(f)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data: FeedItem[] };
      setItems(body.data);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
    setNow(Date.now());
  }, []);

  // Reload when filters change (not on first render: the server already sent the data).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setStatus('loading');
    void load(filters);
  }, [filters, load]);

  // Auto-refresh while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(filters);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [filters, load]);

  const set = <K extends keyof Filters>(k: K) => (v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-display text-[34px] font-bold tracking-[-0.035em] sm:text-[40px]">Live launches</h2>
          <span className="flex items-center gap-2 text-sm text-ink-3">
            <span className="size-2 rounded-full bg-ink shadow-[0_0_0_3px_#C6FF00]" aria-hidden="true" />
            Auto-refreshing · new Pons launches appear within minutes
          </span>
        </div>
        <Chips label="Sort" options={SORTS} value={filters.sort} onChange={set('sort')} />
      </div>
      <div className="flex flex-wrap gap-x-7 gap-y-3">
        <Chips label="Stage" options={STAGES} value={filters.stage} onChange={set('stage')} />
        <Chips label="Pair" options={PAIRS} value={filters.pair} onChange={set('pair')} />
        <Chips label="Risk" options={RISKS} value={filters.risk} onChange={set('risk')} />
      </div>

      <div className="overflow-hidden rounded-[20px] bg-card" aria-busy={status === 'loading'}>
        <div className="hidden grid-cols-[minmax(220px,2.2fr)_70px_110px_minmax(150px,1.4fr)_150px] gap-4 border-b border-line-soft px-6 py-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted md:grid">
          <span>Token</span>
          <span>Age</span>
          <span>Pair</span>
          <span>Curve</span>
          <span>Risk</span>
        </div>
        {items.length === 0 ? (
          <p className="px-6 py-12 text-center text-muted">
            {status === 'error' ? 'Could not load launches. Retrying…' : 'No launches match these filters yet.'}
          </p>
        ) : (
          <ul>
            {items.map((t) => {
              const style = t.label ? LABEL_STYLE[t.label as keyof typeof LABEL_STYLE] : undefined;
              const progress = t.graduated ? 100 : Math.max(0, Math.min(100, t.curveProgress ?? 0));
              return (
                <li key={t.address} className="border-b border-[#F3F1EA] last:border-b-0">
                  <Link
                    href={`/t/${t.address}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-paper/60 sm:px-6 md:grid-cols-[minmax(220px,2.2fr)_70px_110px_minmax(150px,1.4fr)_150px]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <TokenAvatar name={t.name} logoCid={t.logoCid} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{t.name || 'Unnamed'}</span>
                        <span className="block text-[13px] text-muted">
                          ${t.symbol}
                          <span className="md:hidden">
                            {' '}
                            · <span suppressHydrationWarning>{age(t.launchTime, now)}</span> · {t.pairSymbol}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span className="hidden text-[15px] text-ink-2 md:block" suppressHydrationWarning>
                      {age(t.launchTime, now)}
                    </span>
                    <span className="hidden justify-self-start rounded-full border border-line px-2.5 py-0.5 text-[13px] font-medium text-ink-2 md:inline-block">
                      {t.pairSymbol || t.pairType}
                    </span>
                    <span className="col-span-2 row-start-2 flex items-center gap-2.5 md:col-span-1 md:row-start-auto">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
                        <span className="block h-full rounded-full bg-ink" style={{ width: `${progress}%` }} />
                      </span>
                      <span className="w-[72px] text-[13px] text-ink-3">{t.graduated ? 'Graduated' : `${Math.round(progress)}%`}</span>
                    </span>
                    <span className={`justify-self-end rounded-full px-3 py-1.5 text-sm font-bold md:justify-self-start ${style?.badge ?? 'bg-unknown-bg text-ink-2'}`}>
                      <span className="font-display">{t.score ?? '–'}</span> {t.label ?? 'Pending'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted">
        <span>{items.length} recent launches shown</span>
        <span>Data, not advice. DYOR.</span>
      </div>
    </div>
  );
}

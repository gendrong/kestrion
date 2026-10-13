import { getToday, type TodayData } from '@kestrion/db';
import type { Metadata } from 'next';
import { TokenList } from '@/components/TokenList';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Today: lowest and highest scores of the last 24h',
  description: 'Pons launches of the last 24 hours on Robinhood Chain with the lowest and highest risk scores, and the biggest score changes. Data, not advice.',
  alternates: { canonical: '/today' },
};

async function load(): Promise<TodayData | null> {
  const db = getDb();
  if (!db) return null;
  try {
    return await getToday(db, { hours: 24, limit: 10 });
  } catch (e) {
    console.error('[today]', e);
    return null;
  }
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const id = title.toLowerCase().replace(/[^a-z]+/g, '-');
  return (
    <section className="rounded-3xl bg-card p-6 sm:p-7" aria-labelledby={id}>
      <h2 id={id} className="font-display text-2xl font-bold tracking-[-0.02em]">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{sub}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function TodayPage() {
  const today = await load();
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex max-w-[760px] flex-col gap-3">
        <span className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">Last 24 hours</span>
        <h1 className="font-display text-[clamp(38px,6vw,64px)] font-bold leading-[1] tracking-[-0.045em]">
          Today on <span className="highlight">Pons.</span>
        </h1>
        <p className="text-lg text-ink-2">The scanned launches of the last 24 hours with the most and the fewest flags.</p>
      </div>

      {!today ? (
        <p className="rounded-3xl bg-card p-6 text-ink-3">This page is temporarily unavailable. Please try again later.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Launches scanned', today.counts.total, 'bg-card'],
              ['Low risk', today.counts.low, 'bg-low-bg'],
              ['Caution', today.counts.caution, 'bg-caution-bg text-caution-fg'],
              ['High risk', today.counts.high, 'bg-high-bg text-high-fg'],
            ].map(([label, n, cls]) => (
              <div key={label as string} className={`flex flex-col gap-0.5 rounded-2xl p-4 ${cls}`}>
                <dt className="text-sm font-semibold">{label}</dt>
                <dd className="font-display text-[34px] font-bold leading-tight tracking-[-0.02em]">{n}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Lowest scores" sub="Most checks flagged. Open a report to see every deduction.">
              <TokenList
                empty="No launches scanned in the last 24 hours yet."
                items={today.riskiest.map((t) => ({ ...t, note: `$${t.symbol}` }))}
              />
            </Card>
            <Card title="Highest scores" sub="Fewest checks flagged. A high score is not a guarantee.">
              <TokenList
                empty="Not enough launches in the last 24 hours yet."
                items={today.cleanest.map((t) => ({ ...t, note: `$${t.symbol}` }))}
              />
            </Card>
          </div>

          <Card title="Biggest score changes" sub="Tokens whose score moved the most when they were scanned again.">
            <TokenList
              empty="Not enough data yet: tokens are rescanned later (watchlist and hourly rescans arrive with accounts)."
              items={today.changes.map((c) => ({
                address: c.token,
                name: c.name,
                symbol: c.symbol,
                logoCid: c.logoCid,
                launchTime: c.changedAt,
                score: c.newScore,
                label: c.label,
                badge: `${c.oldScore} → ${c.newScore}`,
                note: c.reason ?? 'score changed',
              }))}
            />
          </Card>
          <p className="px-1 text-sm font-semibold">Data, not advice. DYOR.</p>
        </>
      )}
    </div>
  );
}

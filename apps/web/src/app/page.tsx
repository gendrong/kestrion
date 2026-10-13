import { getFeed, parseFeedQuery, type FeedItem } from '@kestrion/db';
import Link from 'next/link';
import { LiveFeed } from '@/components/feed/LiveFeed';
import { SearchForm } from '@/components/SearchForm';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function initialFeed(): Promise<FeedItem[] | null> {
  const db = getDb();
  if (!db) return null;
  try {
    return await getFeed(db, parseFeedQuery({}));
  } catch (e) {
    console.error('[home] feed', e);
    return null;
  }
}

const CHECKS = [
  ['Snipe-tax exemptions', 'Wallets the creator exempted from the 99% launch tax, and whether the creator funded them (traced up to 2 hops).'],
  ['Creator cluster buy', 'Share of supply bought in the first ~30 seconds by the creator and wallets linked to them.'],
  ['Holder concentration', 'Top-10 holders’ share of supply, excluding curve, pool, locker and burn addresses.'],
  ['Creator history', 'Earlier launches by the same wallet, how many lost over 90% of their liquidity within 24 hours, reused tickers.'],
  ['Creator wallet', 'Wallet age and where its first funds came from: exchange, bridge, another wallet, or launch proceeds.'],
  ['Curve state', 'Bonding progress, graduation, and time since launch. Informational.'],
  ['Pair type', 'Paired with ETH, USDG or another token. Informational.'],
  ['Sell pressure', 'Share of their tokens the creator and linked wallets have sold or moved out.'],
] as const;

export default async function HomePage() {
  const feed = await initialFeed();
  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pb-16 pt-12 sm:px-6 sm:pt-16">
        <div className="flex max-w-[760px] flex-col gap-7">
          <span className="flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3 sm:text-sm">
            <span className="size-2 rounded-full bg-ink shadow-[0_0_0_4px_#C6FF00]" aria-hidden="true" />
            Risk reports for Pons launches on Robinhood Chain
          </span>
          <h1 className="font-display text-[clamp(46px,9vw,104px)] font-bold leading-[0.95] tracking-[-0.05em]">
            Hovers.
            <br />
            Watches.
            <br />
            Strikes before the <span className="highlight">rug.</span>
          </h1>
          <p className="max-w-[560px] text-lg text-ink-2 sm:text-[19px]">
            Paste a token address. Kestrion checks it in seconds and explains every point it deducts, with the raw
            numbers behind it.
          </p>
          <div className="max-w-[640px]">
            <SearchForm size="large" />
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-ink-2">
            {['8 rule-based checks', 'Every deduction explained', 'Read-only, never touches your funds'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-md bg-neon" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="feed" className="mx-auto max-w-[1240px] scroll-mt-4 px-4 pb-20 sm:px-6">
        <div className="border-t-[1.5px] border-ink pt-10">
          {feed ? (
            <LiveFeed initial={feed} initialNow={Date.now()} />
          ) : (
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-[34px] font-bold tracking-[-0.035em]">Live launches</h2>
              <p className="text-ink-3">The live feed is temporarily unavailable. You can still scan any token above.</p>
            </div>
          )}
        </div>
      </section>

      <section id="how" className="scroll-mt-4 border-y border-line bg-card">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-4 py-16 sm:px-6 sm:py-20">
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <span className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">How scoring works</span>
            <h2 className="font-display text-[clamp(34px,4.6vw,60px)] font-bold leading-[1.02] tracking-[-0.04em]">
              Every score is <span className="highlight">explainable.</span>
            </h2>
            <p className="text-lg text-ink-2">
              Each token starts at 100. Eight rule-based checks deduct points, and every deduction is shown with its
              reason and raw numbers. If a check can&apos;t be computed it shows as Unknown, never as a silent pass. No AI
              decides the score.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-[18px] bg-low-bg p-6">
              <span className="font-display text-4xl font-bold tracking-[-0.03em]">70–100</span>
              <span className="text-lg font-bold">Low risk</span>
              <span className="text-[15px] text-[#2A3300]">Few or minor deductions.</span>
            </div>
            <div className="flex flex-col gap-1 rounded-[18px] bg-caution-bg p-6 text-caution-fg">
              <span className="font-display text-4xl font-bold tracking-[-0.03em]">40–69</span>
              <span className="text-lg font-bold">Caution</span>
              <span className="text-[15px]">Some checks raised warnings.</span>
            </div>
            <div className="flex flex-col gap-1 rounded-[18px] bg-high-bg p-6 text-high-fg">
              <span className="font-display text-4xl font-bold tracking-[-0.03em]">0–39</span>
              <span className="text-lg font-bold">High risk</span>
              <span className="text-[15px]">Several checks failed.</span>
            </div>
          </div>

          <ol className="grid grid-cols-1 border-t border-line sm:grid-cols-2 lg:grid-cols-4">
            {CHECKS.map(([title, text], i) => (
              <li key={title} className="flex flex-col gap-2 border-b border-line py-6 pr-6">
                <span className="font-display text-sm font-bold text-muted">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-display text-xl font-semibold tracking-[-0.02em]">{title}</span>
                <span className="text-[15px] text-ink-3">{text}</span>
              </li>
            ))}
          </ol>
          <Link href="/about" className="link-neon inline-flex min-h-11 items-center self-start text-lg font-semibold">
            Every check, threshold and weight explained →
          </Link>
        </div>
      </section>
    </>
  );
}

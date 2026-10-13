import { ENGINE_CONFIG as C } from '@kestrion/engine/scoring';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How scoring works',
  description:
    'How Kestrion scores Robinhood Chain launches: eight rule-based checks, the points each one deducts, score bands, and the limits of the data. Data, not advice.',
  alternates: { canonical: '/about' },
};

const ch = C.checks;
const windowSec = Math.round(C.earlyWindowBlocks * 0.1);

/** Every check in report order, explained simply. Numbers come straight from the engine's scoring config. */
const CHECKS: { id: keyof typeof C.weights; title: string; what: string; rule: string }[] = [
  {
    id: 'exemptions',
    title: 'Snipe-tax exemptions',
    what: 'Pons V2 charges a 99% tax on buys in the first seconds after launch, to stop bots. The creator can exempt up to 32 wallets from it. We list those wallets and trace whether the creator funded them.',
    rule: `Warn with ${ch.exemptions.warnAtCount} or more exempt wallets (besides the creator, which the protocol exempts automatically). Fail with ${ch.exemptions.failAtCount} or more, if any exempt wallet was funded by or shares funding with the creator (up to 2 hops), or if together they bought ${ch.exemptions.failAtSupplyPct}% or more of the supply right after launch. Pons V1 has no exemption list (it uses a 2-block launch protection) and passes.`,
  },
  {
    id: 'clusterBuy',
    title: 'Creator cluster buy',
    what: `How much of the supply the creator and wallets linked to them bought in the first ${C.earlyWindowBlocks} blocks (about ${windowSec} seconds). Wallets count as linked when funding traces connect them to the creator.`,
    rule: `Warn from ${ch.clusterBuy.warnAtPct}% of supply, fail from ${ch.clusterBuy.failAtPct}%.`,
  },
  {
    id: 'holders',
    title: 'Holder concentration',
    what: `Share of the supply held by the top ${ch.holders.topN} wallets. The bonding curve, the pool, token lockers and burn addresses are left out: they are not real holders.`,
    rule: `Warn from ${ch.holders.warnAtPct}%, fail from ${ch.holders.failAtPct}%.`,
  },
  {
    id: 'creatorHistory',
    title: 'Creator history',
    what: `The creator wallet's earlier Pons launches: how many there are, how many "died fast", and whether names or tickers were reused. A launch died fast when the liquidity it raised fell by ${ch.creatorHistory.diedFast.dropPct}% or more within ${ch.creatorHistory.diedFast.windowHours} hours (only counted when it first raised at least ${ch.creatorHistory.diedFast.minPeakPctOfThreshold}% of its graduation target). The ${C.maxPriorLaunchesAnalyzed} most recent are analysed in detail.`,
    rule: `Warn from ${ch.creatorHistory.warnAtPriorLaunches} earlier launches, or if any died fast or reused the name or ticker. Fail from ${ch.creatorHistory.failAtPriorLaunches} earlier launches, or when ${ch.creatorHistory.failAtDiedFast}+ died fast and they are at least ${Math.round(ch.creatorHistory.failAtDiedFastRatio * 100)}% of the analysed ones.`,
  },
  {
    id: 'creatorWallet',
    title: 'Creator wallet',
    what: 'How old the creator wallet is and where its first ETH came from: an exchange, a bridge, another wallet, or the proceeds of a Pons launch.',
    rule: `Warn when the wallet is younger than ${ch.creatorWallet.freshDays} days or was funded by launch proceeds. Fail when it is new and was funded by another wallet that is also new.`,
  },
  {
    id: 'curveState',
    title: 'Curve state',
    what: 'Bonding progress (how close the token is to graduating to a Uniswap pool), whether it graduated, and how long ago it launched.',
    rule: 'Informational. Warn only when the protocol marked the launch as "Rescued" (it got stuck).',
  },
  {
    id: 'pairType',
    title: 'Pair type',
    what: 'What the token trades against: ETH, USDG (a US-dollar stablecoin) or another token, whose own price then moves this pair.',
    rule: 'Informational: never deducts points.',
  },
  {
    id: 'sellPressure',
    title: 'Sell pressure',
    what: 'How much of the tokens they received the creator and linked wallets have sold or moved out since launch. Tokens sent to lockers or burned are not counted as selling.',
    rule: `Warn from ${ch.sellPressure.warnAtPct}% sent out, fail from ${ch.sellPressure.failAtPct}%.`,
  },
];

const minus = (n: number) => (n > 0 ? `−${n}` : '0');

export default function AboutPage() {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-4">
        <span className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">About Kestrion</span>
        <h1 className="font-display text-[clamp(38px,6vw,64px)] font-bold leading-[1] tracking-[-0.045em]">
          How the score <span className="highlight">works.</span>
        </h1>
        <p className="text-lg text-ink-2">
          Kestrion watches every token launched on Pons (Robinhood Chain) and runs the same eight rule-based checks on each one.
          Every token starts at 100 points. Each check that warns, fails or can&apos;t be computed deducts points, and every
          deduction is shown in the report with its reason and the raw numbers behind it. No AI decides the score.
        </p>
      </header>

      <section aria-labelledby="bands-title" className="flex flex-col gap-4">
        <h2 id="bands-title" className="font-display text-3xl font-bold tracking-[-0.03em]">
          Score bands
        </h2>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-[18px] bg-low-bg p-6">
            <span className="font-display text-4xl font-bold tracking-[-0.03em]">{C.labels.low}–100</span>
            <span className="text-lg font-bold">Low risk</span>
            <span className="text-[15px] text-[#2A3300]">Few or minor deductions.</span>
          </div>
          <div className="flex flex-col gap-1 rounded-[18px] bg-caution-bg p-6 text-caution-fg">
            <span className="font-display text-4xl font-bold tracking-[-0.03em]">
              {C.labels.caution}–{C.labels.low - 1}
            </span>
            <span className="text-lg font-bold">Caution</span>
            <span className="text-[15px]">Some checks raised warnings.</span>
          </div>
          <div className="flex flex-col gap-1 rounded-[18px] bg-high-bg p-6 text-high-fg">
            <span className="font-display text-4xl font-bold tracking-[-0.03em]">0–{C.labels.caution - 1}</span>
            <span className="text-lg font-bold">High risk</span>
            <span className="text-[15px]">Several checks failed.</span>
          </div>
        </div>
        <p className="text-ink-2">
          <strong>Unknown is never a pass.</strong> When data for a check can&apos;t be loaded, the check shows as Unknown and
          still deducts a few points, so missing data can&apos;t make a token look cleaner than it is.
        </p>
      </section>

      <section aria-labelledby="checks-title" className="flex flex-col gap-4">
        <h2 id="checks-title" className="font-display text-3xl font-bold tracking-[-0.03em]">
          The eight checks
        </h2>
        <ol className="flex flex-col gap-3">
          {CHECKS.map((c, i) => {
            const w = C.weights[c.id];
            return (
              <li key={c.id} className="flex flex-col gap-2 rounded-3xl bg-card p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-display text-xl font-semibold tracking-[-0.02em]">
                    <span className="mr-2 text-sm font-bold text-muted">{String(i + 1).padStart(2, '0')}</span>
                    {c.title}
                  </h3>
                  <span className="text-sm text-ink-3">
                    Warn <strong className="text-warn-num">{minus(w.warn)}</strong> · Fail <strong className="text-high">{minus(w.fail)}</strong> · Unknown{' '}
                    <strong className="text-ink-2">{minus(w.unknown)}</strong>
                  </span>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-2">{c.what}</p>
                <p className="text-[15px] leading-relaxed text-ink-3">{c.rule}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="limits-title" className="flex flex-col gap-3">
        <h2 id="limits-title" className="font-display text-3xl font-bold tracking-[-0.03em]">
          Limits of the data
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
          <li>A report describes the token at the moment it was scanned. Things can change minutes later.</li>
          <li>Linked wallets come from funding traces (up to 2 hops). Unrelated people can share an exchange, and one person can use unconnected wallets.</li>
          <li>Exchanges and bridges are recognised by public explorer labels; an unlabeled exchange wallet counts as &ldquo;another wallet&rdquo;.</li>
          <li>Launches made through third-party launcher contracts may be missing from a creator&apos;s history.</li>
          <li>&ldquo;Died fast&rdquo; is computed for recent Pons V2 launches only.</li>
          <li>A token with almost no activity can score high simply because there is little to flag.</li>
          <li>The weights and thresholds are first estimates and will be tuned with feedback. Every report records the engine version that produced it.</li>
        </ul>
      </section>

      <section aria-labelledby="disclaimer-title" className="flex flex-col gap-3 rounded-3xl border-[1.5px] border-ink bg-card p-6">
        <h2 id="disclaimer-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
          Data, not advice. DYOR.
        </h2>
        <p className="text-ink-2">
          Kestrion reports on-chain facts and rule-based checks. It never tells you to buy or sell, and a high score is not a
          guarantee. Kestrion is read-only: it never holds keys or sends transactions.
        </p>
        <p className="text-ink-2">Kestrion is independent and not affiliated with Robinhood Markets or Pons Labs.</p>
        <Link href="/today" className="link-neon inline-flex min-h-11 items-center self-start font-semibold">
          See today&apos;s launches →
        </Link>
      </section>
    </div>
  );
}

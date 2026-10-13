import { listFollowedCreators, listWatchlist, TIERS } from '@kestrion/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { TokenList } from '@/components/TokenList';
import { SignInPrompt } from '@/components/wallet/SignInPrompt';
import { getDb } from '@/lib/db';
import { shortAddr, timeAgo } from '@/lib/format';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Watchlist', robots: { index: false } };

export default async function WatchlistPage() {
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !user) {
    return <SignInPrompt title="Your watchlist" text="Sign in with your wallet to watch tokens and follow creators. You get a notification when a watched token's score changes or a followed creator launches a new token." />;
  }
  const [tokens, creators] = await Promise.all([listWatchlist(db, user.wallet), listFollowedCreators(db, user.wallet)]);
  const limits = TIERS[user.tier];

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-[clamp(34px,5vw,52px)] font-bold tracking-[-0.04em]">Watchlist</h1>

      <section className="rounded-3xl bg-card p-6 sm:p-7" aria-labelledby="tokens-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tokens-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
            Tokens
          </h2>
          <span className="text-sm text-muted">
            {tokens.length} of {limits.watchlist} ({user.tier === 'holder' ? 'Holder' : 'Free'} account)
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">Rescanned about every hour. A badge shows the latest score change since you added it.</p>
        <div className="mt-3">
          <TokenList
            empty="No tokens yet. Open a token report and tap “Add to watchlist”."
            items={tokens.map((t) => ({
              ...t,
              badge: t.change ? `${t.change.oldScore} → ${t.change.newScore}` : undefined,
              note: t.change ? `score changed ${timeAgo(t.change.changedAt)}${t.change.reason ? `: ${t.change.reason}` : ''}` : `$${t.symbol}`,
            }))}
          />
        </div>
      </section>

      <section className="rounded-3xl bg-card p-6 sm:p-7" aria-labelledby="creators-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="creators-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
            Followed creators
          </h2>
          <span className="text-sm text-muted">
            {creators.length} of {limits.follows}
          </span>
        </div>
        {creators.length === 0 ? (
          <p className="px-1 py-6 text-ink-3">No creators yet. Open a creator page and tap “Follow creator”.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {creators.map((c) => (
              <li key={c.creator} className="border-t border-line-soft first:border-t-0">
                <Link href={`/creator/${c.creator}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-paper/60 sm:px-2">
                  <span className="font-mono text-sm">{shortAddr(c.creator)}</span>
                  <span className="text-sm text-ink-3">
                    {c.launches !== null ? `${c.launches} launch${c.launches === 1 ? '' : 'es'}` : 'Launches not counted yet'}
                    {c.lastLaunch ? ` · latest ${c.lastLaunch.name || c.lastLaunch.symbol} ${timeAgo(c.lastLaunch.launchTime)}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="px-1 text-sm font-semibold">Data, not advice. DYOR.</p>
    </div>
  );
}

import { enqueueCreatorLookup, isFollowing } from '@kestrion/db';
import { LINKS } from '@kestrion/engine/config';
import { ENGINE_CONFIG } from '@kestrion/engine/scoring';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { cache } from 'react';
import { CreatorLookup } from '@/components/creator/CreatorLookup';
import { SearchForm } from '@/components/SearchForm';
import { TokenList } from '@/components/TokenList';
import { normalizeAddress } from '@/lib/address';
import { loadCreatorView, type CreatorView, type Outcome } from '@/lib/creatorView';
import { getDb } from '@/lib/db';
import { FACTORY_NAME, formatAge, FUNDING_LABEL, shortAddr, timeAgo } from '@/lib/format';
import { rateLimit } from '@/lib/rateLimit';
import { DEFAULT_OG_IMAGE } from '@/lib/site';
import { FollowButton } from '@/components/wallet/ToggleButtons';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ address: string }> };

const DIED = ENGINE_CONFIG.checks.creatorHistory.diedFast;
const OUTCOME_TEXT: Record<Outcome, string> = {
  graduated: 'Graduated',
  died_fast: `Lost ≥${DIED.dropPct}% of liquidity within ${DIED.windowHours}h`,
  no_fast_drop: `No ≥${DIED.dropPct}% drop in its first ${DIED.windowHours}h`,
  unknown: '',
};

const creatorView = cache(async (address: string) => {
  const db = getDb();
  return db ? loadCreatorView(db, address) : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const address = normalizeAddress((await params).address);
  if (!address) return { title: 'Invalid address', robots: { index: false } };
  const view = await creatorView(address).catch(() => null);
  if (!view?.known) return { title: `Creator ${shortAddr(address)}`, robots: { index: false } };
  const s = view.stats;
  const title = `Creator ${shortAddr(address)}: ${s.launches}${s.launchesPartial ? '+' : ''} Pons launch${s.launches === 1 ? '' : 'es'}`;
  const description =
    `All Pons launches by ${address} with risk scores and outcomes` +
    (s.outcomeKnown > 0 ? `: ${s.diedFast} of ${s.outcomeKnown} with a known outcome lost ≥${DIED.dropPct}% of liquidity within ${DIED.windowHours}h.` : '.') +
    ' Data, not advice. DYOR.';
  return {
    title,
    description,
    alternates: { canonical: `/creator/${address}` },
    // A page's openGraph replaces the layout's, so the default image is repeated here.
    openGraph: { type: 'profile', title, description, url: `/creator/${address}`, images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [DEFAULT_OG_IMAGE] },
  };
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-card p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{title}</h1>
      <div className="mt-2 text-ink-2">{children}</div>
      <Link href="/" className="link-neon mt-4 inline-flex min-h-11 items-center font-semibold">
        Back to home
      </Link>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-paper p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-display text-[28px] font-bold leading-tight tracking-[-0.02em]">{value}</dd>
      {sub && <dd className="text-[13px] text-ink-3">{sub}</dd>}
    </div>
  );
}

function Profile({ view, following, signedIn }: { view: CreatorView; following: boolean; signedIn: boolean }) {
  const s = view.stats;
  const ageDays = view.firstSeen ? (Date.now() - Date.parse(view.firstSeen)) / 86_400_000 : null;
  const diedPct = s.outcomeKnown > 0 ? Math.round((s.diedFast / s.outcomeKnown) * 100) : null;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-5 rounded-3xl bg-card p-6 shadow-[0_1px_0_#E2E0D6,0_24px_60px_rgba(40,36,20,0.06)] sm:p-7" aria-labelledby="creator-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">Creator</span>
              <h1 id="creator-title" className="font-display text-[26px] font-bold tracking-[-0.02em]">
                {shortAddr(view.address)}
              </h1>
              <p className="font-mono text-[13px] break-all text-muted">{view.address}</p>
            </div>
            <FollowButton creator={view.address} following={following} signedIn={signedIn} />
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Pons launches" value={`${s.launches}${s.launchesPartial ? '+' : ''}`} sub={`${s.scanned} scanned by Kestrion`} />
            <Stat
              label={`Lost ≥${DIED.dropPct}% in ${DIED.windowHours}h`}
              value={diedPct !== null ? `${diedPct}%` : 'Unknown'}
              sub={s.outcomeKnown > 0 ? `${s.diedFast} of ${s.outcomeKnown} with known outcome` : 'No outcome known yet'}
            />
            <Stat label="Average score" value={s.averageScore ?? '–'} sub={s.scanned > 0 ? `over ${s.scanned} report${s.scanned === 1 ? '' : 's'}` : 'No reports yet'} />
            <Stat label="Graduated" value={s.graduated} sub="reached the bonding target" />
          </dl>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line-soft pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Wallet age</dt>
              <dd className="font-semibold">{ageDays !== null ? formatAge(ageDays) : 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-muted">First funded by</dt>
              <dd className="font-semibold">{view.fundingSource ? (FUNDING_LABEL[view.fundingSource] ?? view.fundingSource) : 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-muted">Profile updated</dt>
              <dd className="font-semibold">{view.updatedAt ? timeAgo(view.updatedAt) : 'Not yet'}</dd>
            </div>
          </dl>
          {view.funder && (
            <p className="-mt-2 text-sm text-ink-3">
              Funder: {view.funderLabel ? `${view.funderLabel} · ` : ''}
              <a href={LINKS.explorerAddress(view.funder)} target="_blank" rel="noopener noreferrer nofollow" className="font-mono underline">
                {shortAddr(view.funder)}
              </a>
            </p>
          )}
          <a
            href={LINKS.explorerAddress(view.address)}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="link-neon inline-flex min-h-11 items-center self-start font-semibold"
          >
            View wallet on explorer<span aria-hidden="true">&nbsp;↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </section>

        <section className="rounded-3xl bg-card p-6 sm:p-7" aria-labelledby="launches-title">
          <h2 id="launches-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
            All launches
          </h2>
          <p className="mt-1 text-sm text-muted">
            Newest first. Tap one for its full report; unscanned tokens get scanned when you open them.
          </p>
          {view.historyPending && (
            <p className="mt-3 rounded-xl bg-paper p-3 text-sm text-ink-2">
              Showing the launches we have scanned so far. The full on-chain launch history for this wallet is being looked up
              and appears here within a few minutes.
            </p>
          )}
          <div className="mt-3">
            <TokenList
              empty="No launches listed yet."
              items={view.launches.map((l) => ({
                address: l.token,
                name: l.name,
                symbol: l.symbol,
                logoCid: l.logoCid,
                launchTime: l.launchTime,
                score: l.score,
                label: l.label,
                note: [FACTORY_NAME[l.factoryId] ?? l.factoryId, OUTCOME_TEXT[l.outcome]].filter(Boolean).join(' · '),
              }))}
            />
          </div>
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        <section className="rounded-3xl bg-card p-6" aria-labelledby="linked-title">
          <h2 id="linked-title" className="font-display text-lg font-bold">
            Linked wallets
          </h2>
          <p className="text-sm text-muted">Wallets connected to this creator in its launches: shared funding, exemptions, or other roles.</p>
          {view.linkedWallets.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">None found in the scanned launches.</p>
          ) : (
            <ul className="mt-3 flex flex-col">
              {view.linkedWallets.map((w) => (
                <li key={w.address} className="flex flex-col gap-0.5 border-t border-line-soft py-2.5 first:border-t-0">
                  <a href={LINKS.explorerAddress(w.address)} target="_blank" rel="noopener noreferrer nofollow" className="font-mono text-sm underline decoration-line underline-offset-4 hover:decoration-ink">
                    {shortAddr(w.address)}
                  </a>
                  <span className="text-[13px] text-ink-3">{w.reasons.join(' · ')}</span>
                  {w.seenIn.length > 0 && (
                    <span className="text-[13px] text-muted">
                      In{' '}
                      {w.seenIn.map((t, i) => (
                        <span key={t}>
                          {i > 0 ? ', ' : ''}
                          <Link href={`/t/${t}`} className="underline">
                            {shortAddr(t)}
                          </Link>
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-3xl bg-card p-6 text-sm text-ink-3" aria-labelledby="creator-notes-title">
          <h2 id="creator-notes-title" className="font-display text-lg font-bold text-ink">
            About these numbers
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>
              &ldquo;Lost ≥{DIED.dropPct}%&rdquo; means the liquidity raised fell by at least {DIED.dropPct}% within {DIED.windowHours} hours
              of launch. It is computed for the most recent Pons V2 launches only; others show no outcome.
            </li>
            <li>Launches made through third-party launcher contracts may not be attributed to this wallet.</li>
            <li>Linked wallets come from funding traces of early buyers (up to 2 hops) and are not proof of common ownership.</li>
          </ul>
        </section>
        <p className="px-1 text-sm font-semibold">Data, not advice. DYOR.</p>
      </aside>
    </div>
  );
}

async function Body({ address }: { address: string | null }) {
  if (!address) {
    return (
      <Message title="That's not a valid address">
        A wallet address starts with <code className="font-mono">0x</code> followed by 40 letters and numbers. Check what you
        pasted and try again.
      </Message>
    );
  }
  const db = getDb();
  const view = await creatorView(address);
  if (!db || !view) return <Message title="Creator pages are temporarily unavailable">The database is not configured. Please try again later.</Message>;

  if (view.known) {
    // Scanned tokens but no on-chain search yet (e.g. profiles from before creator pages existed): look it up quietly.
    if (view.historyPending && (await rateLimit('enqueue', await headers())).ok) await enqueueCreatorLookup(db, address).catch(() => {});
    const user = await currentUser(db);
    const following = user ? await isFollowing(db, user.wallet, address) : false;
    return <Profile view={view} following={following} signedIn={!!user} />;
  }

  const limit = await rateLimit('enqueue', await headers());
  if (!limit.ok) return <Message title="Too many requests">You looked up many new wallets in a short time. Please wait a minute and try again.</Message>;
  const request = await enqueueCreatorLookup(db, address);
  if (request.status === 'no_launches') {
    return (
      <Message title="No Pons launches found for this wallet">
        We searched Pons V2, V1 active and V1 legacy and found no token launched by this wallet. If it is a token,{' '}
        <Link href={`/t/${address}`} className="font-semibold underline">
          open its report
        </Link>
        .
      </Message>
    );
  }
  if (request.status === 'failed') {
    return <Message title="The lookup could not be completed">We tried a few times and the search kept failing. Please try again later.</Message>;
  }
  return <CreatorLookup address={address} />;
}

export default async function CreatorPage({ params }: Props) {
  const address = normalizeAddress((await params).address);
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="max-w-[640px]">
        <SearchForm size="compact" />
      </div>
      <Body address={address} />
    </div>
  );
}

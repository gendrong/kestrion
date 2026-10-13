import type { ScanReport } from '@kestrion/engine/types';
import { enqueueScan, getLatestScan, isKnownCreator, WALLET_MARK } from '@kestrion/db';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { QueuedReport } from '@/components/report/QueuedReport';
import { Report } from '@/components/report/Report';
import { SearchForm } from '@/components/SearchForm';
import { normalizeAddress } from '@/lib/address';
import { getDb } from '@/lib/db';
import { shortAddr } from '@/lib/format';
import { rateLimit } from '@/lib/rateLimit';
import { addressKind } from '@/lib/resolve';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ address: string }> };

/** One DB read per request, shared by generateMetadata and the page. */
const latestScan = cache(async (address: string) => {
  const db = getDb();
  return db ? getLatestScan<ScanReport>(db, address) : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const address = normalizeAddress((await params).address);
  if (!address) return { title: 'Invalid address', robots: { index: false } };
  const latest = await latestScan(address).catch(() => null);
  if (!latest) {
    return {
      title: `Risk report ${shortAddr(address)}`,
      description: `Explainable risk report for token ${address} on Robinhood Chain. Data, not advice. DYOR.`,
      robots: { index: false },
    };
  }
  const r = latest.report;
  const title = `${r.token.name} ($${r.token.symbol}): ${r.score}/100 ${r.label}`;
  const description = `${r.summary} Data, not advice. DYOR.`.slice(0, 300);
  const image = { url: `/og/${address}?v=${encodeURIComponent(latest.scannedAt)}`, width: 1200, height: 630, alt: `${title} on Kestrion` };
  return {
    title,
    description,
    alternates: { canonical: `/t/${address}` },
    openGraph: { type: 'article', title, description, url: `/t/${address}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
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

async function Body({ address }: { address: string | null }) {
  if (!address) {
    return (
      <Message title="That's not a valid address">
        A token address starts with <code className="font-mono">0x</code> followed by 40 letters and numbers. Check what you
        pasted and try again.
      </Message>
    );
  }
  const db = getDb();
  if (!db) return <Message title="Reports are temporarily unavailable">The database is not configured. Please try again later.</Message>;

  const latest = await latestScan(address);
  if (latest) return <Report report={latest.report} />;

  // Not a scanned token. A wallet (known creator, or an address without contract code) goes to its creator page.
  if ((await isKnownCreator(db, address)) || (await addressKind(address)) === 'wallet') redirect(`/creator/${address}`);

  const limit = await rateLimit('enqueue', await headers());
  if (!limit.ok) return <Message title="Too many requests">You asked for many new scans in a short time. Please wait a minute and try again.</Message>;
  const request = await enqueueScan(db, address);
  // The scanner found it is a wallet, not a token.
  if (request.status === 'not_a_launch' && request.error === WALLET_MARK) redirect(`/creator/${address}`);
  if (request.status === 'not_a_launch') {
    return (
      <Message title="No Pons launch found for this address">
        This address is not a token launched on Pons (V2, V1 active or V1 legacy). If it is a wallet, see{' '}
        <Link href={`/creator/${address}`} className="font-semibold underline">
          its launches
        </Link>
        .
      </Message>
    );
  }
  return <QueuedReport address={address} status={request.status === 'done' ? 'queued' : request.status} />;
}

export default async function TokenReportPage({ params }: Props) {
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

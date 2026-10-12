import type { ScanReport } from '@kestrion/engine/types';
import { enqueueScan, getLatestScan } from '@kestrion/db';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { QueuedReport } from '@/components/report/QueuedReport';
import { Report } from '@/components/report/Report';
import { SearchForm } from '@/components/SearchForm';
import { normalizeAddress } from '@/lib/address';
import { getDb } from '@/lib/db';
import { shortAddr } from '@/lib/format';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const address = normalizeAddress((await params).address);
  if (!address) return { title: 'Invalid address', robots: { index: false } };
  return {
    title: `Risk report ${shortAddr(address)}`,
    description: `Explainable risk report for token ${address} on Robinhood Chain. Data, not advice. DYOR.`,
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

  const latest = await getLatestScan<ScanReport>(db, address);
  if (latest) return <Report report={latest.report} />;

  const limit = await rateLimit('enqueue', await headers());
  if (!limit.ok) return <Message title="Too many requests">You asked for many new scans in a short time. Please wait a minute and try again.</Message>;
  const request = await enqueueScan(db, address);
  if (request.status === 'not_a_launch') {
    return (
      <Message title="No Pons launch found for this address">
        This address is not a token launched on Pons (V2, V1 active or V1 legacy). Creator pages are coming soon.
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

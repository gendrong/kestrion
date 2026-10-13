'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { shortAddr } from '@/lib/format';

/**
 * Shown for a wallet we don't know yet: the next ingest run (every ~5 min) searches its launches on-chain.
 * Polls the API and refreshes the page when the launch list exists.
 */
export function CreatorLookup({ address }: { address: string }) {
  const router = useRouter();
  const [state, setState] = useState<'waiting' | 'no_launches' | 'failed'>('waiting');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (state !== 'waiting') return;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/creator/${address}`, { cache: 'no-store' });
        if (res.status === 200) router.refresh();
        else if (res.status === 404) setState('no_launches');
        else if (res.status === 202) {
          const body = (await res.json()) as { meta?: { status?: string } };
          if (body.meta?.status === 'failed') setState('failed');
        }
      } catch {
        /* keep waiting */
      }
    }, 20_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [address, router, state]);

  if (state !== 'waiting') {
    return (
      <section role="alert" className="rounded-3xl bg-card p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">
          {state === 'no_launches' ? 'No Pons launches found for this wallet' : 'The lookup could not be completed'}
        </h1>
        <p className="mt-2 text-ink-2">
          {state === 'no_launches'
            ? 'We searched Pons V2, V1 active and V1 legacy and found no token launched by this wallet.'
            : 'We tried a few times and the search kept failing. Please try again later.'}
        </p>
        <Link href="/" className="link-neon mt-4 inline-flex min-h-11 items-center font-semibold">
          Back to home
        </Link>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-card p-6 sm:p-8" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="size-3 animate-pulse rounded-full bg-neon shadow-[0_0_0_4px_#0A0A0A]" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">Looking up launches by {shortAddr(address)}</h1>
      </div>
      <p className="text-ink-2">
        We haven&apos;t seen this wallet launch a token yet, so our scanner is searching Pons for its launches. This page
        updates by itself when the list is ready, usually within about 5 minutes.
      </p>
      <p className="text-sm text-muted">
        Waiting {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · you can leave and come back later.
      </p>
      <p className="font-mono text-sm break-all text-muted">{address}</p>
    </section>
  );
}

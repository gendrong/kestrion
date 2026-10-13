'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { shortAddr } from '@/lib/format';

/**
 * Shown when a token has no scan yet: it is in the queue and the next ingest run (every ~5 min) scans it.
 * Polls the API and refreshes the page as soon as the report exists.
 */
export function QueuedReport({ address, status }: { address: string; status: 'queued' | 'scanning' | 'failed' }) {
  const router = useRouter();
  const [state, setState] = useState<'waiting' | 'not_a_launch' | 'failed'>(status === 'failed' ? 'failed' : 'waiting');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (state !== 'waiting') return;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/token/${address}`, { cache: 'no-store' });
        if (res.status === 200) router.refresh();
        // Not a token: let the server decide (a wallet redirects to its creator page).
        else if (res.status === 404) {
          setState('not_a_launch');
          router.refresh();
        }
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

  if (state === 'not_a_launch') {
    return (
      <section role="alert" className="rounded-3xl bg-card p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">No Pons launch found for this address</h1>
        <p className="mt-2 text-ink-2">
          This address is not a token launched on Pons (V2, V1 active or V1 legacy). If it is a wallet, see{' '}
          <Link href={`/creator/${address}`} className="font-semibold underline">
            its launches
          </Link>
          .
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
        <span className={`size-3 rounded-full ${state === 'failed' ? 'bg-high' : 'animate-pulse bg-neon shadow-[0_0_0_4px_#0A0A0A]'}`} aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">
          {state === 'failed' ? 'The scan could not be completed' : `Queued for scanning: ${shortAddr(address)}`}
        </h1>
      </div>
      {state === 'failed' ? (
        <p className="text-ink-2">We tried a few times and the scan kept failing. Please try again later.</p>
      ) : (
        <>
          <p className="text-ink-2">
            This token hasn&apos;t been scanned yet. Our scanner runs every few minutes and new Pons launches are picked up
            automatically. This page updates by itself when the report is ready, usually within about 5 minutes.
          </p>
          <p className="text-sm text-muted">
            Waiting {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · you can leave and come back later.
          </p>
        </>
      )}
      <p className="font-mono text-sm break-all text-muted">{address}</p>
    </section>
  );
}

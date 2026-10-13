'use client';

/** "Add to watchlist" / "Follow creator" toggles and the Rescan button. Not signed in → opens the wallet sign-in. */
import { useState } from 'react';
import { requestSignIn } from './AccountMenu';

function Toggle({
  endpoint,
  payload,
  on,
  signedIn,
  labels,
}: {
  endpoint: string;
  payload: Record<string, string>;
  on: boolean;
  signedIn: boolean;
  labels: { off: string; on: string };
}) {
  const [active, setActive] = useState(on);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function click() {
    if (!signedIn) return requestSignIn();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, action: active ? 'remove' : 'add' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; watching?: boolean; following?: boolean };
      if (!res.ok) setMessage(body.error ?? 'Something went wrong');
      else setActive(Boolean(body.watching ?? body.following));
    } catch {
      setMessage('Network error, please try again');
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={click}
        disabled={busy}
        aria-pressed={active}
        className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 font-display font-bold transition disabled:opacity-60 ${
          active ? 'border border-ink bg-card text-ink hover:bg-paper' : 'bg-ink text-neon hover:bg-ink-2'
        }`}
      >
        <span aria-hidden="true">{active ? '✓' : '+'}</span>
        {active ? labels.on : labels.off}
      </button>
      {message && (
        <span role="status" className="text-sm text-high-fg">
          {message}
        </span>
      )}
    </div>
  );
}

export const WatchButton = ({ token, watching, signedIn }: { token: string; watching: boolean; signedIn: boolean }) => (
  <Toggle endpoint="/api/watchlist" payload={{ token }} on={watching} signedIn={signedIn} labels={{ off: 'Add to watchlist', on: 'On your watchlist' }} />
);

export const FollowButton = ({ creator, following, signedIn }: { creator: string; following: boolean; signedIn: boolean }) => (
  <Toggle endpoint="/api/follow" payload={{ creator }} on={following} signedIn={signedIn} labels={{ off: 'Follow creator', on: 'Following' }} />
);

export function RescanButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'error'>('idle');
  const [message, setMessage] = useState('');
  async function click() {
    setState('busy');
    try {
      const res = await fetch(`/api/v1/scan/${token}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (res.status === 202) {
        setState('queued');
        setMessage('Rescan queued: the report updates once it has run (full scans run while the day’s explorer budget allows).');
      } else {
        setState('error');
        setMessage(body.error?.message ?? 'Could not queue a rescan');
      }
    } catch {
      setState('error');
      setMessage('Network error, please try again');
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={click}
        disabled={state === 'busy' || state === 'queued'}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line px-4 font-display font-bold hover:border-ink disabled:cursor-default disabled:opacity-60"
      >
        {state === 'queued' ? 'Rescan queued' : 'Rescan'}
      </button>
      {message && (
        <span role="status" className={`text-sm ${state === 'error' ? 'text-high-fg' : 'text-ink-3'}`}>
          {message}
        </span>
      )}
    </div>
  );
}

'use client';

/** "Flag this report": tell us a report looks wrong (false positive / missed risk). Signed-in only. */
import { useState } from 'react';
import { requestSignIn } from '@/components/wallet/AccountMenu';

export function FlagButton({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'false_positive' | 'missed_risk'>('false_positive');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    const res = await fetch('/api/flags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, type, note: note.trim() || undefined }),
    }).catch(() => null);
    if (res?.ok) return setState('sent');
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(body?.error ?? 'Could not send the flag');
    setState('error');
  }

  if (state === 'sent') return <p role="status" className="text-sm text-ink-3">Thanks, the flag was sent. We review every one.</p>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => (signedIn ? setOpen(true) : requestSignIn())}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-xl px-1 font-semibold text-ink-3 underline decoration-line underline-offset-4 hover:text-ink"
      >
        Flag this report
      </button>
    );
  }
  return (
    <form onSubmit={send} className="flex w-full flex-col gap-3 rounded-2xl bg-paper p-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">What looks wrong?</legend>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name="flag-type" checked={type === 'false_positive'} onChange={() => setType('false_positive')} />
          The score is too harsh (false positive)
        </label>
        <label className="flex min-h-9 items-center gap-2">
          <input type="radio" name="flag-type" checked={type === 'missed_risk'} onChange={() => setType('missed_risk')} />
          A risk was missed
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Details (optional)
        <textarea
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-xl border-[1.5px] border-ink bg-card p-2 text-base font-normal"
          placeholder="What did you notice? Links to transactions help."
        />
      </label>
      {state === 'error' && (
        <p role="alert" className="text-sm text-high-fg">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={state === 'busy'} className="min-h-11 cursor-pointer rounded-xl bg-ink px-4 font-display font-bold text-neon disabled:opacity-60">
          Send flag
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 cursor-pointer rounded-xl border border-line px-4 font-semibold">
          Cancel
        </button>
      </div>
    </form>
  );
}

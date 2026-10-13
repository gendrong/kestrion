'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Change a flag's status. */
export function FlagStatusButtons({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(next: string) {
    setBusy(true);
    await fetch('/api/admin/flags', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status: next }) }).catch(() => {});
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {(['reviewed', 'dismissed', 'open'] as const)
        .filter((s) => s !== status)
        .map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => set(s)}
            className="min-h-9 cursor-pointer rounded-lg border border-line px-2.5 text-sm font-semibold capitalize hover:border-ink disabled:opacity-50"
          >
            {s === 'open' ? 'Reopen' : s}
          </button>
        ))}
    </div>
  );
}

/** Queue full rescans for pasted addresses. */
export function RescanForm() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const addresses = text.match(/0x[0-9a-fA-F]{40}/g) ?? [];
    const res = await fetch('/api/admin/rescan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addresses }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { queued?: number; error?: string } | undefined;
    setResult(res?.ok ? `${body?.queued} full scan(s) queued.` : (body?.error ?? 'Failed'));
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Token addresses (any separator, up to 50)
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-xl border-[1.5px] border-ink bg-card p-2 font-mono text-sm font-normal" />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="min-h-11 cursor-pointer rounded-xl bg-ink px-4 font-display font-bold text-neon">
          Queue full scans
        </button>
        {result && (
          <span role="status" className="text-sm text-ink-3">
            {result}
          </span>
        )}
      </div>
    </form>
  );
}

'use client';

/** Create / list / revoke API keys. A new key is shown once (only its hash is stored). */
import { useCallback, useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';

type KeyInfo = { id: number; name: string; prefix: string; tier: string; createdAt: string; lastUsed: string | null };

export function KeyManager() {
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [max, setMax] = useState(5);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/keys', { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as { keys?: KeyInfo[]; max?: number; error?: string };
    if (!res.ok) return setError(body.error ?? 'Could not load your keys');
    setKeys(body.keys ?? []);
    if (body.max) setMax(body.max);
  }, []);
  useEffect(() => void load(), [load]);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
    setBusy(false);
    if (!res.ok || !body.key) return setError(body.error ?? 'Could not create a key');
    setFresh(body.key);
    setCopied(false);
    setName('');
    void load();
  }

  async function revoke(id: number) {
    if (!window.confirm('Revoke this key? Scripts using it stop working right away.')) return;
    await fetch('/api/keys', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    void load();
  }

  return (
    <div className="flex flex-col gap-4">
      {fresh && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-ink bg-low-bg/30 p-4">
          <strong>Your new API key. Copy it now: it is shown only once.</strong>
          <code className="break-all rounded-lg bg-card p-2 font-mono text-sm">{fresh}</code>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(fresh).catch(() => {});
                setCopied(true);
              }}
              className="min-h-10 cursor-pointer rounded-xl bg-ink px-4 font-display font-bold text-neon"
            >
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <button type="button" onClick={() => setFresh(null)} className="min-h-10 cursor-pointer rounded-xl border border-line px-4 font-semibold">
              Done
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-sm font-semibold">
          Key name (optional)
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my trading bot"
            className="h-11 rounded-xl border-[1.5px] border-ink bg-card px-3 text-base font-normal"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy || (keys?.length ?? 0) >= max}
          className="h-11 cursor-pointer rounded-xl bg-ink px-5 font-display font-bold text-neon hover:bg-ink-2 disabled:cursor-default disabled:opacity-50"
        >
          Create API key
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-high-fg">
          {error}
        </p>
      )}
      {keys === null ? (
        <p className="text-sm text-muted">Loading your keys…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-ink-3">No keys yet. Up to {max} at a time.</p>
      ) : (
        <ul className="flex flex-col">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft py-3 first:border-t-0">
              <span className="flex flex-col">
                <span className="font-semibold">{k.name}</span>
                <span className="font-mono text-[13px] text-muted">
                  {k.prefix}… · created {timeAgo(k.createdAt)} · {k.lastUsed ? `last used ${timeAgo(k.lastUsed)}` : 'never used'}
                </span>
              </span>
              <button type="button" onClick={() => revoke(k.id)} className="min-h-10 cursor-pointer rounded-xl px-3 font-semibold text-high-fg hover:bg-high-bg">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

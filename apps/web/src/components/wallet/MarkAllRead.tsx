'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/notifications/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
        router.refresh();
        setBusy(false);
      }}
      className="min-h-11 cursor-pointer rounded-xl border border-line px-4 font-display font-bold hover:border-ink disabled:opacity-60"
    >
      Mark all as read
    </button>
  );
}

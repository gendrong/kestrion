'use client';

import { useState } from 'react';

/**
 * Share a page: the phone's share sheet when available (most mobile browsers), otherwise copy the link.
 * Also offers a post on X. The text stays factual (score + label), never a recommendation.
 */
export function ShareButton({ url, text }: { url: string; text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function share() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: text, text, url });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // the user closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  }

  const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-ink px-4 font-display font-bold text-neon transition hover:bg-ink-2"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
          <path d="m16 6-4-4-4 4" />
          <path d="M12 2v14" />
        </svg>
        Share report
      </button>
      <a href={xUrl} target="_blank" rel="noopener noreferrer" className="link-neon inline-flex min-h-11 items-center font-semibold">
        Post on X<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <span role="status" aria-live="polite" className="text-sm text-ink-3">
        {state === 'copied' ? 'Link copied' : state === 'failed' ? `Copy this link: ${url}` : ''}
      </span>
    </div>
  );
}

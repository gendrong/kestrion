'use client';

/**
 * Header account area: "Sign in" (opens the wallet sign-in, loaded on demand), or the notification bell with the
 * unread count + watchlist + sign out. Other components ask for sign-in with `requestSignIn()`.
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { shortAddr } from '@/lib/format';

const WalletSignIn = dynamic(() => import('./WalletSignIn'), { ssr: false });

const SIGN_IN_EVENT = 'kestrion:signin';
/** Ask the header to open the wallet sign-in (e.g. from a Watch button). */
export const requestSignIn = () => window.dispatchEvent(new Event(SIGN_IN_EVENT));

type Me = { user: { address: string; tier: string } | null; unread?: number };
const REFRESH_MS = 60_000;

export function AccountMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      setMe((await res.json()) as Me);
    } catch {
      setMe((m) => m ?? { user: null });
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    const open = () => setSigningIn(true);
    window.addEventListener(SIGN_IN_EVENT, open);
    return () => {
      clearInterval(t);
      window.removeEventListener(SIGN_IN_EVENT, open);
    };
  }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const onSignedIn = useCallback(() => {
    // Reload so every page (watch buttons, watchlist) renders for the signed-in user.
    window.location.reload();
  }, []);
  const onClose = useCallback(() => setSigningIn(false), []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  }

  if (!me) return <span className="h-10 w-20" aria-hidden="true" />;

  if (!me.user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSigningIn(true)}
          className="min-h-10 cursor-pointer rounded-xl bg-ink px-3.5 font-display text-[15px] font-bold text-neon hover:bg-ink-2"
        >
          Sign in
        </button>
        {signingIn && <WalletSignIn onClose={onClose} onSignedIn={onSignedIn} />}
      </>
    );
  }

  const unread = me.unread ?? 0;
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex size-10 items-center justify-center rounded-xl hover:bg-line-soft"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-bold leading-5 text-neon">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="min-h-10 cursor-pointer rounded-xl border border-line px-2.5 font-mono text-[13px] hover:border-ink"
        >
          {shortAddr(me.user.address)}
        </button>
        {menuOpen && (
          <div role="menu" className="absolute right-0 top-12 z-40 flex w-52 flex-col rounded-2xl border border-line bg-card p-1.5 shadow-[0_12px_40px_rgba(40,36,20,0.12)]">
            <Link role="menuitem" href="/watchlist" className="rounded-xl px-3 py-2.5 font-medium hover:bg-paper" onClick={() => setMenuOpen(false)}>
              Watchlist
            </Link>
            <Link role="menuitem" href="/notifications" className="rounded-xl px-3 py-2.5 font-medium hover:bg-paper" onClick={() => setMenuOpen(false)}>
              Notifications
            </Link>
            <span className="px-3 py-1 text-xs text-muted">{me.user.tier === 'holder' ? 'Holder' : 'Free'} account</span>
            <button type="button" role="menuitem" onClick={signOut} className="cursor-pointer rounded-xl px-3 py-2.5 text-left font-medium text-high-fg hover:bg-high-bg">
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

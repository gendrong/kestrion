import { listNotifications } from '@kestrion/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MarkAllRead } from '@/components/wallet/MarkAllRead';
import { SignInPrompt } from '@/components/wallet/SignInPrompt';
import { getDb } from '@/lib/db';
import { timeAgo } from '@/lib/format';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };

export default async function NotificationsPage() {
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !user) {
    return <SignInPrompt title="Notifications" text="Sign in with your wallet to get notified when a token on your watchlist changes score or a creator you follow launches a new token." />;
  }
  const list = await listNotifications(db, user.wallet, 100);
  const unread = list.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[clamp(34px,5vw,52px)] font-bold tracking-[-0.04em]">Notifications</h1>
        {unread > 0 && <MarkAllRead />}
      </div>
      {list.length === 0 ? (
        <p className="rounded-3xl bg-card p-6 text-ink-3">
          Nothing yet. Add tokens to your <Link href="/watchlist" className="underline">watchlist</Link> or follow creators: changes show up
          here.
        </p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-3xl bg-card">
          {list.map((n) => (
            <li key={n.id} className={`border-t border-line-soft first:border-t-0 ${n.readAt ? '' : 'bg-low-bg/25'}`}>
              <Link href={n.token ? `/t/${n.token}` : n.creator ? `/creator/${n.creator}` : '/watchlist'} className="flex flex-col gap-1 px-5 py-4 hover:bg-paper/60">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">
                  {!n.readAt && <span className="size-2 rounded-full bg-ink" aria-label="Unread" />}
                  {n.type === 'score_changed' ? 'Score changed' : 'New launch by a followed creator'}
                  <span className="font-normal normal-case tracking-normal text-muted">· {timeAgo(n.createdAt)}</span>
                </span>
                <span className="text-[15px] text-ink">{n.message}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="px-1 text-sm font-semibold">Data, not advice. DYOR.</p>
    </div>
  );
}

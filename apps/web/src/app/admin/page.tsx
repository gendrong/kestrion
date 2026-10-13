import { adminOverview, listFlags, type JobState } from '@kestrion/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlagStatusButtons, RescanForm } from '@/components/admin/AdminActions';
import { isAdmin } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { shortAddr, timeAgo } from '@/lib/format';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

const STALE_MS = 15 * 60_000;

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-card p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-display text-[28px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{value}</dd>
    </div>
  );
}

function jobLine(j: JobState): string {
  const s = j.stats;
  if (j.job.startsWith('ingest:pons')) return `${s.launches ?? 0} launches · ${s.scanned ?? 0} scanned · ${s.failed ?? 0} failed`;
  if (j.job.startsWith('index:')) return `block ${j.last_block ?? '–'} · +${s.added ?? 0} this step`;
  if (j.job === 'explorer:credits') return `${s.remaining ?? '?'} credits left (${s.day ?? ''})`;
  if (j.job === 'rescan') return `${s.scanned ?? 0} rescanned · ${s.watchedDone ?? 0}/${s.watched ?? 0} watched · ${s.deferred ?? 0} waiting`;
  if (j.job === 'ingest:queue') return `${s.processed ?? 0} queued scans · index ${s.indexComplete ? 'complete' : 'filling'} · ${s.promoted ?? 0} promoted`;
  return JSON.stringify(s).slice(0, 120);
}

/** Tokens per score decile: one series (no legend), ink bars with 4px rounded tops on the baseline, 2px gaps. */
function Distribution({ counts }: { counts: number[] }) {
  const W = 360;
  const H = 150;
  const base = H - 24;
  const max = Math.max(1, ...counts);
  const slot = (W - 20) / counts.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Tokens per score range: ${counts.map((n, i) => `${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${n}`).join(', ')}`}>
      <line x1="10" x2={W - 10} y1={base} y2={base} stroke="#DEDBCF" />
      {counts.map((n, i) => {
        const h = Math.max(n > 0 ? 3 : 0, (n / max) * (base - 16));
        const x = 10 + i * slot + 1;
        const w = slot - 2;
        return (
          <g key={i}>
            <title>{`Score ${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${n} token${n === 1 ? '' : 's'}`}</title>
            <rect x={x} y={0} width={w} height={base} fill="transparent" />
            {h > 0 && <path d={`M${x},${base} V${base - h + 4} Q${x},${base - h} ${x + 4},${base - h} H${x + w - 4} Q${x + w},${base - h} ${x + w},${base - h + 4} V${base} Z`} fill="#0A0A0A" />}
            {n > 0 && (
              <text x={x + w / 2} y={base - h - 4} textAnchor="middle" fontSize="9" fill="#3D3B35">
                {n}
              </text>
            )}
            <text x={x + w / 2} y={H - 10} textAnchor="middle" fontSize="9" fill="#6B685E">
              {i * 10}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function AdminPage() {
  const db = getDb();
  const user = await currentUser(db);
  if (!db || !isAdmin(user)) notFound();
  const [o, flags] = await Promise.all([adminOverview(db), listFlags(db, 'open', 50)]);
  const now = Date.now();

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="font-display text-[clamp(32px,5vw,48px)] font-bold tracking-[-0.04em]">Admin</h1>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Scanned tokens" value={o.counts.tokens} />
        <Tile label="Scans, last 24h" value={o.counts.scans24h} />
        <Tile label="Quick-scan only" value={o.counts.quick} />
        <Tile label="Launch index" value={o.counts.indexed} />
        <Tile label="Queued scans" value={o.counts.queued} />
        <Tile label="Failed scans" value={o.counts.failed} />
        <Tile label="Users" value={o.counts.users} />
        <Tile label="Open flags" value={o.counts.openFlags} />
      </dl>

      <section className="rounded-3xl bg-card p-6" aria-labelledby="jobs-title">
        <h2 id="jobs-title" className="font-display text-xl font-bold">
          Job health
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-[0.06em] text-muted">
                <th scope="col" className="py-2 font-semibold">Job</th>
                <th scope="col" className="py-2 font-semibold">Last run</th>
                <th scope="col" className="py-2 font-semibold">Status</th>
                <th scope="col" className="py-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {o.jobs.map((j) => {
                const stale = j.last_run ? now - Date.parse(j.last_run) > STALE_MS : true;
                const bad = j.status === 'error' || j.status === 'exhausted';
                return (
                  <tr key={j.job} className="border-t border-line-soft align-top">
                    <td className="py-2 pr-3 font-mono">{j.job}</td>
                    <td className={`py-2 pr-3 ${stale && j.job.startsWith('ingest') ? 'font-semibold text-high-fg' : ''}`}>{j.last_run ? timeAgo(j.last_run) : 'never'}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${bad ? 'bg-high-bg text-high-fg' : j.status === 'partial' ? 'bg-caution-bg text-caution-fg' : 'bg-low-bg'}`}>
                        {j.status ?? '–'}
                      </span>
                    </td>
                    <td className="py-2 text-ink-2">
                      {jobLine(j)}
                      {j.error && <span className="mt-0.5 block break-all font-mono text-[12px] text-high-fg">{j.error.slice(0, 240)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-3xl bg-card p-6" aria-labelledby="dist-title">
          <h2 id="dist-title" className="font-display text-xl font-bold">
            Score distribution
          </h2>
          <p className="text-sm text-muted">Scanned tokens per score range (latest score of each token).</p>
          <div className="mt-3">
            <Distribution counts={o.distribution} />
          </div>
        </section>
        <section className="rounded-3xl bg-card p-6" aria-labelledby="rescan-title">
          <h2 id="rescan-title" className="font-display text-xl font-bold">
            Trigger rescans
          </h2>
          <p className="mb-3 text-sm text-muted">Queued as full scans; they run while the day’s explorer credits allow.</p>
          <RescanForm />
        </section>
      </div>

      <section className="rounded-3xl bg-card p-6" aria-labelledby="flags-title">
        <h2 id="flags-title" className="font-display text-xl font-bold">
          Open flags ({flags.length})
        </h2>
        {flags.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">No open flags.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {flags.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 border-t border-line-soft py-3 first:border-t-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${f.type === 'missed_risk' ? 'bg-high-bg text-high-fg' : 'bg-caution-bg text-caution-fg'}`}>
                      {f.type === 'missed_risk' ? 'Missed risk' : 'False positive'}
                    </span>
                    <Link href={`/t/${f.token}`} className="font-semibold underline">
                      {f.tokenName || shortAddr(f.token)} {f.tokenSymbol ? `$${f.tokenSymbol}` : ''}
                    </Link>
                    <span className="text-sm text-muted">
                      score {f.score ?? '–'} · by {f.wallet ? shortAddr(f.wallet) : 'deleted user'} · {timeAgo(f.createdAt)}
                    </span>
                  </span>
                  <FlagStatusButtons id={f.id} status={f.status} />
                </div>
                {f.note && <p className="whitespace-pre-wrap break-words text-[15px] text-ink-2">{f.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

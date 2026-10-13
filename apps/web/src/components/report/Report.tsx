'use client';

import { LINKS } from '@kestrion/engine/config';
import type { ScanReport, ScoredCheck } from '@kestrion/engine/types';
import Link from 'next/link';
import { ShareButton } from '@/components/ShareButton';
import { SITE_URL } from '@/lib/site';
import { FACTORY_NAME, formatAge, FUNDING_LABEL, humanKey, initials, LABEL_STYLE, shortAddr, STATUS_STYLE, timeAgo } from '@/lib/format';

const External = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="link-neon inline-flex min-h-11 items-center font-semibold">
    {children}
    <span aria-hidden="true">&nbsp;↗</span>
    <span className="sr-only"> (opens in a new tab)</span>
  </a>
);

export function Report({ report }: { report: ScanReport }) {
  const style = LABEL_STYLE[report.label];
  const checksById = Object.fromEntries(report.checks.map((c) => [c.id, c])) as Record<string, ScoredCheck>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        {/* Score */}
        <section className="flex flex-col gap-5 rounded-3xl bg-card p-6 shadow-[0_1px_0_#E2E0D6,0_24px_60px_rgba(40,36,20,0.06)] sm:p-7" aria-labelledby="token-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-line-soft font-display font-bold" aria-hidden="true">
                {initials(report.token.name)}
              </span>
              <div className="min-w-0">
                <h1 id="token-title" className="truncate font-display text-[22px] font-semibold tracking-[-0.02em]">
                  {report.token.name} <span className="text-muted">${report.token.symbol}</span>
                </h1>
                <p className="font-mono text-[13px] break-all text-muted">{report.token.address}</p>
              </div>
            </div>
            <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">
              {FACTORY_NAME[report.launchpad.factoryId] ?? report.launchpad.factoryId}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <span className={`font-display text-[96px] font-bold leading-[0.85] tracking-[-0.05em] sm:text-[112px] ${style.score}`}>
              {report.score}
            </span>
            <div className="flex flex-col gap-1.5 pb-1.5">
              <span className={`self-start rounded-full px-3 py-1 text-sm font-bold ${style.badge}`}>{report.label}</span>
              <span className="text-sm text-muted">Score out of 100</span>
            </div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-line-soft" role="img" aria-label={`Score ${report.score} out of 100`}>
            <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${report.score}%` }} />
          </div>
          <p className="text-[17px] leading-relaxed text-ink-2">{report.summary}</p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line-soft pt-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Pair</dt>
              <dd className="font-semibold">{report.pair.type === 'Other' ? `${report.pair.symbol} (other token)` : report.pair.symbol}</dd>
            </div>
            <div>
              <dt className="text-muted">Curve</dt>
              <dd className="font-semibold">{report.curve ? (report.curve.graduated ? 'Graduated' : `${report.curve.progressPct}%`) : 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-muted">Launched</dt>
              <dd className="font-semibold">{timeAgo(report.launch.time)}</dd>
            </div>
            <div>
              <dt className="text-muted">Last scanned</dt>
              <dd className="font-semibold">
                <time dateTime={report.scannedAt}>{timeAgo(report.scannedAt)}</time>
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-x-6">
            <External href={LINKS.ponsToken(report.token.address)}>View on Pons</External>
            <External href={LINKS.explorerToken(report.token.address)}>Explorer</External>
          </div>
          <div className="border-t border-line-soft pt-4">
            <ShareButton
              url={`${SITE_URL}/t/${report.token.address.toLowerCase()}`}
              text={`${report.token.name} (${report.token.symbol}): ${report.score}/100 ${report.label} on Kestrion. Data, not advice.`}
            />
          </div>
        </section>

        {/* Checks */}
        <section className="rounded-3xl bg-card p-6 sm:p-7" aria-labelledby="checks-title">
          <h2 id="checks-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
            All checks
          </h2>
          <p className="mt-1 text-sm text-muted">Every token starts at 100. Each warning, failure or unknown result deducts points.</p>
          <ul className="mt-4 flex flex-col">
            {report.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        <CreatorCard report={report} wallet={checksById.creatorWallet} history={checksById.creatorHistory} />
        <HoldersCard report={report} />
        {report.notes.length > 0 && (
          <section className="rounded-3xl bg-card p-6" aria-labelledby="notes-title">
            <h2 id="notes-title" className="font-display text-lg font-bold">
              Data notes
            </h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-3">
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        )}
        <p className="px-1 text-sm text-muted">
          <strong className="text-ink">{report.disclaimer}</strong> Engine {report.engineVersion} ·{' '}
          <a href={LINKS.explorerTx(report.launch.tx)} target="_blank" rel="noopener noreferrer nofollow" className="underline">
            launch transaction
          </a>
        </p>
      </aside>
    </div>
  );
}

function CheckRow({ check }: { check: ScoredCheck }) {
  const s = STATUS_STYLE[check.status];
  return (
    <li className="flex flex-col gap-1.5 border-t border-line-soft py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] ${s.chip}`}>{s.text}</span>
          <h3 className="font-semibold">{check.title}</h3>
        </div>
        <span className={`shrink-0 font-display text-lg font-bold ${check.deduction > 0 ? s.num : 'text-muted'}`}>
          {check.deduction > 0 ? `−${check.deduction}` : '0'}
        </span>
      </div>
      <p className="text-[15px] leading-relaxed text-ink-2">{check.explanation}</p>
      <details className="group text-sm">
        <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-ink-3 hover:text-ink">Raw numbers</summary>
        <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl bg-paper p-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          {Object.entries(check.value).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{humanKey(k)}</dt>
              <dd className="min-w-0 font-mono text-[13px] break-all text-ink">{formatRaw(v)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

function formatRaw(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v, null, 1);
  return String(v);
}

function CreatorCard({ report, wallet, history }: { report: ScanReport; wallet?: ScoredCheck; history?: ScoredCheck }) {
  const w = wallet?.value as { walletAgeDays?: number; fundingSource?: string; funder?: string | null; funderLabel?: string | null } | undefined;
  const h = history?.value as { priorLaunches?: number; diedFast?: number; graduated?: number; searchPartial?: boolean } | undefined;
  return (
    <section className="rounded-3xl bg-card p-6" aria-labelledby="creator-title">
      <h2 id="creator-title" className="font-display text-lg font-bold">
        Creator
      </h2>
      <Link
        href={`/creator/${report.creator.address.toLowerCase()}`}
        className="mt-1 block font-mono text-sm break-all underline decoration-line underline-offset-4 hover:decoration-ink"
      >
        {report.creator.address}
      </Link>
      {report.creator.deployerIsContract && (
        <p className="mt-1 text-sm text-muted">Launched through contract {shortAddr(report.creator.deployer)}.</p>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-muted">Wallet age</dt>
          <dd className="font-semibold">{w?.walletAgeDays !== undefined ? formatAge(w.walletAgeDays) : 'Unknown'}</dd>
        </div>
        <div>
          <dt className="text-muted">First funded by</dt>
          <dd className="font-semibold">{w?.fundingSource ? (FUNDING_LABEL[w.fundingSource] ?? w.fundingSource) : 'Unknown'}</dd>
        </div>
        <div>
          <dt className="text-muted">Earlier launches</dt>
          <dd className="font-semibold">
            {h?.priorLaunches ?? 'Unknown'}
            {h?.searchPartial ? '+' : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Died within 24h</dt>
          <dd className="font-semibold">{h?.diedFast ?? 'Unknown'}</dd>
        </div>
      </dl>
      {w?.funder && (
        <p className="mt-3 text-sm text-ink-3">
          Funder: {w.funderLabel ? `${w.funderLabel} · ` : ''}
          <a href={LINKS.explorerAddress(w.funder)} target="_blank" rel="noopener noreferrer nofollow" className="font-mono underline">
            {shortAddr(w.funder)}
          </a>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-5">
        <Link href={`/creator/${report.creator.address.toLowerCase()}`} className="link-neon inline-flex min-h-11 items-center font-semibold">
          All launches by this creator →
        </Link>
        <External href={LINKS.explorerAddress(report.creator.address)}>Explorer</External>
      </div>
    </section>
  );
}

function HoldersCard({ report }: { report: ScanReport }) {
  const max = Math.max(1, ...report.topHolders.map((h) => h.pct));
  return (
    <section className="rounded-3xl bg-card p-6" aria-labelledby="holders-title">
      <h2 id="holders-title" className="font-display text-lg font-bold">
        Top holders
      </h2>
      <p className="text-sm text-muted">Curve, pool, lockers and burn addresses excluded.</p>
      {report.topHolders.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">No wallet holds tokens outside the curve and pool yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[300px] text-sm">
            <caption className="sr-only">Top holders by share of total supply</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.06em] text-muted">
                <th scope="col" className="py-2 pr-2 font-semibold">
                  Wallet
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Supply
                </th>
              </tr>
            </thead>
            <tbody>
              {report.topHolders.map((h) => (
                <tr key={h.address} className="border-t border-line-soft">
                  <td className="py-2 pr-2">
                    <a href={LINKS.explorerAddress(h.address)} target="_blank" rel="noopener noreferrer nofollow" className="font-mono underline decoration-line underline-offset-4 hover:decoration-ink">
                      {shortAddr(h.address)}
                    </a>
                    {h.label && (
                      <span
                        className={`ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                          h.label === 'creator' || h.label === 'linked to creator' ? 'bg-high-bg text-high-fg' : 'bg-line-soft text-ink-2'
                        }`}
                      >
                        {h.label}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-line-soft sm:block" aria-hidden="true">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${(h.pct / max) * 100}%` }} />
                      </div>
                      <span className="font-display font-semibold tabular-nums">{h.pct < 0.01 ? '<0.01' : h.pct.toFixed(2)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

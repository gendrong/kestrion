import type { Metadata } from 'next';
import { KeyManager } from '@/components/wallet/KeyManager';
import { SignInPrompt } from '@/components/wallet/SignInPrompt';
import { getDb } from '@/lib/db';
import { LIMITS } from '@/lib/rateLimit';
import { currentUser } from '@/lib/session';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'API',
  description: 'Kestrion public API: risk reports, creator profiles and recent Robinhood Chain launches as JSON. Free, with optional API keys.',
  alternates: { canonical: '/api-docs' },
};

const TOKEN = '0xff579eca512116cfe339a4da2b9a819ae93a0b3d';

const ENDPOINTS: { method: string; path: string; text: string; returns: string }[] = [
  {
    method: 'GET',
    path: '/api/v1/token/:address',
    text: 'The latest risk report of a token: score, label, every check with its raw numbers, top holders, creator.',
    returns: '200 { data: report, meta: { scannedAt } } · 202 not scanned yet, now queued (retry later) · 404 not a Pons launch',
  },
  {
    method: 'GET',
    path: '/api/v1/creator/:address',
    text: 'A wallet’s Pons launches with scores and outcomes, stats and linked wallets.',
    returns: '200 { data: creator } · 202 unknown wallet, lookup queued · 404 no launches',
  },
  {
    method: 'GET',
    path: '/api/v1/launches?since=&risk=&stage=&pair=&sort=&limit=',
    text: 'Recent scanned launches (the live feed). risk: low | caution | high · stage: new | near | graduated · pair: ETH | USDG | Other · sort: newest | safest | riskiest · since: unix time or ISO date · limit: 1–100.',
    returns: '200 { data: launches[], meta: { count, query } }',
  },
  {
    method: 'POST',
    path: '/api/v1/scan/:address',
    text: 'Ask for a fresh full scan (API key required). It runs in the next job run while the day’s explorer budget allows; a token scanned in the last 10 minutes is not rescanned.',
    returns: '202 { meta: { status, retryAfterSeconds } } · 401 no / invalid key · 429 too soon or too many',
  },
];

const Code = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[13px] leading-relaxed text-paper">
    <code>{children}</code>
  </pre>
);

export default async function ApiDocsPage() {
  const user = await currentUser(getDb());
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-3">
        <span className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-3">Public API</span>
        <h1 className="font-display text-[clamp(38px,6vw,60px)] font-bold leading-[1] tracking-[-0.045em]">
          Reports as <span className="highlight">JSON.</span>
        </h1>
        <p className="text-lg text-ink-2">
          Every report on this site is available as JSON. No key needed to try it; an API key gives a higher limit and lets
          scripts request rescans. Data, not advice.
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="auth-title">
        <h2 id="auth-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
          Access and limits
        </h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
          <li>
            Without a key: {LIMITS.api} requests per minute per IP address.
          </li>
          <li>
            With a key: {LIMITS.apiKey} requests per minute per key. Send it as <code className="font-mono text-sm">Authorization: Bearer kest_…</code> (or{' '}
            <code className="font-mono text-sm">X-API-Key</code>).
          </li>
          <li>Over the limit you get HTTP 429 with a <code className="font-mono text-sm">Retry-After</code> header.</li>
          <li>
            Errors always look like <code className="font-mono text-sm">{'{ "error": { "code": "invalid_address", "message": "…" } }'}</code>.
          </li>
          <li>GET endpoints allow cross-origin requests (CORS), so they work from a browser page too.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="endpoints-title">
        <h2 id="endpoints-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
          Endpoints
        </h2>
        {ENDPOINTS.map((e) => (
          <div key={e.path} className="flex flex-col gap-2 rounded-3xl bg-card p-5">
            <p className="flex flex-wrap items-center gap-2 font-mono text-[15px]">
              <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${e.method === 'GET' ? 'bg-low-bg' : 'bg-caution-bg text-caution-fg'}`}>{e.method}</span>
              <span className="break-all">{e.path}</span>
            </p>
            <p className="text-[15px] text-ink-2">{e.text}</p>
            <p className="text-sm text-muted">{e.returns}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="examples-title">
        <h2 id="examples-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
          Examples
        </h2>
        <p className="text-ink-2">curl:</p>
        <Code>{`curl -H "Authorization: Bearer $KESTRION_API_KEY" \\
  ${SITE_URL}/api/v1/token/${TOKEN}`}</Code>
        <p className="text-ink-2">JavaScript (Node 18+ or a browser):</p>
        <Code>{`const res = await fetch('${SITE_URL}/api/v1/launches?risk=high&limit=5', {
  headers: { Authorization: \`Bearer \${process.env.KESTRION_API_KEY}\` },
});
const { data } = await res.json();
for (const t of data) console.log(t.symbol, t.score, t.label);`}</Code>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="keys-title">
        <h2 id="keys-title" className="font-display text-2xl font-bold tracking-[-0.02em]">
          Your API keys
        </h2>
        {user ? (
          <div className="rounded-3xl bg-card p-5 sm:p-6">
            <KeyManager />
          </div>
        ) : (
          <div className="-mx-4 sm:-mx-6">
            <SignInPrompt level={3} title="Sign in to create API keys" text="API keys belong to your wallet account. Keys are shown once and stored only as a hash." />
          </div>
        )}
      </section>
      <p className="px-1 text-sm font-semibold">Data, not advice. DYOR.</p>
    </div>
  );
}

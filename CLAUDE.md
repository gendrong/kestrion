# Kestrion — Full Product Spec (Final Version)

> This is the COMPLETE spec of the finished product, split into build phases (section 14).
> Only build the phase I request, but design every part to fit this final architecture.

## 1. Product
Kestrion is a web app that watches every token launched on Robinhood Chain launchpads
(starting with Pons — ponsfamily.com), runs rule-based risk checks within seconds, and
shows clear, explainable risk reports. The website is the entire product.

- Name: Kestrion · Future token: $KEST
- Tagline: "Hovers. Watches. Strikes before the rug."
- Theme: **"Paper Light"** — light theme by default. Font: Space Grotesk (headings) + Inter (body).
  - Background cream #F2F1EA, cards white #FFFFFF, borders #DEDBCF / #EFEDE4
  - Text black #0A0A0A, secondary #3D3B35, muted #6B685E (keep ≥4.5:1 contrast on cream)
  - Neon green #C6FF00 is a highlight/fill (marker behind key words, badges, button text on
    black) — never green text on the cream background (too low contrast)
  - Primary buttons: black background; CTA text in #C6FF00 or cream
  - Risk badges: Low = bg #C6FF00 / text #0A0A0A · Caution = bg #FFE3AE / text #6B4300 ·
    High = bg #FFDAD5 / text #A3190F · big high-risk score number #C42318
- Logo: **"Hover Badge"** — black rounded square, green chevron (hovering wings) over a
  green dot (the target). SVG, viewBox 0 0 64 64:
  `<rect width="64" height="64" rx="16" fill="#0A0A0A"/>`
  `<path d="M11 36 L32 17 L53 36 L45 40 L32 28.5 L19 40 Z" fill="#C6FF00"/>`
  `<circle cx="32" cy="47" r="4.5" fill="#C6FF00"/>`
  On dark backgrounds invert it: green square, black chevron and dot.
- Design reference: https://claude.ai/artifact/S4mstHBu2dS9Vvdwb8JmfV
  (artboard "Final — Home desktop")
- Tone: factual, never accusatory. Write "LP not locked", "creator holds 42%" —
  never "scam" or "rug". Every report shows "Data, not advice. DYOR."
- Footer: "Kestrion is independent and not affiliated with Robinhood Markets or Pons Labs."
- Users: memecoin traders on Robinhood Chain, mostly on mobile. Mobile-first UI.

## 2. Chain facts
Verified details (addresses, events, ABIs, limits) live in `docs/chain-research.md` (Phase 1a).

- Robinhood Chain: Arbitrum Orbit L2, EVM, chainId 4663, ETH gas, ~0.1 s blocks
- Explorer: https://robin.etherscan.io (Blockscout: https://robinhoodchain.blockscout.com)
- On Arbitrum chains `block.number` inside contracts is the **L1** block number
  (e.g. V1 `restrictionsEndBlock`) — never compare it to L2 block numbers
- Pons runs THREE factories; support each independently (own `job_state` row):
  - **Pons V2** (main — where new launches happen): per-token bonding curve, then
    graduates to a **Uniswap v4** pool (shared hook, liquidity locked forever).
    Has the 99% launch "snipe tax" (decays to 0 in a few seconds) and up to 32
    creator-chosen exempt wallets
  - **Pons V1 active** and **Pons V1 legacy**: Uniswap v3-style pools, no new launches
    seen recently, but older tokens still trade; V1 has 2-block launch protection
    instead of a snipe-tax whitelist
- `TokenLaunched` has a DIFFERENT signature in V1 and V2. Always filter logs by factory
  address — other contracts emit look-alike events
- Pons tokens are fixed-supply (1 billion). Pair types: **ETH / USDG / Other token**
  (no official Stock Token list available; V2 also allows other approved tokens)
- A V2 `deployer` can be a third-party launcher contract — the real creator is then
  `tx.from` / `creatorFeeRecipient`
- Other launchpads on the chain (later): Pools.trade (Uniswap), RobinFun, RealFun, Bow.fun

## 3. Sources of truth — read before writing chain code
- `docs/chain-research.md` — verified results of Phase 1a (start here)
- https://docs.ponsfamily.com (V1) and https://docs.ponsfamily.com/v2 (V2)
- https://docs.mobula.io/almanac/robinhood-launchpads/pons
- https://github.com/pons-labs (no public repos as of 2026-10-08)
- https://ponsfamily.com/builders
- Verified contracts on https://robin.etherscan.io
- Blockscout PRO API docs: https://docs.blockscout.com/robinhood-api.md

NEVER invent contract addresses, ABIs, RPC URLs, or event signatures. Record every
address/ABI in one `chain/config` file with a comment citing where it came from.
If something can't be verified, stop and ask me.

## 4. Stack
- Next.js (App Router) + TypeScript (strict) + Tailwind CSS. The web app stays on **Next 15.5 + TypeScript 6**
  (OpenNext Cloudflare 1.20 fails at runtime with Next 16.4; Next 15 needs the TS 6 JS API). Other packages use TS 7.
- viem (chain reads), wagmi + RainbowKit (wallet connect), SIWE (sign-in with Ethereum)
- **Database: Cloudflare D1** (SQLite, free), database `kestrion`, id `ea6b1b65-5ff7-4a2c-91a0-5547fbc4801e`
  (decided 2026-10-12, replaces Supabase). Website: D1 binding `DB`. Jobs: D1 REST API.
- **Rate limiting: Cloudflare Workers Rate Limiting binding** (works on the free plan; replaces Upstash)
- GitHub Actions cron (free; the repo is **public** so minutes are unlimited) for scheduled jobs
- **Hosting: Cloudflare Workers (free plan)** via `@opennextjs/cloudflare` + wrangler, at
  `https://kestrion.autora.workers.dev` (decided 2026-10-08, replaces Vercel). The deploy token is the
  `CLOUDFLARE_API_TOKEN` user env var on the dev machine. Free Workers allow ~10 ms CPU per request,
  so **the website never runs scans**: it only reads results from the database (see §5).
  Share images (Phase 4) must use a Workers-compatible approach.
- Blockscout PRO API free tier (key in `BLOCKSCOUT_API_KEY`) for wallet history, funding
  sources, token holders, and as the fallback RPC
- Optional LLM summaries: Gemini free tier; the site must work fully without it
- vitest (unit), Playwright (a few end-to-end smoke tests)
- READ-ONLY: the app never holds private keys and never sends transactions.
- Budget is ~$10 total. Tell me BEFORE adding anything paid.

## 5. Architecture
- `packages/engine` — pure TypeScript scanning engine, no framework code. Testable
  via CLI: `npm run scan <address>`.
- `packages/engine/adapters/` — one adapter per launchpad implementing a common
  `LaunchpadAdapter` interface (discover launches, read launch config, read curve
  state, detect graduation). Pons first; others added later without touching the core.
- `apps/web` — Next.js app (pages + API routes) deployed to Cloudflare Workers. It **reads scans
  from the database only**; a token without a scan is put in the `scan_requests` queue.
- `packages/db` — D1/SQLite migrations + typed database access shared by web and jobs (one `SqlClient`
  interface: D1 binding, D1 REST API, node:sqlite in tests).
- `jobs/` — scripts run by GitHub Actions cron (all scanning happens here, in Node):
  - `ingest` (every 5 min): fetch new launch events since the last processed block,
    scan them, store results; then process the `scan_requests` queue
  - `rescan` (hourly): rescan tokens from the last 72h and every watchlisted token;
    record score changes and create in-app notifications
- Jobs are idempotent: store the last processed block per factory; safe to re-run.
- RPC: public RPC with retry/backoff; on failure switch automatically to the fallback RPC
  (Blockscout JSON-RPC, from env var). The public RPC keeps only ~10 min of state and
  allows max 20,000 blocks per `eth_getLogs`; some ISPs block it.

## 6. Data model (Cloudflare D1 / SQLite — `packages/db/migrations`)
- `tokens` — address, launchpad, factory, name, symbol, creator, paired_token,
  pair_type, pool, launch_block, launch_time, metadata (image, socials)
- `scans` — token, scanned_at, score, label, checks (JSONB with raw numbers per check),
  engine_version, summary (nullable)
- `score_changes` — token, old_score, new_score, reason, changed_at
- `creators` — address, first_seen, wallet_age, funding_source, total_launches,
  stats (JSONB)
- `users` — wallet address (from SIWE), created_at, kest_balance_cached, tier
- `watchlist` — user, token
- `followed_creators` — user, creator
- `notifications` — user, type, token/creator, message, created_at, read_at
- `api_keys` — user, hashed key, tier, created_at, last_used
- `flags` — token, user, type (false_positive / missed_risk), note, status
- `job_state` — job name, last_block, last_run, status
- `scan_requests` — token, requested_at, status, attempts (queue for tokens the website was asked about)

## 7. Risk engine (rule-based — an LLM must NEVER decide the score)
Checks, each returning `{ status: pass | warn | fail | unknown, value, explanation }`:
1. Whitelist / snipe-tax exemptions (V2 only; V1 shows its launch-protection info instead):
   number of exempt wallets; whether they were funded by the creator (trace up to 2 hops)
2. Creator cluster buy: % of supply bought in the first N blocks by the creator and
   wallets linked to the creator (shared funding source)
3. Holder concentration: top-10 holders %, excluding pool, locker and burn addresses
4. Creator history: number of prior launches, how many died fast (define "died" in
   config, e.g. liquidity/market cap dropped >90% within 24h), repeated names/tickers
5. Creator wallet: age, funding source type (fresh / exchange / other launch proceeds)
6. Curve state: bonding progress, graduated or not, time since launch
7. Pair type: ETH / USDG / Other token (informational)
8. Sell pressure: creator or linked wallets sold >X% since launch

- Score 0–100 from weighted deductions. 🟢 70–100 Low risk · 🟡 40–69 Caution ·
  🔴 0–39 High risk. A check that can't be computed = `unknown`, never a silent pass.
- All weights and thresholds live in ONE config file with comments.
- Every deduction is shown in the UI with its reason and raw numbers.
- `engine_version` is stored with every scan so score changes after tuning are traceable.
- Unit tests for every check and the scoring function, using fixtures.

LLM summary (optional): 2–3 plain sentences built only from the check JSON. The prompt
must forbid adding facts. Never alters the score. Cached per scan.

## 8. Pages
1. `/` — Home: big search box (token or creator address), live feed of recent launches
   (auto-refresh), each row: image, name, ticker, age, pair, market cap if available,
   curve progress, risk badge. Filters: New / Near graduation / Graduated, pair type,
   risk level. Sort: newest, safest, riskiest.
2. `/t/[address]` — Token report: score dial + label, plain-language summary,
   checklist of all checks (pass/warn/fail/unknown with raw numbers), top holders table
   with labels (creator, linked, pool, locker), creator card, score history chart,
   links to Pons and explorer, "last scanned" + Rescan button (rate-limited),
   "Add to watchlist", "Flag this report", share button with OG image.
3. `/creator/[address]` — all launches by this wallet with scores and outcomes,
   aggregated stats (launches, % died fast, average score), linked wallets,
   "Follow creator" button.
4. `/today` — riskiest and cleanest launches of the last 24h, biggest score changes.
5. `/watchlist` — signed-in users' tokens and followed creators, current scores,
   "score changed" badges.
6. `/notifications` — in-app notification list (bell icon with unread count in the
   header): watchlisted token score changed, followed creator launched a new token.
7. `/api-docs` — public API docs + API key management for signed-in users.
8. `/about` — how scoring works, every check explained simply, limitations, disclaimer.
9. `/admin` — only for wallets in `ADMIN_WALLETS` env: review flags, view job health,
   trigger rescans, see score distribution.

## 9. Public API
- `GET /api/v1/token/:address` — latest scan (JSON)
- `GET /api/v1/creator/:address` — creator stats + launches
- `GET /api/v1/launches?since=&risk=&limit=` — recent launches
- `POST /api/v1/scan/:address` — request a rescan (auth + rate-limited)
- No key: low rate limit. API key: higher limit. Keys shown once, stored hashed.
- Consistent error format; CORS enabled for GET.

## 10. Accounts & $KEST holder perks
- Sign in with wallet (SIWE). No email/password.
- Tiers by $KEST balance (thresholds in config; token address added later — feature
  stays disabled until it's set):
  - Free: search, reports, feed, 5 watchlist items, follow 3 creators
  - Holder: unlimited watchlist and follows, higher API limit, early access to new features
- Balance read on-chain at sign-in and refreshed periodically. Read-only.

## 11. Quality, security, performance
- Mobile-first, fast first load, skeleton loaders, works on slow connections
- Report pages server-rendered and cacheable; SEO meta + OG image per token
- Rate limiting on all scan/rescan/API routes
- Validate every address input; never trust token metadata (escape names, proxy or
  allowlist image hosts)
- Secrets only in env vars; provide `.env.example` with comments
- Structured logs; `/admin` shows last job runs and errors
- Accessibility: proper contrast, keyboard navigation, labels on icons

## 12. Out of scope
- Telegram bots, X/Twitter posting, email notifications
- Trading, swapping, or any transaction
- Any "buy/sell" recommendation language

## 13. How to work with me
- I'm not a senior developer: explain decisions simply, keep a clear README with
  setup and deploy steps.
- Build only the phase I ask for, test it, then tell me exactly how to run it and
  what to check.
- If a requirement conflicts with reality (e.g. data not available on-chain), tell me
  and propose an alternative instead of faking it.
- At the end of each phase, update `PROGRESS.md`: what's done, what's left, known issues.

## 14. Build phases
Each phase has its own detailed prompt in `phases/`. Build only the phase I paste or name.

| Phase | Prompt file | Done when |
|---|---|---|
| 1a — Chain research (STOP for my OK) | `phases/phase-1a-chain-research.md` | Addresses, events, ABIs, RPC shown with sources and approved |
| 1b — Monorepo + scanning engine | `phases/phase-1b-scanning-engine.md` | Scanning 5 real Pons tokens gives sensible, explainable reports |
| 2 — Token report page | `phases/phase-2-token-report-page.md` | I can paste an address on my phone and get a full report |
| 3 — Database, live feed & deploy | `phases/phase-3-database-feed-deploy.md` | The live site shows new Pons launches within ~5 minutes |
| 4 — Creator profiles, Today & About | `phases/phase-4-creator-today-about.md` | Clicking any creator shows their full launch history |
| 5 — Accounts, watchlist & notifications | `phases/phase-5-accounts-watchlist-notifications.md` | A watchlisted token's score change shows up in my notifications |
| 6 — Public API & admin | `phases/phase-6-public-api-admin.md` | An external script can fetch reports with an API key |
| 7 — $KEST holder perks (after token launch) | `phases/phase-7-kest-holder-perks.md` | A wallet holding $KEST automatically gets Holder tier |
| 8 — More launchpads | `phases/phase-8-more-launchpads.md` | Launches from a second launchpad appear in the feed with scores |

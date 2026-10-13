# Progress

## Phase 1a — Chain research ✅ (approved 2026-10-08)

**Done**
- Verified all Pons addresses, events, ABIs and RPC on-chain → `docs/chain-research.md`
- Found that Pons now runs **V2** (bonding curve → Uniswap v4) in addition to V1 (Uniswap v3);
  `CLAUDE.md` §2 updated
- Blockscout PRO API key (free) created and tested; stored in `.env` (git-ignored)
- Blockscout JSON-RPC verified as fallback RPC

**Decisions**
- Support Pons V2 (main) + V1 active + V1 legacy, each independently
- Pair types: ETH / USDG / Other token (no official Stock Token list)
- No DNS change on the dev laptop: the engine falls back to the Blockscout RPC automatically

## Phase 1b — Monorepo + scanning engine ✅ (2026-10-08, engine 0.1.1)

**Done**
- npm-workspaces monorepo: `packages/engine` (TypeScript strict, vitest), placeholders `apps/web`, `jobs/`
- `packages/engine/src/chain/config.ts`: every address/topic with its source; a test checks topics vs verified hashes
- RPC client with automatic failover (public RPC → Blockscout JSON-RPC), chunked `eth_getLogs` (halves on errors)
- Blockscout client (rate-limited 4.5 req/s, retries, cache): wallet history, holders, token flows, wide-range logs
- `LaunchpadAdapter` interface + `PonsAdapter` (V2, V1 active, V1 legacy): find launch, discover launches,
  curve state/graduation, early trades, snipe-tax exemptions, holder exclusions, creator launch history
- All 8 checks + scoring in one config file (`src/scoring/config.ts`), rule-based summary, JSON report, CLI
- `npm run scan <address>` (add `-- --json` for JSON); 77 unit tests with fixtures (`npm test`)
- New verified chain facts added to `docs/chain-research.md` §6b (e.g. `SnipeTaxExempted` event, real
  `PoolGraduated` signature, snipe-tax decay, snipe tax is inside the CurveBuy `fee`)

**Real-token test set** (all scanned successfully; see the Phase 1b hand-off message for scores)
- V2 new launch, V2 with 17 creator-funded exempt wallets (GRAIL), V2 near graduation (64%), V2 graduated (TIDE),
  V1 legacy (PONS), V1 active (BUNEE, serial creator), V2 launched through a third-party contract with an ORBIO pair (KIMMY)

**Left (next phases)**
- Phase 2: Next.js app, `/t/[address]` page, `GET /api/v1/token/:address`
- Market cap is not computed yet (V2 curve `getReserves()` output format is not verified)

**Known issues / limitations**
- A scan takes ~40–70 s (free Blockscout tier = 5 req/s; up to 20 early buyers are traced 2 hops). Phase 3 caches results.
- "Died fast" is only computed for V2 launches (V1 shows outcome unknown).
- Exchange/bridge detection relies on Blockscout public labels; unlabeled exchange wallets count as "another wallet".
- Lockers are recognised by name (contract labels containing "lock", e.g. RobinhoodLocker).
- Holder concentration uses the first page (~50) of Blockscout holders.
- Creator history can't attribute launches made through third-party launcher contracts (report says "may be incomplete").
- Thresholds/weights are first estimates: tune them with real feedback (the `flags` feature in Phase 6).
- Tokens with almost no activity can score high simply because there is little to flag.
- The local ISP blocks the public RPC; every scan here used the Blockscout fallback.

## Phase 2 — Token report page ✅ (2026-10-08)

**Decision:** scoring calibration stays as is for now (option 2); tune later with real feedback (Phase 6 flags).

**Done**
- `apps/web`: Next.js 16 + TypeScript strict + Tailwind 4, "Paper Light" theme, Hover Badge logo + favicon,
  header, footer with disclaimer and non-affiliation line, security headers
- Home `/`: tagline, search, how scoring works (score bands + 8 checks)
- Search box: validates the address client-side, routes to `/t/<address>`; works without JavaScript too (`/scan` fallback)
- `/t/[address]`: streams live scan progress (skeleton + real steps), then shows score, label, summary, all 8 checks
  with deductions and expandable raw numbers, top holders with labels, creator card, links to Pons and RobinScan,
  last scanned time, data notes; clear states for invalid address / not a Pons token / scan failed (with retry)
- `GET /api/v1/token/:address`: `{ data, meta }` or `{ error: { code, message } }`, CORS for GET + OPTIONS
- Memory cache (10 min) + merging of concurrent scans of the same token
- Engine: `normalizeAddress`, `LINKS` (Pons token URL verified from ponsfamily.com), creator history now starts at the
  beginning of a scan; light `@kestrion/engine/config` and `/types` entry points for browser code
- Playwright smoke tests (mobile Pixel 7 + desktop): 12 pass; optional live scan test (`E2E_LIVE=1`) passed
- README: how to run, and how to open the site on a phone on the same Wi-Fi (`npm run phone`)

**Known issues / limitations**
- A first scan takes ~45–120 s (free Blockscout tier); the page shows live progress meanwhile. Phase 3 (database +
  ingest job) makes reports instant, and creator history can come from our own launch index.
- No rate limiting yet (Phase 3, Upstash). Don't share the local site publicly before that.
- No watchlist / flag / share / rescan buttons or score history yet (later phases, per spec).
- Token images are not shown yet (initials avatar); image proxy/allowlist comes with token metadata in Phase 3.
- Market cap not shown (V2 price function not verified yet).

## Phase 3 — Database, live feed & deploy ✅ (2026-10-12)

**Decisions**
- 2026-10-08: GitHub repo **public** (unlimited Actions minutes; a private repo would cost ~$50–70/month).
- 2026-10-08: Hosting on **Cloudflare Workers** (free) at `kestrion.autora.workers.dev` instead of Vercel. Free Workers
  allow ~10 ms CPU per request, so **all scanning runs in GitHub Actions**; the website only reads the database.
- 2026-10-12: **Cloudflare D1** instead of Supabase and the **Workers Rate Limiting binding** instead of Upstash, so no
  new accounts are needed besides GitHub. `CLAUDE.md` §4–§6 updated.
- 2026-10-12: web app on **Next 15.5 + TypeScript 6** (OpenNext 1.20 crashed at runtime with Next 16.4:
  "Unexpected loadManifest(preview-props.json)"); fonts self-hosted (Google Fonts download failed during builds).

**Done**
- `packages/db`: D1/SQLite migration `0001_init.sql` (all §6 tables + `scan_requests`), one `SqlClient` interface
  (D1 binding / D1 REST API / node:sqlite), typed repo with atomic `recordScan` batch; 15 tests on real SQLite
- `jobs/src/ingest.ts` + `.github/workflows/ingest.yml` (every 5 min, no overlap, time budget, per-factory
  `job_state` cursor, failed scans re-queued, then the scan queue); `ci.yml` (typecheck + tests)
- Engine: V1 history capped at the factories' closing blocks, cleaned token metadata (IPFS-only logos), shared limiter
- Website: DB-backed `/t/[address]` with queue state, live feed with logos, `/api/v1/launches`, `/api/v1/token/:address`
  (200/202/400/404), `/img/:cid` proxy (several IPFS gateways + edge cache), rate limits, CSP + security headers
- **Live:** D1 `kestrion` created + migrated; ingest run from the laptop stored real launches; site deployed and
  checked: home + feed + logos + reports + queue + API + rate-limit headers work (phone screenshot checked)
- Tests: 81 engine + 15 db unit tests, 18 Playwright smoke tests pass; typecheck clean

- **GitHub:** public repo https://github.com/gendrong/kestrion (commits as `gendrong` with the GitHub noreply email),
  4 Actions secrets set by the user, CI green. First ingest run (manual, 2026-10-12 14:32 UTC): 18 of 18 new launches
  scanned and stored, ~6 min from launch to report; cursor jumped ahead from the laptop run as designed.
- Tuning after the first run: concurrency 3 → 5 (launch rate was ~18 per 5 min), and the scan queue now gets the first
  90 s of every run (it was starved by launches).
- 5-minute trigger: GitHub's `schedule:` never fired on the new repo. A Cloudflare cron Worker (`apps/cron`,
  `kestrion-cron`) was deployed, but Cloudflare never ran it in ~50 min (schedule registered, also tried every minute).
  **Fix (2026-10-12):** each ingest run starts the next one when it ends (≥ 5 min after it began, via `gh workflow run`
  with the built-in token). The schedule and `kestrion-cron` stay as backups; the concurrency group prevents a second chain.

- **Done-when check (2026-10-12):** ingest #2 started by hand at 16:35 UTC; #3 started by itself
  (github-actions[bot]) at 16:40, ~5.5 min later. New V2 launches appeared on the site **~5.3–6 min** after launch
  (e.g. QUBO launched 16:33:00, report stored 16:38:19). #2 skipped the ~2 h gap since #1 (69k blocks) as designed.

**Known issues / limitations**
- Public IPFS gateways (ipfs.io, dweb.link, pinata) often answer 429 to Cloudflare's IPs; filebase + 4everland work
  today. If all fail, the feed falls back to initials.
- `next dev` uses a local empty D1 copy (remote dev bindings made `wrangler deploy` fail on this network).
- This laptop's network is flaky for some hosts (RPC, Google Fonts, Cloudflare API): deploys may need a retry.
- Blockscout free tier: 100k credits/day. At ~1,300 launches/day × ~30–100 calls each this can get tight; tune
  `INGEST_CONCURRENCY` / `maxLinkedCandidates` if it runs out. Phase 4's own launch index will cut history calls.
- If the ingest chain stops (GitHub outage, a run hitting the 15-min timeout), the backups should restart it; if not,
  click *Run workflow* once. A token can take ~5–15 min to appear.
- Reports are from scan time; rescans (score changes) come in Phase 5.
- Market cap still not shown (V2 price function not verified).

## Phase 4 — Creator profiles, Today & About 🟡 (2026-10-13: built and deployed; blocked by explorer credits)

**Decisions**
- Share images are rendered in the GitHub job (satori + resvg, fonts from @fontsource) and stored in D1 as base64
  PNG (~40 KB): free Workers have ~10 ms CPU, too little to draw images. Kept 14 days, then the default card is used.
- Packages pinned to versions at least 2 weeks old (satori 0.33.5: newer versions were published in a burst that week).
- Creator profiles live in `creators` (one row per wallet, merged from every scan); wallets nobody scanned yet are
  looked up on demand (`creator_requests`, migration `0002_creators_og.sql`).

**Done**
- Engine: every scan returns a creator snapshot (all launches found on-chain, wallet age, funding, linked wallets).
- DB: `creators` filled by the job (merge keeps details across scans, linked wallets accumulate), creator lookup
  queue, `/today` queries, share image storage + pruning. 23 db tests, 85 engine tests.
- Job: creator profile + share image after each scan; wallet lookups (search launches, queue the newest 3 for
  scanning); wallets pasted into the token search are detected and turned into lookups.
- Website: `/creator/[address]` (launch list with scores and outcomes, stats, linked wallets, Follow placeholder),
  `/today`, `/about` (numbers from the scoring config), `/og/[address]`, share button (share sheet / copy / X),
  SEO + Open Graph + Twitter cards, creator links in the feed and report, header nav. 30 Playwright tests pass.
- Live: D1 migrated, site deployed; checked creator page, redirects, metadata and a real stored share image.

**Blocker (found 2026-10-13)**
- The free Blockscout tier (100k credits/day, ~20 credits per call ≈ 5,000 calls/day, resets 00:00 UTC) ran out at
  ~03:30 UTC. A full scan uses ~30 calls, so the free tier covers ~160 scans/day, but Pons has ~1,300 launches/day.
  Since then every scan fails (`Out of credits`) and the feed stops at 03:30 until the daily reset.
  Paid plans start at $49/month (over budget).
- **Decision (2026-10-13): quick + full scans** (engine 0.2.0, migration `0003_launch_index_depth.sql`):
  - Credit budget shared by a run, read from `x-credits-remaining` (kept in job_state `explorer:credits`); no
    explorer calls once used up (checks become unknown instead of the scan failing).
  - **Quick scan** for every launch: launch tx from the factory event, curve/trades/exemptions/holders/flows from the
    free RPC, the creator wallet only (stored profiles reused: repeat creators cost nothing), no early-buyer funding
    traces (cluster buy shows unknown unless the creator's own buys already warn), no prior-launch outcomes.
  - **Full scan** (the old scan) for tokens someone opens on the website and launches gaining traction (≥ 10 buys
    from ≥ 6 wallets in one run), only from credits that quick scans won't need before the 00:00 UTC reset.
  - `launch_index`: every Pons launch from the factories' events over the free RPC, backfilled ~2 min per run;
    creator history, wallet lookups and creator pages read it instead of explorer searches.
  - Reports show "Quick scan" / "Full scan".

**Known issues / limitations**
- Creators scanned before Phase 4 have no stored launch history yet; their page shows the scanned tokens and
  queues an on-chain lookup (needs explorer credits).
- The Worker's quick wallet-vs-token check (public RPC eth_getCode) may fail from Cloudflare; the job then detects
  wallets instead and the page redirects after the next run.
- Share images use Latin fonts: other scripts and emoji are left out of the image (the page shows the real name).

## Phase 5 — Accounts, watchlist & notifications 🟡 (2026-10-13: built and deployed; waiting for the live test)

**Decisions**
- "Rescan every token of the last 72h every hour" doesn't fit (~3,900 tokens/h vs ~120 scans/h the public RPC allows).
  Rescans run **inside the ingest chain once an hour** (no second workflow competing for the RPC): every watched
  token first, then as many recent tokens as fit (least recently scanned first). A full report is only rescanned with
  a full scan (when the day's credits allow), so missing data never fakes a score change.
- Wallet libraries load only when someone taps "Sign in" (first load stays ~106–120 kB JS).
- Signature check is local (no RPC): EOA wallets only for now (smart-contract wallets / EIP-1271 not supported).
- WalletConnect project ID (free, cloud.reown.com) not set yet: until then only wallets that inject into the page
  (extensions, wallet apps' built-in browsers, Coinbase Wallet) can sign in. Set it in `apps/web/src/lib/site.ts`.

**Done**
- Migration `0004_accounts.sql` (siwe_nonces, sessions + indexes); `packages/db/src/tiers.ts` (Free: 5 watchlist, 3 follows)
- SIWE sign-in (`/api/auth/nonce|verify|logout`, `/api/me`), sessions stored as SHA-256 of an HttpOnly cookie, nonces
  single-use (10 min), same-origin check on every state-changing request
- Watchlist (`/api/watchlist`, "Add to watchlist" on reports), follows (`/api/follow`, "Follow creator")
- Notifications: written in the same batch as a score change for every watcher; followed creator's new launch after
  its first scan. Header bell with unread count, `/notifications` with "Mark all as read", `/watchlist` with
  "score changed" badges
- Jobs: shared `jobs/src/runtime.ts`, hourly `jobs/src/rescan.ts`, change reasons ("Holders: pass → warn"),
  `rescan-test` workflow / `npm run rescan:test -w @kestrion/jobs -- <token> [--normal]`
- Report: score history chart (step line, table view), Rescan button (`POST /api/v1/scan/:address`, 10-min cooldown)
- `/today` "biggest score changes" fills from score_changes automatically
- Tests: 93 engine, 30 db, 38 Playwright. Live check with a throwaway wallet: sign-in 200 (~0.2 s), replay refused,
  watch + follow + pages OK.

**Known issues**
- npm audit: 2 "high" (postcss at build time, `ws` in WalletConnect's Node path), not reachable from the live site.
- Hourly rescans compete with new launches for the throttled public RPC.

## Phase 6 — Public API & admin ✅ (2026-10-13; admin wallet still to be set)

**Done**
- API keys: `kest_` + 32 random bytes, shown once, stored as SHA-256 + a 9-character prefix; max 5 per account;
  `last_used` updated at most every 5 min. Key management on `/api-docs` (create / list / revoke).
- Limits (`apps/web/src/lib/rateLimit.ts` + `wrangler.jsonc`): no key 60/min per IP, API key 600/min per key
  (new binding `API_KEY_LIMITER`). Keys via `Authorization: Bearer` or `X-API-Key`; bad key = 401 `invalid_api_key`.
- `POST /api/v1/scan/:address` now needs an API key or a signed-in session (website Rescan button).
- "Flag this report" (signed-in, rate-limited, one open flag per user/token/type), `/admin` (only `ADMIN_WALLETS`):
  counts, job health with errors, score distribution chart, trigger rescans, review flags.
- Optional AI summaries (`jobs/src/aiSummary.ts`): Gemini `generateContent`, only from the check JSON, banned-words
  and must-mention-the-score guards, full scans only, ≤10 per run, stored in `scans.ai_summary`; off without
  `GEMINI_API_KEY` (GitHub secret).
- `/api-docs` with curl + JS examples; `examples/fetch-report.mjs`.
- Migration `0005_api_keys_flags.sql`. Tests: 93 engine, 34 db, 46 Playwright.
- **Done-when check (live):** `KESTRION_API_KEY=… node examples/fetch-report.mjs` → `access: api-key (limit 600/min)`,
  launches + full report printed. Also checked: flag 200, rescan without auth 401 / with key 202, /admin 404 for
  non-admins. Test wallet and its data deleted afterwards.

**Left / known issues**
- `ADMIN_WALLETS` in `apps/web/wrangler.jsonc` is empty until the owner's wallet address is added (then redeploy).
- AI summaries stay off until a Gemini key is added; which models the free tier includes wasn't stated in the docs.

## Next
- Phase 5 live test by the owner (sign in → watch → Actions "rescan-test"); WalletConnect project ID.
- Confirm Phase 4 once the launch index is complete.
- Phase 7 ($KEST holder perks) waits for the token launch; Phase 8 = more launchpads.

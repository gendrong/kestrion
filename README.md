# Kestrion

Explainable risk reports for tokens launched on Robinhood Chain launchpads (starting with Pons).
Read-only: Kestrion never holds keys and never sends transactions. **Data, not advice. DYOR.**

The full product spec is in [CLAUDE.md](CLAUDE.md); progress is in [PROGRESS.md](PROGRESS.md);
verified chain facts are in [docs/chain-research.md](docs/chain-research.md).

## What works today (Phase 5)

- **Ingest job** (`jobs/`, GitHub Actions every 5 min): scans every new Pons launch and stores it in Cloudflare D1,
  updates the creator's profile, and renders a share image (PNG) for each recent launch.
- **Website** (`apps/web`, Cloudflare Workers):
  - `/` search + live feed (filters, sorting, auto-refresh; each row links to the token and its creator)
  - `/t/<address>` token report with share button and share image (unscanned tokens are queued; a wallet address
    redirects to its creator page)
  - `/creator/<address>` all Pons launches by a wallet with scores and outcomes, stats, linked wallets
    (an unknown wallet is looked up by the next job run)
  - `/today` lowest / highest scores of the last 24h and the biggest score changes
  - `/about` how scoring works, every check with its thresholds and weights, limits, disclaimer
- **Accounts** (Phase 5): sign in with a wallet (SIWE, read-only), watchlist (Free: 5), follow creators (Free: 3),
  notifications (bell icon) when a watched token's score changes or a followed creator launches; `/watchlist`,
  `/notifications`. Hourly rescans run inside the ingest job.
- **Public API**: `GET /api/v1/token/<address>`, `GET /api/v1/creator/<address>`, `GET /api/v1/launches`,
  `POST /api/v1/scan/<address>` (request a rescan),
  rate-limited per IP (Cloudflare binding).
- **Share images**: `/og/<address>` (rendered by the job, stored in D1, kept 14 days; older tokens use
  `apps/web/public/og-default.png`, regenerate it with `npm run og:default -w @kestrion/jobs`).
- Live at **https://kestrion.autora.workers.dev**
- **Command-line scanner**: `npm run scan <address>` prints a report in the terminal.

**First-time setup and deploy: [docs/SETUP.md](docs/SETUP.md).**

Every report has a score from 0 to 100, a label, and 8 checks, each with its reason and raw numbers.

## Setup (one time)

1. Install **Node.js 20.12 or newer** (https://nodejs.org). Check with `node --version`.
2. In this folder, install dependencies:
   ```
   npm install
   ```
3. Create your `.env` file:
   - Copy `.env.example` to `.env`.
   - Get a free API key at https://dev.blockscout.com and put it after `BLOCKSCOUT_API_KEY=`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Website in development mode: open http://localhost:3000 |
| `npm run build` then `npm run start` | Website in production mode on http://localhost:3000 |
| `npm run phone` | Builds and starts the website so phones on the same Wi-Fi can open it (see below) |
| `npm run db:migrate` | Applies new SQL files to the D1 database (uses `CLOUDFLARE_API_TOKEN`). |
| `npm run ingest` | Runs the ingest job once on your laptop (scans new launches into the database). |
| `npm run deploy` | Builds and deploys the website to Cloudflare Workers. |
| `npm run scan <token address>` | Prints the risk report in the terminal. |
| `npm run scan <token address> -- --json` | Same report as JSON. |
| `npm test` | Engine unit tests (no internet needed). |
| `npm run test:e2e` | Website smoke tests (Playwright; first run: `npx playwright install chromium` in `apps/web`). |
| `npm run typecheck` | Checks the TypeScript code for mistakes. |

A scan takes about 30–90 seconds (the free explorer API allows 5 requests per second, and a scan traces the
funding of up to 20 early buyers). That's why scans run in the background job, and the website only shows stored results.

## Open the website on your phone

1. Phone and laptop on the **same Wi-Fi**.
2. On the laptop: `npm run phone` (wait for "Ready").
3. Find the laptop's address: run `ipconfig` and look for **IPv4 Address** under your Wi-Fi adapter (e.g. `192.168.1.81`).
4. On the phone, open `http://<that address>:3000` (e.g. `http://192.168.1.81:3000`).
5. If Windows asks whether Node.js may use the network, allow it on **private networks**.

## How the score works

Every token starts at 100. Each check returns **pass**, **warn**, **fail** or **unknown**, and every
non-pass deducts points. A check that can't be computed is **unknown**: it deducts a few points and is
never counted as a pass. 70–100 = Low risk · 40–69 = Caution · 0–39 = High risk.

All weights and thresholds are in one file: [packages/engine/src/scoring/config.ts](packages/engine/src/scoring/config.ts).
If you change a number there, also bump `ENGINE_VERSION` in [packages/engine/src/version.ts](packages/engine/src/version.ts).

| # | Check | What it looks at |
|---|---|---|
| 1 | Snipe-tax exemptions | Wallets the creator exempted from the 99% launch tax (Pons V2), and whether the creator funded them (≤ 2 hops). |
| 2 | Creator cluster buy | % of supply bought in the first 300 blocks (~30 s) by the creator and linked wallets. |
| 3 | Holder concentration | % of supply held by the top 10 holders, excluding curve, pool, lockers and burn addresses. |
| 4 | Creator history | Earlier launches by the same wallet, how many lost ≥ 90% of their liquidity within 24 h, reused tickers. |
| 5 | Creator wallet | Wallet age and where its first ETH came from (exchange, bridge, another wallet, launch proceeds). |
| 6 | Curve state | Bonding progress, graduation, time since launch (informational). |
| 7 | Pair type | ETH / USDG / other token (informational). |
| 8 | Sell pressure | % of their tokens the creator and linked wallets have sold or moved out. |

## Project layout

```
packages/engine/        scanning engine (pure TypeScript, no framework)
  src/chain/            addresses (with sources), ABIs, RPC failover, log fetching
  src/explorer/         Blockscout API client
  src/adapters/pons/    Pons V2 + V1 (active, legacy) adapters
  src/scan/             data collection, wallet funding traces
  src/checks/           the 8 checks (pure functions)
  src/scoring/          config (weights/thresholds) and score
  src/report/           JSON report + terminal rendering
  src/cli/scan.ts       `npm run scan`
  test/                 unit tests with fixtures
packages/db/            D1 (SQLite) migrations + database access
apps/web/               Next.js website + API on Cloudflare Workers (see apps/web/README.md)
jobs/                   ingest job (GitHub Actions); rescan comes in Phase 5
.github/workflows/      ingest (every 5 min) and ci (typecheck + tests)
phases/                 the prompt for each build phase
```

## Troubleshooting

- **"Public RPC unreachable: all chain reads used the fallback RPC"**: your internet provider blocks
  `rpc.mainnet.chain.robinhood.com`. Nothing to fix: the Blockscout fallback is used automatically.
- **Many checks "unknown"**: `BLOCKSCOUT_API_KEY` is missing or wrong in `.env`.
- **"was not launched by a supported launchpad"**: the address is not a Pons token (or is a wallet, not a token).

## Deploy

Website: Cloudflare Workers at https://kestrion.autora.workers.dev. Jobs: GitHub Actions. Step by step: [docs/SETUP.md](docs/SETUP.md).

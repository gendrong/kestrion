# apps/web: Kestrion website (Next.js on Cloudflare Workers)

Next.js 16 (App Router) + TypeScript + Tailwind 4, deployed with `@opennextjs/cloudflare`.
Theme "Paper Light" and logo from `CLAUDE.md` §1.

**The website never runs scans** (free Workers allow ~10 ms CPU per request). It reads stored scans from D1;
the ingest job (GitHub Actions) does all scanning. A token without a scan is added to the `scan_requests` queue.

## Pages and routes

| Route | What it is |
|---|---|
| `/` | Home: tagline, search, live feed (filters, sorting, auto-refresh every 60 s), how scoring works |
| `/t/[address]` | Token report from the database, or "Queued for scanning" (polls until ready) |
| `/scan?address=` | Fallback for the search form before JavaScript loads (redirects to `/t/…`) |
| `/img/[cid]` | Token logos, proxied from IPFS only (raster images ≤ 2 MB; never other hosts) |
| `GET /api/v1/token/:address` | 200 report · 202 queued · 400 invalid_address · 404 not_a_launch |
| `GET /api/v1/launches` | Feed: `?stage=new\|near\|graduated&pair=ETH\|USDG\|Other&risk=low\|caution\|high&sort=newest\|safest\|riskiest&since=&limit=` |

Responses: success `{ "data", "meta" }`, error `{ "error": { "code", "message" } }`. CORS open for GET.
Rate limits (per IP, per minute, Workers Rate Limiting binding): API 60, new scan requests 10, images 240.

## Environment

The Worker needs no secrets: it uses the bindings in `wrangler.jsonc` (D1 `DB` + three rate limiters).
Locally, `next dev` gets the same bindings with a local, empty D1 copy (see docs/SETUP.md).
Stack note: Next 15.5 + TypeScript 6 here (OpenNext Cloudflare compatibility); config is `next.config.mjs`.

## Commands

```
npm run dev            # http://localhost:3000
npm run cf:preview     # build for Workers and run it locally
npm run cf:deploy      # build + deploy to https://kestrion.autora.workers.dev
npm run test:e2e       # Playwright smoke tests (E2E_LIVE=1 adds a test that needs a database with scans)
```

# Setup & deploy

How the pieces fit (everything on free plans):

```
GitHub Actions (every 5 min)  ──scan──▶  Cloudflare D1 (SQLite)  ◀──read──  Cloudflare Worker (website + API)
   jobs/src/ingest.ts                     database "kestrion"                https://kestrion.autora.workers.dev
   Blockscout + RPC, D1 REST API                                             rate limits: Workers binding
```

The website never scans by itself (free Workers have ~10 ms CPU per request). A token nobody has scanned yet goes into
the `scan_requests` queue, and the next ingest run (≤ ~5 min) scans it.

## Already done (2026-10-12)

- D1 database `kestrion` created (region APAC), tables created (`npm run db:migrate`).
- Website deployed to https://kestrion.autora.workers.dev (`npm run deploy`).
- Deploys use the `CLOUDFLARE_API_TOKEN` Windows user environment variable.

## Still to do: GitHub (runs the 5-minute ingest job)

1. **Install Git for Windows**: https://git-scm.com/download/win (defaults are fine), then open a new terminal.
2. **Create a public repository** at https://github.com/new named `kestrion` (no README, no .gitignore, no license).
3. **Upload the code** (in this folder):
   ```
   git init -b main
   git add .
   git commit -m "Kestrion: engine, website, ingest job"
   git remote add origin https://github.com/<your-username>/kestrion.git
   git push -u origin main
   ```
   The first push opens a browser window to log in to GitHub. `.env` is git-ignored, so no secret is uploaded
   (check `git status` before committing: `.env` must not be listed).
4. **Create a Cloudflare token for the job** (only D1 access, safer than reusing your main token):
   Cloudflare dashboard → My Profile → API Tokens → Create Token → *Create Custom Token* →
   Permissions: **Account · D1 · Edit** → Account resources: your account → Create. Copy it.
5. **Add repository secrets**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | `623693bd9e26d8a4f91459bd23b37b8a` |
   | `D1_DATABASE_ID` | `ea6b1b65-5ff7-4a2c-91a0-5547fbc4801e` |
   | `CLOUDFLARE_D1_TOKEN` | the token from step 4 |
   | `BLOCKSCOUT_API_KEY` | your Blockscout key (same as in `.env`) |

6. **Start it**: repo → Actions → **ingest** → *Run workflow*. After that it runs every 5 minutes on its own
   (GitHub sometimes delays scheduled runs by a few minutes).

## Everyday commands

```
npm run deploy        # build + deploy the website to Cloudflare
npm run db:migrate    # apply new SQL files in packages/db/migrations to D1
npm run ingest        # run the ingest job once from this laptop (writes to the real D1)
npm run dev           # website locally on http://localhost:3000 (uses a local, empty D1 copy;
                      #   create its tables once: cd apps/web && npx wrangler d1 migrations apply kestrion --local)
```

## What to check

- https://kestrion.autora.workers.dev shows **Live launches** with logos and risk badges.
- Clicking a launch opens its report instantly.
- Pasting an older token address shows **Queued for scanning**, then fills in by itself after the next job run.
- GitHub → Actions → **ingest**: runs are green. Cloudflare dashboard → D1 → kestrion → `job_state` table:
  `ingest:pons-v2` has a recent `last_run`.

## Free-tier limits

| Service | Free limit | Our use |
|---|---|---|
| GitHub Actions | unlimited minutes for public repos | one ~2–8 min run every 5 min |
| Blockscout PRO | 100,000 credits/day, 5 req/s | ~30–100 calls per scanned launch |
| Cloudflare D1 | 5 GB, 5M rows read/day, 100k rows written/day | ~6 rows written per scan |
| Cloudflare Workers | 100,000 requests/day, 10 ms CPU each | reads only |

If Blockscout credits run short (many launches per day), lower `INGEST_CONCURRENCY` or scan fewer early buyers
(`maxLinkedCandidates` in `packages/engine/src/scoring/config.ts`).

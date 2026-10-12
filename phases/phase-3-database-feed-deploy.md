# Phase 3 — Database, live feed & deploy

> **Note (2026-10-12):** this prompt predates two decisions. Hosting is Cloudflare Workers (not Vercel), the database is
> Cloudflare D1 (not Supabase) and rate limiting uses the Workers binding (not Upstash). `CLAUDE.md` §4–§6 is current.

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 2 is done (read `PROGRESS.md`).
- I'll need to create accounts for Supabase, Upstash and Vercel. Tell me exactly which values to put in which env var, step by step.
- Budget is ~$10 total. Tell me BEFORE adding anything paid.

## Goal
The live site shows new Pons launches within ~5 minutes, with scores.

## Read first
`CLAUDE.md` §5 (Architecture: jobs), §6 (Data model), §8 page 1 (Home), §11 (Quality), design canvas artboard "Final — Home desktop" (feed section).

## Tasks
1. **Supabase schema + migrations** for ALL tables in §6 (tokens, scans, score_changes, creators, users, watchlist, followed_creators, notifications, api_keys, flags, job_state), even if later phases fill them. Add sensible indexes.
2. **`jobs/ingest`** script:
   - Reads `job_state.last_block` per factory (active and legacy separately)
   - Fetches new `TokenLaunched` events since then, scans each token, stores `tokens` + `scans` (with `engine_version`)
   - Idempotent: safe to re-run; never double-inserts
   - Structured logs; records run status in `job_state`
3. **GitHub Actions cron**: run `ingest` every 5 minutes (free tier); secrets via GitHub Secrets
4. **Cache**: `/t/[address]` and the token API read the latest scan from DB first; live scan only if missing/stale
5. **Home page `/`** live feed:
   - Big search box (token or creator address)
   - Rows: image, name, ticker, age, pair, market cap (if available), curve progress, risk badge
   - Filters: New / Near graduation / Graduated, pair type, risk level
   - Sort: newest, safest, riskiest
   - Auto-refresh; skeleton loaders
6. **Rate limiting** (Upstash Redis free tier) on scan routes and the API
7. **Deploy to Vercel** with my domain; write the deploy steps in the README

## Done when
The live site shows new Pons launches within ~5 minutes.

## Finish
- Show me how to check the cron is running (GitHub Actions tab) and how to check `job_state`
- Update `README.md` (setup + deploy) and `PROGRESS.md`

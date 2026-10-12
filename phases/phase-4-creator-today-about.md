# Phase 4 — Creator profiles, Today & About

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 3 is done and deployed (read `PROGRESS.md`).

## Goal
Clicking any creator shows their full launch history; the site explains how scoring works; reports look good when shared.

## Read first
`CLAUDE.md` §6 (`creators` table), §7 (checks: for the About page), §8 pages 3, 4, 8, §11 (SEO / OG).

## Tasks
1. **`/creator/[address]`**:
   - All launches by this wallet with scores and outcomes
   - Aggregated stats: number of launches, % "died fast" (definition from config), average score
   - Linked wallets (shared funding source)
   - Fill / update the `creators` table during ingest
   - Leave a placeholder spot for the "Follow creator" button (it gets wired up in Phase 5)
2. **Link creators everywhere**: creator card on `/t/[address]` and creator addresses in the feed link to `/creator/[address]`
3. **Search**: a creator address in the search box routes to `/creator/[address]`
4. **`/today`**: riskiest and cleanest launches of the last 24h, biggest score changes (show "not enough data yet" until Phase 5 fills `score_changes`)
5. **`/about`**: how scoring works, every check explained simply (with the weights from config), score bands, limitations, disclaimer
6. **OG share images** (Vercel OG) per token report: name, ticker, score, label, Kestrion logo
7. **SEO meta** for report and creator pages
8. **Share button** on the token report

## Done when
Clicking any creator shows their full launch history.

## Finish
- Update `README.md` and `PROGRESS.md`
- Tell me which pages to open to check everything

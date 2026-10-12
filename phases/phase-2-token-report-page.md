# Phase 2 — Token report page

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 1b is done (read `PROGRESS.md`). The engine works via `npm run scan`.

## Goal
Paste a token address on my phone and get a full report on the website.

## Read first
`CLAUDE.md` §1 (Product: brand, tone, footer), §4 (Stack), §8 page 2 (`/t/[address]`), §9 (API — only the token endpoint), §11 (Quality, security).

## Design reference
- Theme colors, risk badge colors and the logo SVG: `CLAUDE.md` §1 ("Paper Light" + "Hover Badge")
- Layout reference: design canvas https://claude.ai/artifact/S4mstHBu2dS9Vvdwb8JmfV, artboard **"Final — Home desktop"** (header, search, sample report card, feed table, footer)

## Tasks
1. **Next.js app** in `apps/web` (App Router, TypeScript strict, Tailwind) that imports `packages/engine`
2. **Theme**: design tokens (colors, fonts) in one place; mobile-first
3. **Layout**: header (logo, nav), footer with "Kestrion is independent and not affiliated with Robinhood Markets or Pons Labs." and "Data, not advice. DYOR."
4. **Search box** (header or home) → validates the address → routes to `/t/[address]`
5. **`/t/[address]`**, a live scan (no database yet):
   - Score + label, plain-language summary (built from the check results, NOT an LLM yet)
   - Checklist of all 8 checks: pass / warn / fail / unknown with raw numbers and the deduction
   - Top holders table with labels (creator, linked, pool, locker)
   - Creator card (address, wallet age, prior launches)
   - Links to Pons and to the explorer
   - "Last scanned" time
   - Skeleton loader while scanning; clear error state for invalid / unknown addresses
   - Leave the watchlist / flag / share / rescan / score history buttons out (later phases)
6. **API**: `GET /api/v1/token/:address` returns the scan as JSON, with a consistent error format and CORS for GET
7. **Security**: validate every address; escape token names / symbols; never render untrusted HTML; allowlist or proxy token image hosts
8. **Tests**: a couple of Playwright smoke tests (search → report page renders; invalid address → error)

## Out of scope
Database, feed, accounts, rate limiting (Phase 3+).

## Done when
I can paste an address on my phone and get a full report.

## Finish
- Show me how to run it locally and how to open it from my phone on the same Wi-Fi
- Update `README.md` and `PROGRESS.md`

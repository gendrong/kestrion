# Phase 7 — $KEST holder perks (after the token launches)

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 6 is done (read `PROGRESS.md`).
- $KEST has launched. I will give you the token address. **Do not proceed without it**, and verify it on https://robin.etherscan.io.

## Goal
A wallet holding $KEST automatically gets the Holder tier.

## Read first
`CLAUDE.md` §6 (`users.kest_balance_cached`, `tier`), §10 (Accounts & $KEST holder perks).

## Tasks
1. Add the $KEST token address to the chain config, with a source comment
2. Tier thresholds in config (Free / Holder)
3. Read the $KEST balance on-chain at sign-in; refresh periodically (e.g. in the `rescan` job or on session refresh). Read-only.
4. Tier logic:
   - Free: search, reports, feed, 5 watchlist items, follow 3 creators
   - Holder: unlimited watchlist and follows, higher API limit, early access to new features
5. UI: show the user's tier; show holder-only limits and an explanation when a Free user hits a limit
6. Feature stays disabled if the token address is not set (keep that behavior)
7. Tests for the tier logic

## Done when
A wallet holding $KEST automatically gets Holder tier.

## Finish
- Update `README.md` and `PROGRESS.md`

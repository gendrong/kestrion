# Phase 5 — Accounts, watchlist & notifications

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 4 is done (read `PROGRESS.md`).

## Goal
A watchlisted token's score change shows up in my notifications.

## Read first
`CLAUDE.md` §5 (`rescan` job), §6 (users, watchlist, followed_creators, notifications, score_changes), §8 pages 2, 5, 6, §10 (Free tier limits).

## Tasks
1. **Wallet sign-in**: RainbowKit + wagmi + SIWE. No email/password. Session handled server-side. Read-only: never ask for transactions.
2. **Users**: create a `users` row on first sign-in (tier = Free for now; $KEST tiers come in Phase 7)
3. **Watchlist**: "Add to watchlist" on `/t/[address]`; Free limit 5 items (limit from config)
4. **Follow creators**: "Follow creator" on `/creator/[address]`; Free limit 3 (from config)
5. **`jobs/rescan`** (hourly GitHub Actions cron):
   - Rescans tokens from the last 72h + every watchlisted token
   - When a score changes, writes `score_changes` (old, new, reason, time)
   - Idempotent, structured logs, records status in `job_state`
6. **Notifications**:
   - Watchlisted token score changed → notification
   - Followed creator launched a new token (from `ingest`) → notification
7. **Header bell icon** with unread count; `/notifications` list with mark-as-read
8. **`/watchlist`**: my tokens + followed creators, current scores, "score changed" badges
9. **Score history chart** on `/t/[address]`
10. **Rescan button** on `/t/[address]`: rate-limited
11. **Fill `/today`** "biggest score changes" from `score_changes`

## Done when
A watchlisted token's score change shows up in my notifications.
(Tell me how to test this without waiting: e.g. a script that forces a rescan with a tweaked config.)

## Finish
- Update `README.md` and `PROGRESS.md`

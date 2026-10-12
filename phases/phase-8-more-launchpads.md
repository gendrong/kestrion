# Phase 8 — More launchpads

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 7 is done (or skipped). Read `PROGRESS.md`.

## Goal
Launches from a second launchpad appear in the feed with scores.

## Read first
`CLAUDE.md` §2 (other launchpads: Pools.trade, RobinFun, RealFun, Bow.fun), §3 (rules on verifying sources), §5 (`LaunchpadAdapter`).

## Tasks
1. **Research first (STOP for my OK)**: for the next launchpad (start with Pools.trade), find factory addresses, launch events, ABIs and curve/graduation logic, each with a source, the same way as Phase 1a. Save to `docs/chain-research.md`. Wait for my OK.
2. **Adapter**: implement `LaunchpadAdapter` for it in `packages/engine/adapters/<name>/`, without changing the core engine
3. **Checks**: if a check works differently on this launchpad (e.g. no snipe-tax whitelist), return `unknown` or a launchpad-specific explanation. Never a silent pass.
4. **Ingest**: `ingest` job processes the new adapter's factories with their own `job_state` rows
5. **Feed**: add a launchpad filter; show the launchpad name on rows and reports
6. **Tests** with fixtures for the new adapter
7. Repeat for further launchpads only when I ask

## Done when
Launches from a second launchpad appear in the feed with scores.

## Finish
- Update `README.md` and `PROGRESS.md`

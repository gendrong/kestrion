# Phase 1b — Monorepo + scanning engine

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 1a is approved (2026-10-08). Use ONLY the addresses, ABIs, events and RPC from `docs/chain-research.md`.
- Decisions made: support **Pons V2 (main) + V1 active + V1 legacy**; pair types are
  **ETH / USDG / Other token** (no Stock Token list); local dev does NOT change DNS: the RPC
  client must fall back to the Blockscout JSON-RPC automatically.
- `BLOCKSCOUT_API_KEY` is already in `.env` (git-ignored).
- If `PROGRESS.md` exists, read it.

## Goal
A pure TypeScript engine that scans any Pons token and prints a full, explainable risk report from the CLI.

## Read first
`CLAUDE.md` §2 (Chain facts), §4 (Stack), §5 (Architecture), §7 (Risk engine).

## Tasks
1. **Monorepo setup**
   - Folders: `packages/engine`, `apps/web` (empty placeholder for now), `jobs/` (empty placeholder)
   - npm workspaces, TypeScript strict, vitest
   - Root scripts: `npm run scan <address>`, `npm test`
   - `.env.example` with comments (`RPC_URL`, `FALLBACK_RPC_URL`, `BLOCKSCOUT_API_KEY`)
2. **Chain config** — `packages/engine/chain/config.ts`
   - Every address / ABI / event signature / topic0 from `docs/chain-research.md`, each with a comment citing its source
   - Holder-exclusion list per factory (V2 curve, v4 PoolManager, Launch Locker, Buyback Vault, V1 pool + lockers, `0x0`, `0x…dEaD`)
3. **RPC client** (viem)
   - Public RPC with retry + exponential backoff; automatic switch to the Blockscout JSON-RPC fallback on network/TLS errors
   - `getLogs` helper that splits ranges into ≤ 20,000-block chunks
4. **Blockscout API client** — address transactions (first funder, wallet age), internal txs, token holders; rate-limited to ≤ 5 req/s; results cached in memory per scan
5. **`LaunchpadAdapter` interface** — `packages/engine/adapters/types.ts`
   - Methods: discover launches (from block X to Y), read launch config, read curve state, detect graduation
   - Designed so new launchpads (Phase 8) plug in without touching the core
6. **Pons adapters** — `packages/engine/adapters/pons/`
   - **V2** (main): V2 `TokenLaunched`, `getLaunchedToken` tuple, curve getters, `CurveBuy`/`CurveSell`, v4 after graduation
   - **V1 active** and **V1 legacy**: V1 `TokenLaunched`, `getLaunchedToken`, `graduationStatus`, v3 pool `Swap`
   - Each factory independent; given any token address, detect which factory launched it
   - Creator = `tx.from` / `creatorFeeRecipient` when the event `deployer` is a contract
7. **The 8 checks** (§7), each returning `{ status: pass | warn | fail | unknown, value, explanation }`
   (data sources per check: `docs/chain-research.md` §5):
   1. Whitelist / snipe-tax exemptions (+ creator funding trace, up to 2 hops). V2: exemptions from the launch tx input
      (factory/router calls), early `CurveBuy` logs paying no snipe tax, and `currentSnipeTaxBps` at the launch block
      when still within the RPC state window. Report "at least N" when the full list can't be known. V1: informational.
   2. Creator cluster buy (first N blocks, creator + wallets with shared funding source)
   3. Holder concentration (top-10, excluding pool / locker / burn)
   4. Creator history (prior launches, "died fast" as defined in config, repeated names/tickers)
   5. Creator wallet (age, funding source type)
   6. Curve state (progress, graduated, time since launch)
   7. Pair type (informational)
   8. Sell pressure (creator / linked wallets sold > X%)
   - A check that can't be computed returns `unknown` — never a silent pass.
8. **Scoring config** — ONE file (e.g. `packages/engine/scoring/config.ts`) with all weights and thresholds, each commented
9. **Scoring function** — score 0–100 from weighted deductions; labels: 70–100 Low risk, 40–69 Caution, 0–39 High risk. Output includes every deduction with reason + raw numbers, and `engine_version`.
10. **CLI** — `npm run scan <address>` prints: token info (incl. which factory), score + label, every check with status / raw numbers / deduction, "Data, not advice. DYOR."
11. **Tests** — unit tests for every check and the scoring function using fixtures (no live RPC in unit tests).

## Rules
- Engine has NO framework code (no Next.js, no React).
- Read-only: never hold keys, never send transactions.
- Language in output: factual, never "scam" / "rug".
- If real data doesn't support a check as specified, tell me and propose an alternative.

## Done when
Scanning 5 real Pons tokens gives sensible, explainable reports.
Show me the CLI output for all 5 (pick a mix: at least 3 V2 + 1 V1; new, near graduation, graduated, and at least one with snipe-tax exemptions).

## Finish
- `npm test` passes — show the output
- Create/update `README.md`: setup, env vars, how to run `scan` and tests
- Create/update `PROGRESS.md`: done, left, known issues
- Tell me exactly how to run it and what to check

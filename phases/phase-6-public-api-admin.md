# Phase 6 — Public API & admin

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Before you start
- Phase 5 is done (read `PROGRESS.md`).

## Goal
An external script can fetch reports with an API key; I can review flags and job health in `/admin`.

## Read first
`CLAUDE.md` §6 (api_keys, flags, job_state), §7 (LLM summary rules), §8 pages 7, 9, §9 (Public API), §11.

## Tasks
1. **API v1 endpoints**:
   - `GET /api/v1/token/:address`: latest scan
   - `GET /api/v1/creator/:address`: creator stats + launches
   - `GET /api/v1/launches?since=&risk=&limit=`: recent launches
   - `POST /api/v1/scan/:address`: request a rescan (auth + rate-limited)
   - Consistent error format; CORS for GET
2. **Rate limits**: no key = low limit; API key = higher limit (values in config)
3. **API key management** (signed-in users): create / revoke; key shown ONCE; stored hashed; `last_used` updated
4. **`/api-docs`**: public docs with examples (curl + JS) + key management UI
5. **Flag this report** on `/t/[address]`: type (false_positive / missed_risk) + note, signed-in only, rate-limited
6. **`/admin`** (only wallets in `ADMIN_WALLETS` env):
   - Review flags (change status)
   - Job health: last runs, status, errors from `job_state` / logs
   - Trigger rescans
   - Score distribution chart
7. **Optional LLM summaries** (Gemini free tier):
   - 2–3 plain sentences built ONLY from the check JSON; the prompt forbids adding facts
   - Never changes the score; cached per scan (`scans.summary`)
   - Site works fully without it (feature off if no API key)

## Done when
An external script can fetch reports with an API key.
Give me a small example script (Node or curl) to prove it.

## Finish
- Update `README.md` and `PROGRESS.md`

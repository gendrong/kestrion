-- Phase 6: API keys (names + a visible prefix), report flags, optional AI summaries.
-- Apply with: npm run db:migrate   (from the repo root)

-- The full key is shown once at creation; we keep only its SHA-256 (key_hash) plus the first characters (prefix)
-- so people can tell their keys apart.
ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE api_keys ADD COLUMN prefix TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_wallet);

CREATE INDEX IF NOT EXISTS flags_status_idx ON flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS flags_token_idx ON flags (token);
ALTER TABLE flags ADD COLUMN reviewed_at TEXT;
ALTER TABLE flags ADD COLUMN reviewed_by TEXT;

-- Optional plain-language summary written by an LLM from the check results only (never changes the score).
-- NULL = not generated (the feature is off without a Gemini API key).
ALTER TABLE scans ADD COLUMN ai_summary TEXT;

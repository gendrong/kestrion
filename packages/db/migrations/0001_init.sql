-- Kestrion schema for Cloudflare D1 (SQLite). CLAUDE.md §6.
-- Addresses are stored lower-case. Times are ISO-8601 UTC strings (they sort correctly as text).
-- JSON columns are TEXT. D1 is reachable only through the Worker binding or an API token: there is no public access.
-- Apply with: npx wrangler d1 migrations apply kestrion --remote   (run in apps/web)

CREATE TABLE IF NOT EXISTS tokens (
  address         TEXT PRIMARY KEY CHECK (length(address) = 42 AND address = lower(address)),
  launchpad       TEXT NOT NULL,
  factory         TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  symbol          TEXT NOT NULL DEFAULT '',
  creator         TEXT NOT NULL,
  deployer        TEXT NOT NULL,
  paired_token    TEXT NOT NULL,
  pair_type       TEXT NOT NULL CHECK (pair_type IN ('ETH', 'USDG', 'Other')),
  pair_symbol     TEXT NOT NULL DEFAULT '',
  pool            TEXT,                                -- V2 curve or V1 pool
  launch_block    INTEGER NOT NULL,
  launch_time     TEXT NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}',          -- cleaned JSON: logoCid, description, socials
  logo_cid        TEXT,                                -- copy of metadata.logoCid for the feed
  -- Copy of the latest scan so the live feed is one fast query.
  latest_scan_id  INTEGER,
  score           INTEGER CHECK (score BETWEEN 0 AND 100),
  label           TEXT,
  curve_progress  REAL,
  graduated       INTEGER NOT NULL DEFAULT 0,
  stage           TEXT CHECK (stage IN ('new', 'near', 'graduated')),
  last_scanned_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS tokens_launch_time_idx ON tokens (launch_time DESC);
CREATE INDEX IF NOT EXISTS tokens_creator_idx ON tokens (creator);
CREATE INDEX IF NOT EXISTS tokens_stage_time_idx ON tokens (stage, launch_time DESC);
CREATE INDEX IF NOT EXISTS tokens_score_idx ON tokens (score);

CREATE TABLE IF NOT EXISTS scans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT NOT NULL REFERENCES tokens (address) ON DELETE CASCADE,
  scanned_at     TEXT NOT NULL,
  score          INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  label          TEXT NOT NULL,
  checks         TEXT NOT NULL,                        -- JSON: all checks with raw numbers
  report         TEXT NOT NULL,                        -- JSON: the rest of the report (without checks)
  engine_version TEXT NOT NULL,
  summary        TEXT
);
CREATE INDEX IF NOT EXISTS scans_token_time_idx ON scans (token, scanned_at DESC);

CREATE TABLE IF NOT EXISTS score_changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL REFERENCES tokens (address) ON DELETE CASCADE,
  old_score  INTEGER NOT NULL,
  new_score  INTEGER NOT NULL,
  reason     TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS score_changes_token_idx ON score_changes (token, changed_at DESC);
CREATE INDEX IF NOT EXISTS score_changes_time_idx ON score_changes (changed_at DESC);

CREATE TABLE IF NOT EXISTS creators (
  address         TEXT PRIMARY KEY,
  first_seen      TEXT,
  wallet_age_days REAL,
  funding_source  TEXT,
  total_launches  INTEGER NOT NULL DEFAULT 0,
  stats           TEXT NOT NULL DEFAULT '{}',
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS users (
  wallet              TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kest_balance_cached TEXT,
  tier                TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'holder'))
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_wallet TEXT NOT NULL REFERENCES users (wallet) ON DELETE CASCADE,
  token       TEXT NOT NULL REFERENCES tokens (address) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_wallet, token)
);

CREATE TABLE IF NOT EXISTS followed_creators (
  user_wallet TEXT NOT NULL REFERENCES users (wallet) ON DELETE CASCADE,
  creator     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_wallet, creator)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_wallet TEXT NOT NULL REFERENCES users (wallet) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('score_changed', 'creator_launched')),
  token       TEXT REFERENCES tokens (address) ON DELETE CASCADE,
  creator     TEXT,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_wallet TEXT NOT NULL REFERENCES users (wallet) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  tier        TEXT NOT NULL DEFAULT 'free',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used   TEXT,
  revoked_at  TEXT
);

CREATE TABLE IF NOT EXISTS flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL REFERENCES tokens (address) ON DELETE CASCADE,
  user_wallet TEXT REFERENCES users (wallet) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('false_positive', 'missed_risk')),
  note        TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS job_state (
  job        TEXT PRIMARY KEY,                         -- e.g. 'ingest:pons-v2', 'ingest:queue'
  last_block INTEGER,
  last_run   TEXT,
  status     TEXT,
  error      TEXT,
  stats      TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS scan_requests (
  token        TEXT PRIMARY KEY CHECK (length(token) = 42 AND token = lower(token)),
  requested_at TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'scanning', 'done', 'failed', 'not_a_launch')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scan_requests_queue_idx ON scan_requests (status, requested_at);

-- Phase 5: wallet sign-in (SIWE), watchlist, followed creators, notifications.
-- Apply with: npm run db:migrate   (from the repo root)

-- One-time SIWE nonces (valid 10 minutes, used once).
CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  used_at    TEXT
);

-- Sign-in sessions. Only a SHA-256 hash of the session cookie is stored, never the cookie itself.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash      TEXT PRIMARY KEY,
  user_wallet  TEXT NOT NULL REFERENCES users (wallet) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_wallet);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

-- Who watches a token / follows a creator (the jobs look these up after every scan and launch).
CREATE INDEX IF NOT EXISTS watchlist_token_idx ON watchlist (token);
CREATE INDEX IF NOT EXISTS followed_creators_creator_idx ON followed_creators (creator);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_wallet, read_at);

-- Phase 4: creator pages, creator lookups, share images.
-- Apply with: npm run db:migrate   (from the repo root)

-- The `creators` table (0001) is filled by the jobs from every scan:
--   first_seen      ISO time of the wallet's first transaction
--   funding_source  exchange | bridge | launch_proceeds | contract | wallet | none | unknown
--   total_launches  Pons launches found on-chain for this wallet (including the scanned token)
--   stats           JSON: funder, funderLabel, searchPartial, launches[], linkedWallets[]

-- Wallets someone looked up on the website that we haven't seen as a creator yet. The ingest job searches
-- their launches on-chain and queues the most recent ones for scanning.
CREATE TABLE IF NOT EXISTS creator_requests (
  address      TEXT PRIMARY KEY CHECK (length(address) = 42 AND address = lower(address)),
  requested_at TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'searching', 'done', 'no_launches', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS creator_requests_queue_idx ON creator_requests (status, requested_at);

-- Share images (1200×630 PNG, base64) rendered by the jobs. Only kept for recent launches (see pruneOgImages);
-- older tokens use the default image.
CREATE TABLE IF NOT EXISTS og_images (
  token      TEXT PRIMARY KEY REFERENCES tokens (address) ON DELETE CASCADE,
  scanned_at TEXT NOT NULL,                            -- the scan this image shows
  png_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tokens_creator_time_idx ON tokens (creator, launch_time DESC);
DROP INDEX IF EXISTS tokens_creator_idx;

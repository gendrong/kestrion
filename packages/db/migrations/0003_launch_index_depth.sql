-- Launch index + scan depth (the free explorer tier can't afford a full scan of every launch).
-- Apply with: npm run db:migrate   (from the repo root)

-- Every Pons launch ever (from the factories' TokenLaunched events), filled by the ingest job: backfilled from each
-- factory's first block and extended every run. Creator history and wallet lookups query this instead of
-- searching the chain through the explorer. Progress per factory: job_state 'index:<factory>' (last indexed block).
CREATE TABLE IF NOT EXISTS launch_index (
  token                TEXT PRIMARY KEY CHECK (length(token) = 42 AND token = lower(token)),
  factory              TEXT NOT NULL,
  deployer             TEXT NOT NULL,                  -- indexed event field: the creator search key (EOA or launcher)
  curve_or_pool        TEXT,                           -- V2 curve / V1 pool
  pair_token           TEXT,
  graduation_threshold TEXT,                           -- V2, raw units
  launch_block         INTEGER NOT NULL,
  launch_time          TEXT,                           -- ISO; estimated from nearby block times when not exact
  tx_hash              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS launch_index_deployer_idx ON launch_index (deployer, launch_block DESC);

-- 'quick' (every launch) or 'full' (funding traces too). Requests from the website ask for a full scan.
ALTER TABLE scan_requests ADD COLUMN depth TEXT NOT NULL DEFAULT 'full' CHECK (depth IN ('quick', 'full'));
ALTER TABLE tokens ADD COLUMN scan_depth TEXT CHECK (scan_depth IS NULL OR scan_depth IN ('quick', 'full'));
-- Existing scans (engine < 0.2.0) were all full scans.
UPDATE tokens SET scan_depth = 'full' WHERE last_scanned_at IS NOT NULL;

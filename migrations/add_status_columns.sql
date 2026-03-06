-- ==========================================================
-- GLOBAL ACTIVE STATUS MIGRATION
-- Adds tracking columns to the players table
-- ==========================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Offline';
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Index for status queries (used in Friends/Messages panels)
CREATE INDEX IF NOT EXISTS idx_players_status ON players(status);
CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen_at);

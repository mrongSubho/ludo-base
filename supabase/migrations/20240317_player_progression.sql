-- Add XP and Rating columns to players table
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS xp BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS rating INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS season_id INT DEFAULT 20241; -- Format: YYYYQ (Year + Quarter)

-- Optional: Indexing for leaderboard performance
CREATE INDEX IF NOT EXISTS idx_players_xp ON public.players (xp DESC);
CREATE INDEX IF NOT EXISTS idx_players_rating ON public.players (rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_season ON public.players (season_id);

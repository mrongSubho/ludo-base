BEGIN;

CREATE TABLE IF NOT EXISTS public.player_free_matches (
    id uuid primary key default gen_random_uuid(),
    match_id text not null,
    player_id text not null,
    won boolean not null default false,
    is_pvp boolean not null default false,
    captures integer not null default 0,
    played_at timestamptz not null default now(),
    onchain_synced boolean not null default false,
    sync_tx_hash text,
    created_at timestamptz not null default now(),
    unique (player_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_player_free_matches_unsynced
    ON public.player_free_matches (player_id, onchain_synced)
    WHERE onchain_synced = false;

ALTER TABLE public.player_free_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player_free_matches_select_all" ON public.player_free_matches;
CREATE POLICY "player_free_matches_select_all"
    ON public.player_free_matches
    FOR SELECT
    USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.player_free_matches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.player_free_matches TO PUBLIC, anon, authenticated;
GRANT ALL ON public.player_free_matches TO service_role;

COMMIT;

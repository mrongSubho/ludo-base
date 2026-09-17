-- Wallet-only app: old RLS required auth.jwt() sub, so inserts/realtime never
-- delivered invites. Host writes go through the service-role API; guests
-- read their own invites via /api/lobby/invits (wallet query param).
-- Keep SELECT broad enough for realtime only if needed; prefer API.

DROP POLICY IF EXISTS "Users manage own invites" ON public.game_invites;

-- Service role bypasses RLS. Anon clients must not insert/update/delete.
DROP POLICY IF EXISTS "game_invites deny anon write" ON public.game_invites;
CREATE POLICY "game_invites deny anon write"
    ON public.game_invites FOR INSERT
    WITH CHECK (false);

-- Optional read for debugging; do not expose other guests' rows in UI.
-- (API remains the supported read path.)

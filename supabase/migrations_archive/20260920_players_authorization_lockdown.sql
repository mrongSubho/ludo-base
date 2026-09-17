-- All player mutations go through wallet-bound server endpoints.
DROP POLICY IF EXISTS "players open update" ON public.players;
DROP POLICY IF EXISTS "players profile update" ON public.players;
DROP POLICY IF EXISTS "players open insert" ON public.players;
DROP POLICY IF EXISTS "Anyone can insert players" ON public.players;

CREATE OR REPLACE FUNCTION public.prevent_client_player_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.wallet_address IS DISTINCT FROM OLD.wallet_address
       OR NEW.coins IS DISTINCT FROM OLD.coins
       OR NEW.total_wins IS DISTINCT FROM OLD.total_wins
       OR NEW.total_games IS DISTINCT FROM OLD.total_games
       OR NEW.classic_played IS DISTINCT FROM OLD.classic_played
       OR NEW.power_played IS DISTINCT FROM OLD.power_played
       OR NEW.ai_played IS DISTINCT FROM OLD.ai_played
       OR NEW.lxp IS DISTINCT FROM OLD.lxp
       OR NEW.rxp IS DISTINCT FROM OLD.rxp
       OR NEW.season_id IS DISTINCT FROM OLD.season_id
       OR NEW.rank_tier IS DISTINCT FROM OLD.rank_tier
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.last_played_at IS DISTINCT FROM OLD.last_played_at
       OR NEW.ecdh_pubkey IS DISTINCT FROM OLD.ecdh_pubkey THEN
      RAISE EXCEPTION 'protected player fields are server-owned';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS players_prevent_client_tampering ON public.players;
CREATE TRIGGER players_prevent_client_tampering
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_player_tampering();

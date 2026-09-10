-- Publish static ECDH public keys for sealed-box DMs.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS ecdh_pubkey JSONB;

COMMENT ON COLUMN public.players.ecdh_pubkey IS
  'JWK of the identity static ECDH P-256 public key used for DM sealed boxes.';

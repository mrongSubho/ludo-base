-- Wave 5: Player Compliance Consents (Age 18+, Region, ToS/Privacy v1, EU/DMA, Telemetry choice)

BEGIN;

CREATE TABLE IF NOT EXISTS public.player_consents (
  wallet_address      text PRIMARY KEY REFERENCES public.players(wallet_address) ON DELETE CASCADE,
  tos_version         text NOT NULL,
  privacy_version     text NOT NULL,
  age_18_confirmed    boolean NOT NULL DEFAULT false,
  region_code         text NOT NULL DEFAULT 'XX',
  analytics_consent   boolean NOT NULL DEFAULT false,
  eu_dma_acknowledged boolean NOT NULL DEFAULT false,
  ip_hash             text,
  accepted_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  constraint player_consents_wallet_lower check (wallet_address = lower(wallet_address))
);

ALTER TABLE public.player_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_consents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.player_consents TO service_role;

COMMIT;

-- Migration: 202610180006_indexer_cursor.sql
-- Description: Chain indexer durable cursor in Postgres (P16/G8)
-- Supports reorg-safe log indexing with atomic block progression.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chain_indexer_cursors (
  chain_id INT PRIMARY KEY,
  last_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chain_indexer_cursors ENABLE ROW LEVEL SECURITY;

-- Service role has full access; anon and authenticated cannot write
CREATE POLICY chain_indexer_cursors_service_policy
  ON public.chain_indexer_cursors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RPC to get current cursor block
CREATE OR REPLACE FUNCTION public.get_chain_indexer_cursor(p_chain_id INT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_block BIGINT;
BEGIN
  SELECT last_block INTO v_last_block
  FROM public.chain_indexer_cursors
  WHERE chain_id = p_chain_id;

  RETURN COALESCE(v_last_block, 0);
END;
$$;

-- RPC to update cursor block atomically
CREATE OR REPLACE FUNCTION public.update_chain_indexer_cursor(p_chain_id INT, p_last_block BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.chain_indexer_cursors (chain_id, last_block, updated_at)
  VALUES (p_chain_id, p_last_block, now())
  ON CONFLICT (chain_id)
  DO UPDATE SET
    last_block = EXCLUDED.last_block,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chain_indexer_cursor(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_chain_indexer_cursor(INT, BIGINT) TO service_role;

COMMENT ON TABLE public.chain_indexer_cursors IS 'Durable block cursor for the CHIPS chain event indexer (P16/G8).';

COMMIT;

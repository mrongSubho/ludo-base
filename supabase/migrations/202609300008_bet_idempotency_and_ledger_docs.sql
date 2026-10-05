-- Enforce spectator-bet idempotency (DB-13) and document the ledger's status.
--
-- DB-13: `spectator_bets` had `unique(player_id, action_id)` with `action_id`
-- NULLABLE and no writer ever supplied one, so under Postgres' default
-- NULLS DISTINCT the constraint permitted unlimited duplicate (player, NULL)
-- rows — the idempotency key was unenforceable.
--
-- chips_escrow_place_bet (202609300005) now always writes an action_id (the
-- client may supply one for replay, otherwise the route generates a UUID), and
-- it dedups on it. So the column can be made NOT NULL.
--
-- Safety: backfill first, then set NOT NULL. Bets that predate the escrow path
-- (written by the old direct insert, which is frozen) get a deterministic
-- synthetic id derived from their own primary key so the constraint can be
-- applied without inventing collisions.
--
-- DB-14: coin_ledger has `unique(player_id, idempotency_key)` and a full
-- double-entry shape, but after 202609230003 froze every writer it has ZERO
-- writers. That is misleading: the table implies a guarantee that does not
-- exist. Documented as reserved rather than left looking authoritative. CHIPS is
-- on-chain; the off-chain accounting of record for spectator betting is
-- chips_escrow_ledger, which is written and reconciled.

begin;

-- ── DB-13 ────────────────────────────────────────────────────────────────
update public.spectator_bets
   set action_id = 'legacy:' || id::text
 where action_id is null;

alter table public.spectator_bets
  alter column action_id set not null;

-- Belt and braces: even if a future writer omits it, the escrow path's own unique
-- constraint catches the duplicate.
alter table public.spectator_bets
  drop constraint if exists spectator_bets_player_id_action_id_key;
alter table public.spectator_bets
  add constraint spectator_bets_player_action_uniq unique (player_id, action_id);

comment on column public.spectator_bets.action_id is
  'Client-supplied idempotency key. NOT NULL: the old unique(player_id, action_id) was unenforceable while this column was nullable (NULLS DISTINCT allowed unlimited duplicates).';

-- ── DB-14 ────────────────────────────────────────────────────────────────
comment on table public.coin_ledger is
  'RESERVED — currently has zero writers. All legacy players.coins writers were frozen by 202609300001, and CHIPS is an on-chain ERC-20, so no Postgres-side coin ledger is maintained. Do not treat this table as an authoritative double-entry record. The off-chain accounting of record for CHIPS spectator betting is chips_escrow_ledger (written by chips_escrow_* and checked by chips_escrow_solvency).';

commit;

-- Phase 1 unblock: close the four remaining data-layer gaps found in the
-- 2026-10-06 tracker reconciliation.
--
--   1. chips_escrow_config: `allow_self_bets` was NOT part of the arming
--      interlock, so `update chips_escrow_config set enabled = true,
--      allow_self_bets = true` re-opened self-betting with one statement.
--   2. mission_vouchers: the unique key was on the raw wallet column. Lowercase
--      was only enforced upstream by an FK plus a CHECK on `players`, so the
--      claim lock depended on two constraints living in another table.
--   3. mission_vouchers: the voucher nonce was `Date.now() * 1000 + random`.
--   4. mission_vouchers: a reservation whose signature step failed left a
--      `signature = 'pending'` row behind, permanently burning that player's
--      reward for the whole period with no reclamation path.

begin;

-- ---------------------------------------------------------------------------
-- 1. Arming the escrow must also forbid self-betting.
--
-- The intent is documented on the column ("A bettor may not bet on a match
-- they are seated in"), and `chips_escrow_place_bet` blocks self-bets on
-- `player_id = any(m.participants)`. But `allow_self_bets` sat outside the
-- armed CHECK, so the RPC's own guard was silently overridable by config.
--
-- This makes self-betting structurally impossible while the escrow is live.
-- If the business ever wants it, that has to arrive as a reviewed migration
-- rather than a config write.
-- ---------------------------------------------------------------------------
alter table public.chips_escrow_config
    drop constraint if exists chips_escrow_config_armed;

alter table public.chips_escrow_config
    add constraint chips_escrow_config_armed check (
        not enabled or (
            treasury_wallet is not null
            and rake_bps > 0
            and not allow_self_bets
        )
    );

comment on constraint chips_escrow_config_armed on public.chips_escrow_config is
    'Arming interlock: a live escrow needs a treasury wallet, a non-zero rake, and self-betting left off. allow_self_bets is deliberately inside this CHECK so it cannot be re-enabled by a config write.';

-- Fail loudly if an already-armed config would violate the new rule, rather
-- than silently refusing the constraint.
do $$
declare
    bad int;
begin
    select count(*) into bad
    from public.chips_escrow_config
    where enabled and allow_self_bets;
    if bad > 0 then
        raise exception
            'chips_escrow_config is armed with allow_self_bets=true (% row(s)); disarm before applying this migration', bad;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Case-normalize the mission_vouchers claim lock.
--
-- Key on `lower(wallet_address)` via a unique INDEX: a UNIQUE *constraint*
-- cannot hold an expression, and an index is what the claim lock needs to
-- actually enforce case-insensitivity rather than depend on it. Deduping first
-- would silently discard vouchers, so any duplicate found here aborts the
-- migration for a human to resolve.
-- ---------------------------------------------------------------------------
do $$
declare
    dupes int;
begin
    select count(*) into dupes
    from (
        select lower(wallet_address), mission_id, period_id
        from public.mission_vouchers
        group by 1, 2, 3
        having count(*) > 1
    ) d;
    if dupes > 0 then
        raise exception
            'mission_vouchers has % duplicate (lower(wallet_address), mission_id, period_id) group(s); resolve before applying', dupes;
    end if;
end;
$$;

alter table public.mission_vouchers
    drop constraint if exists mission_vouchers_wallet_address_mission_id_period_id_key;

create unique index if not exists mission_vouchers_claim_uniq
    on public.mission_vouchers (lower(wallet_address), mission_id, period_id);

-- ---------------------------------------------------------------------------
-- 3. A real nonce sequence, so the signed payload stops depending on wall time.
--
-- The old value was `Date.now() * 1000 + random`. It was safe only because the
-- unique constraint bounded it; a sequence makes the uniqueness structural
-- rather than incidental, and keeps two vouchers issued in the same millisecond
-- distinguishable without consulting the clock.
-- ---------------------------------------------------------------------------
create sequence if not exists public.mission_voucher_nonce_seq as bigint;

comment on sequence public.mission_voucher_nonce_seq is
    'Nonce source for EIP-712 MissionVoucher payloads. Monotonic, so a voucher signature never depends on server clock state.';

-- ---------------------------------------------------------------------------
-- 4. Make orphaned reservations reclaimable.
--
-- The route reserves the (wallet, mission, period) slot with
-- `signature = 'pending'` BEFORE signing, so a concurrent racer is rejected by
-- the unique constraint. But if signing then failed, the pending row survived
-- and the player could not claim that period again — a transient edge failure
-- permanently consumed a daily bonus.
--
-- `reserved_at` lets a sweep find (and the route's own error path delete) rows
-- that were never completed. The route deletes on failure; this index makes a
-- periodic sweep cheap for anything a crash leaves behind.
-- ---------------------------------------------------------------------------
alter table public.mission_vouchers
    add column if not exists reserved_at timestamptz;

update public.mission_vouchers
set reserved_at = created_at
where reserved_at is null;

alter table public.mission_vouchers
    alter column reserved_at set not null;

alter table public.mission_vouchers
    alter column reserved_at set default now();

create index if not exists mission_vouchers_pending_idx
    on public.mission_vouchers (reserved_at)
    where signature = 'pending';

comment on column public.mission_vouchers.reserved_at is
    'When the claim slot was reserved. Rows still at signature=''pending'' after a grace period were orphaned by a failed signature and may be reclaimed.';

-- ---------------------------------------------------------------------------
-- Expose the nonce to the app.
--
-- `service_role` only, so the signed payload is server-derived and no client can
-- influence it. Supabase's PostgREST cannot `nextval` a bare sequence, so the
-- sequence is wrapped in a function the service role is allowed to call.
-- ---------------------------------------------------------------------------
grant usage, select on sequence public.mission_voucher_nonce_seq to service_role;

create or replace function public.next_mission_voucher_nonce()
    returns bigint
    language sql
    volatile
    security definer
    set search_path = public
as $$
    select nextval('public.mission_voucher_nonce_seq');
$$;

comment on function public.next_mission_voucher_nonce() is
    'Monotonic nonce for EIP-712 MissionVoucher payloads. service_role only.';

revoke all on function public.next_mission_voucher_nonce() from public, anon, authenticated;
grant execute on function public.next_mission_voucher_nonce() to service_role;

commit;

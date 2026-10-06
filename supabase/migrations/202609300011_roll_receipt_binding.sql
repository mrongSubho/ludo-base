-- SEC-01 / SEC-33 — bind a roll receipt to the seat and the turn that minted it.
--
-- Before this, `roll-dice` accepted {matchId, walletAddress, actionId} from
-- anyone holding the anon key and service-role-inserted the row. There was no
-- authentication, no seat, and no turn. Consequences:
--
--   * attribution forged to any wallet that exists in `players`;
--   * unlimited rolls inserted into any match;
--   * **retry until you roll a six.** The idempotency keyed on
--     (match_id, action_id) looks like it prevents this, but `action_id` is
--     chosen by the caller, so a fresh id on every attempt mints a fresh face.
--     The comment on that code path claimed a guarantee it did not provide.
--
-- Two columns close it. `seat_color` records whose turn the face belongs to,
-- which also gives bot/AFK seats an identity — today the host sends a literal
-- `"<color>-bot"` string as `wallet_address`, which cannot satisfy the FK to
-- `players(wallet_address)`, so hosted bots cannot roll at all. `turn_seq`
-- records the `match_states.seq` the roll was minted at, so a receipt can only
-- be spent by the turn that produced it.
--
-- The partial unique index is the actual teeth: one roll per (match, turn). A
-- second roll attempt for the same turn cannot be inserted at all, so
-- retry-until-a-six is impossible regardless of what the caller sends. Legit
-- retries (a dropped response) are served by re-reading the existing row.

-- Deploy order matters: apply this migration BEFORE deploying the new
-- `roll-dice`, which writes both columns.

begin;

alter table public.match_rolls
  add column if not exists seat_color text,
  add column if not exists turn_seq integer;

-- Seat vocabulary is closed. Kept as a CHECK rather than a FK to a lookup table
-- because it must match lib/constants PlayerColor exactly; a silent divergence
-- here would reject every move.
alter table public.match_rolls
  drop constraint if exists match_rolls_seat_color_check;
alter table public.match_rolls
  add constraint match_rolls_seat_color_check
  check (seat_color is null or seat_color in ('green', 'red', 'yellow', 'blue'));

alter table public.match_rolls
  drop constraint if exists match_rolls_turn_seq_check;
alter table public.match_rolls
  add constraint match_rolls_turn_seq_check
  check (turn_seq is null or turn_seq >= 0);

-- One roll per turn. Partial, so historical rows that predate the binding
-- (seat_color/turn_seq null) cannot collide with each other.
create unique index if not exists match_rolls_match_turn_uniq
  on public.match_rolls (match_id, turn_seq)
  where turn_seq is not null;

comment on column public.match_rolls.seat_color is
  'Seat whose turn this face belongs to. Server-derived from match_states.currentPlayer; never taken from the request body.';
comment on column public.match_rolls.turn_seq is
  'match_states.seq at mint time. A receipt is spendable only by a move whose expectedSeq still equals this, so a roll cannot outlive its turn.';
comment on index public.match_rolls_match_turn_uniq is
  'SEC-01: makes retry-until-a-six impossible — a second roll for the same turn cannot be inserted.';

-- Rows that predate this migration are left unbound on purpose. Backfilling
-- seat_color would mean guessing which seat a historical roll belonged to, and a
-- guess that is wrong lets a roll be spent against the wrong seat. The Edge
-- boundary fails closed on a null seat_color instead, so these receipts are
-- simply unusable — correct for pre-migration development rows.
--

commit;

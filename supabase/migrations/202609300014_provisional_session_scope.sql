-- SEC-17 — a provisional match session is per (authorization_key, wallet_address).
--
-- `move-auth` upserted on `authorization_key` alone, so it was globally unique.
-- Two wallets that reached the same room key silently overwrote each other's
-- grant: the second upsert replaced the first row, and the first wallet's
-- `bind-provisional-session` then failed with "not found" or, worse, bound
-- against the wrong wallet.
--
-- The client now keys provisional grants as `room:<code>:<wallet>`, so the pair
-- is naturally distinct. The unique index makes that a database guarantee
-- rather than a client convention, and the upsert conflict target follows it.
--
-- The column-level `unique` from the baseline is what the upsert conflicted on.
-- It is a CONSTRAINT, not a plain index, so it needs `alter table ... drop
-- constraint` — `drop index` fails with "constraint ... requires it". Replaced
-- rather than left alongside, so there is exactly one uniqueness rule.

begin;

alter table public.provisional_match_sessions
  drop constraint if exists provisional_match_sessions_authorization_key_key;

create unique index provisional_match_sessions_key_wallet_uniq
  on public.provisional_match_sessions (authorization_key, wallet_address);

comment on index public.provisional_match_sessions_key_wallet_uniq is
  'SEC-17: a provisional grant belongs to one wallet. On authorization_key alone two wallets sharing a key overwrote each other.';


commit;

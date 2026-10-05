-- Mark whether a match's canonical host was cryptographically proven at creation.
--
-- WHY (SEC-06): /api/match/record derives the canonical host from
-- `matches.participants[0]` and requires that wallet's signature. But
-- /api/match/start accepted an unauthenticated body and wrote
-- `participants` verbatim, so an anonymous caller chose the canonical host,
-- signed for themselves, and settled — minting unlimited progression and
-- writing arbitrary progression deltas to every address in `participants`
-- (the route updates every participant's row via `.ilike()` on the service
-- role). /api/match/stream has the same circularity: it verifies a host
-- signature, but against the same attacker-chosen `participants[0]`.
--
-- The offline/bot flow genuinely cannot authenticate: page.tsx posts
-- participants as ['anonymous'] with a `local-<ts>` room code because it
-- filters out AI players and may run before any SIWE session exists. So
-- authentication cannot be required unconditionally.
--
-- Instead of forcing auth on the offline path, record whether the host was
-- PROVEN and make settlement refuse unproven matches. Local games keep working
-- and simply never become settleable, which is the correct semantics.
--
-- Backfill: every pre-existing row is unproven. That is the safe direction — it
-- can only ever refuse a settlement, never enable one.

begin;

alter table public.matches
  add column if not exists host_proven boolean not null default false;

comment on column public.matches.host_proven is
  'true when participants[0] proved control of that wallet at match creation. /api/match/record refuses to settle a match where this is false, so an unauthenticated /api/match/start cannot mint progression.';

-- A proven match must name a real wallet as its canonical host. Enforced in the
-- database as well as the route so a service-role write cannot skip the check.
alter table public.matches
  drop constraint if exists matches_proven_host_is_address;
alter table public.matches
  add constraint matches_proven_host_is_address check (
    not host_proven
    or (
      array_length(participants, 1) >= 1
      and participants[1] ~ '^0x[a-fA-F0-9]{40}$'
    )
  );

create index if not exists matches_host_proven_idx
  on public.matches (host_proven)
  where host_proven;

commit;

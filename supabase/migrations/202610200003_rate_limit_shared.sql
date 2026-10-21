-- 202610200003_rate_limit_shared.sql
--
-- SA-5: a shared rate-limit counter.
--
-- `lib/rateLimit.ts` is an in-process `Map`, which means the effective limit is
-- `limit x instances` and an attacker gets a fresh budget per isolate. The file
-- says so itself. `RATE_LIMIT_SHARED_URL` was reserved for a distributed store
-- and never implemented; `src/rateLimit/RateLimitDO.ts` exists and is bound as
-- `RATE_LIMITER` in wrangler.jsonc, but no code calls it.
--
-- This is the smallest shared store the project already has credentials for: one
-- fixed-window counter in Postgres, hit through a SECURITY DEFINER function that
-- only the service role may execute. It is deliberately NOT the DO — wiring the
-- DO requires an async boundary through every `checkRateLimit` call site, which
-- is a larger change than this finding needs.

begin;

create table if not exists public.rate_limit_buckets (
  bucket_key   text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (bucket_key, window_start)
);

comment on table public.rate_limit_buckets is
  'Fixed-window rate-limit counters (SA-5). Service-role only; rows older than the window are swept by the same call that creates the next one.';

alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

create or replace function public.rate_limit_hit(
  p_key       text,
  p_window_ms integer,
  p_limit     integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  win_start timestamptz;
  win_end   timestamptz;
  n         integer;
begin
  if p_window_ms is null or p_window_ms <= 0 then
    raise exception 'p_window_ms must be positive';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit must be positive';
  end if;

  -- Floor "now" onto the fixed window grid.
  win_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) * 1000 / p_window_ms) * p_window_ms / 1000.0
  );
  win_end := win_start + make_interval(secs => p_window_ms / 1000.0);

  insert into public.rate_limit_buckets(bucket_key, window_start, hits)
    values (p_key, win_start, 1)
    on conflict (bucket_key, window_start)
      do update set hits = public.rate_limit_buckets.hits + 1
    returning hits into n;

  -- Opportunistic sweep: this key's expired windows only, so the table cannot
  -- grow without bound and the delete is index-scoped.
  delete from public.rate_limit_buckets
   where bucket_key = p_key and window_start < win_start;

  return jsonb_build_object(
    'ok',      n <= p_limit,
    'hits',    n,
    'limit',   p_limit,
    'remaining', greatest(p_limit - n, 0),
    'resetMs', (extract(epoch from win_end) * 1000)::bigint
  );
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public;
revoke execute on function public.rate_limit_hit(text, integer, integer) from anon;
revoke execute on function public.rate_limit_hit(text, integer, integer) from authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

commit;

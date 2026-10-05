-- DESTRUCTIVE: development/pre-launch reset only.
--
-- This removes all application tables, views, sequences, and routines in the
-- public schema. It does not drop Supabase-managed schemas or extensions.
-- Review the target project and take a backup before executing.
--
-- Fixes applied (see docs/ops/SYSTEM_REVIEW.md DB-11 / DB-12):
--
--  1. Extension-owned objects are excluded from the drop loops. Previously the
--     baseline's own `create extension if not exists pgcrypto;` could install
--     into `public`, and the loop then tried to drop pgcrypto's digest(text,text).
--     Postgres refuses ("cannot drop function ... because extension pgcrypto
--     requires it"). Because the whole script is one DO block — one
--     transaction — that error rolled back every prior drop, so the reset was
--     a silent no-op: 27 tables before, 27 after.
--
--  2. `supabase_realtime` publication members are dropped. Table membership in
--     a publication is not an object dependency, so `drop table ... cascade`
--     does not remove it. Leaving stale members behind means the reset path and
--     the migration path produce different publications.
--
--  3. Individual drops log a warning instead of aborting the run, so one
--     unexpected object cannot silently leave the database half-reset.

do $$
declare
  object_name text;
  dropped_count int := 0;
  failed_count int := 0;
begin
  -- 1) Views (pg_class gives us the oid needed for the extension check).
  for object_name in
    select format('%I.%I', n.nspname, c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('v', 'm')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass
            and d.objid = c.oid
            and d.deptype = 'e'
       )
  loop
    begin
      execute 'drop view if exists ' || object_name || ' cascade';
      dropped_count := dropped_count + 1;
    exception when others then
      failed_count := failed_count + 1;
      raise warning 'reset: could not drop view %: %', object_name, sqlerrm;
    end;
  end loop;

  -- 2) Tables and sequences.
  for object_name in
    select format('%I.%I', n.nspname, c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'S')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass
            and d.objid = c.oid
            and d.deptype = 'e'
       )
  loop
    begin
      execute 'drop table if exists ' || object_name || ' cascade';
      dropped_count := dropped_count + 1;
    exception when others then
      failed_count := failed_count + 1;
      raise warning 'reset: could not drop table %: %', object_name, sqlerrm;
    end;
  end loop;

  -- 3) Routines. Extension-owned functions (e.g. pgcrypto's digest) are the
  --    case that previously aborted the entire script.
  for object_name in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid
            and d.deptype = 'e'
       )
  loop
    begin
      execute 'drop function if exists ' || object_name || ' cascade';
      dropped_count := dropped_count + 1;
    exception when others then
      failed_count := failed_count + 1;
      raise warning 'reset: could not drop function %: %', object_name, sqlerrm;
    end;
  end loop;

  -- 4) Publication members. Not a table dependency, so not covered by cascade.
  for object_name in
    select format('%I.%I', schemaname, tablename)
      from pg_publication_tables
     where pubname = 'supabase_realtime'
  loop
    begin
      execute 'alter publication supabase_realtime drop table ' || object_name;
      dropped_count := dropped_count + 1;
    exception when others then
      failed_count := failed_count + 1;
      raise warning 'reset: could not drop publication member %: %', object_name, sqlerrm;
    end;
  end loop;

  raise notice 'reset: dropped % object(s), % failure(s)', dropped_count, failed_count;
end
$$;

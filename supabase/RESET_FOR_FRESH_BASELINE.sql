-- DESTRUCTIVE: development/pre-launch reset only.
--
-- This removes all application tables, views, sequences, and routines in the
-- public schema. It does not drop Supabase-managed schemas or extensions.
-- Review the target project and take a backup before executing.

do $$
declare
  object_name text;
begin
  for object_name in
    select quote_ident(table_schema) || '.' || quote_ident(table_name)
    from information_schema.views
    where table_schema = 'public'
  loop
    execute 'drop view if exists ' || object_name || ' cascade';
  end loop;

  for object_name in
    select quote_ident(table_schema) || '.' || quote_ident(table_name)
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
  loop
    execute 'drop table if exists ' || object_name || ' cascade';
  end loop;

  for object_name in
    select quote_ident(n.nspname) || '.' || quote_ident(p.proname) ||
           '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute 'drop function if exists ' || object_name || ' cascade';
  end loop;
end
$$;

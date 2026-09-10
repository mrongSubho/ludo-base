# Migrations

**Canonical path:** `supabase/migrations/`

This root `migrations/` folder holds **legacy** SQL from earlier phases
(hybrid matchmaking, social graph, live broadcast, messages flags/RLS).
Do **not** add new files here.

Apply order for a fresh project:

1. `supabase/schema_list.md` phases (or SQL Editor blocks)
2. Everything in `supabase/migrations/` in filename order
3. Legacy files here only if schema_list did not already create the objects

New work: create `supabase/migrations/YYYYMMDD_name.sql` and document it in
`supabase/schema_list.md`.

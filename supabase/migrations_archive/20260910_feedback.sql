-- ─── User feedback inbox (Settings → Feedback) ─────────────────────────────
-- Apply manually via the Supabase SQL Editor (see AGENTS.md). Until applied,
-- the in-app form surfaces an honest send error instead of failing silently.

create table if not exists public.feedback (
    id uuid primary key default gen_random_uuid(),
    topic text not null default 'Other',
    message text not null check (char_length(message) between 1 and 2000),
    address text,
    created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Anyone (wallet or guest) may submit; reads stay service-role only.
drop policy if exists "feedback_insert_any" on public.feedback;
create policy "feedback_insert_any"
    on public.feedback for insert
    to anon, authenticated
    with check (true);

-- LCA permanent database
-- Run this once in Supabase SQL Editor.
create table if not exists public.lca_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- The LCA server uses the Supabase service-role key, so browser users never
-- access this table directly. Keep RLS enabled or disabled; service-role
-- requests bypass RLS. This policy is intentionally not opened to anon.
alter table public.lca_state enable row level security;

-- No public/anon policies are created.
-- IMPORTANT: use SUPABASE_SERVICE_ROLE_KEY only in Render environment variables.

-- Tarter Yard Map — security and shared-data update.
-- Run once in Supabase > SQL Editor, after schema.sql and the other
-- migrations. Safe to re-run.
--
-- 1. yard_users.onboarded_at: the API has read this column since the
--    per-account onboarding change, but no script ever created it, so a
--    fresh install failed every signed-in request.
-- 2. auth_attempts: counters for login / signup / upload throttling
--    (api/_lib/ratelimit.js). Without it the API still works, unthrottled.
-- 3. shared_docs: small shared documents; first user is the secondary
--    product locations list, which used to live in one device's storage.
-- 4. The yard_* functions are only called by the API with the service key.
--    Supabase exposes public functions to the anon role by default; revoke
--    that so nothing but the server can call them.

alter table public.yard_users add column if not exists onboarded_at timestamptz;

create table if not exists public.auth_attempts (
  key text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);
create index if not exists auth_attempts_window_idx on public.auth_attempts(window_start);
alter table public.auth_attempts enable row level security;

create table if not exists public.shared_docs (
  key text primary key,
  rev bigint not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.shared_docs enable row level security;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'yard\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

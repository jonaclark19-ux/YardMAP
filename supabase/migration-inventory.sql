-- Tarter Yard Map — shared inventory report table (TGU FG Report import).
-- Run once in Supabase > SQL Editor for installs that already ran schema.sql
-- before this table existed. Safe to re-run.

create table if not exists public.inventory_state (
  id text primary key default 'yard',
  rev bigint not null default 0,
  data jsonb,
  updated_at timestamptz not null default now()
);
insert into public.inventory_state(id, rev, data) values ('yard',0,null)
on conflict (id) do nothing;
alter table public.inventory_state enable row level security;

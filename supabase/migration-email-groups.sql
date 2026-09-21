-- Tarter Yard Map — named recipient lists for the "send by email" actions.
-- Run once in Supabase > SQL Editor, after schema.sql.
--
-- Before this, every email action asked for a comma-separated list of
-- addresses and remembered only the last one used, per device. That put the
-- burden of remembering who gets a quality report — and of not fat-fingering
-- an address — on whoever happened to be sending it. A group is a named list
-- an editor curates once in the Control Center and everyone picks from.
--
-- The addresses live in a jsonb array rather than a child table: a group is
-- always read and written whole, never queried by member, so a second table
-- would buy nothing but a join.

create table if not exists public.email_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emails jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two groups called "Quality" and "quality" would be indistinguishable in the
-- picker, so names are unique case-insensitively.
create unique index if not exists email_groups_name_idx
  on public.email_groups (lower(name));

create index if not exists email_groups_name_sort_idx
  on public.email_groups (name);

-- Same posture as every other table here: the API talks to PostgREST with the
-- service role and does its own authorization, so no anon policy is granted.
alter table public.email_groups enable row level security;

comment on table public.email_groups is
  'Named recipient lists for report emails. Curated by editors in the Control Center; see api/ops.js route=email-groups.';

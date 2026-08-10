-- Tarter Yard Map — Supabase schema
-- Run this once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.yard_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  access_code_hash text not null,
  role text not null default 'viewer' check (role in ('viewer','editor')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.map_state (
  id text primary key default 'yard',
  rev bigint not null default 0,
  data jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.map_state(id, rev, data) values ('yard',0,null)
on conflict (id) do nothing;

create table if not exists public.map_history (
  id bigint generated always as identity primary key,
  rev bigint not null,
  data jsonb not null,
  updated_by text,
  action text not null default 'save',
  updated_at timestamptz not null default now()
);
create index if not exists map_history_rev_idx on public.map_history(rev desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  sku text,
  raw_code text,
  note text,
  status text not null default 'new' check (status in ('new','acknowledged','in_progress','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  assigned_to text,
  by_name text not null,
  by_role text,
  found_at jsonb,
  home_at jsonb,
  home_group text,
  photo_url text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  in_progress_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  updated_at timestamptz not null default now()
);
create index if not exists alerts_status_created_idx on public.alerts(status, created_at desc);
create index if not exists alerts_sku_created_idx on public.alerts(sku, created_at desc);

create table if not exists public.app_meta (
  id text primary key default 'yard',
  alerts_rev bigint not null default 0,
  announcements_rev bigint not null default 0,
  verifications_rev bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_meta(id) values ('yard') on conflict (id) do nothing;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  severity text not null default 'info' check (severity in ('info','warning','urgent')),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sku_verifications (
  sku text primary key,
  verified_at timestamptz not null default now(),
  verified_by text not null,
  location jsonb,
  group_name text
);
create index if not exists sku_verifications_time_idx on public.sku_verifications(verified_at desc);

create table if not exists public.edit_lock (
  id text primary key default 'yard',
  holder_name text,
  session_id text,
  acquired_at timestamptz,
  heartbeat_at timestamptz,
  expires_at timestamptz
);
insert into public.edit_lock(id) values ('yard') on conflict (id) do nothing;

create table if not exists public.zone_status (
  zone_key text primary key,
  status text not null default 'active' check (status in ('active','restricted','temporary','maintenance')),
  note text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_handoffs (
  id uuid primary key default gen_random_uuid(),
  shift_label text not null,
  summary text not null,
  open_alerts_count integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- The browser never receives the server secret key. These tables are accessed
-- only through Vercel Functions, so enable RLS and leave anon/authenticated
-- without direct policies.
alter table public.yard_users enable row level security;
alter table public.map_state enable row level security;
alter table public.map_history enable row level security;
alter table public.alerts enable row level security;
alter table public.app_meta enable row level security;
alter table public.audit_log enable row level security;
alter table public.announcements enable row level security;
alter table public.sku_verifications enable row level security;
alter table public.edit_lock enable row level security;
alter table public.zone_status enable row level security;
alter table public.shift_handoffs enable row level security;

-- Public bucket is used only for randomized alert-photo URLs. Uploads still go
-- through the authenticated Vercel endpoint with the server secret.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('yard-alerts','yard-alerts',true,5000000,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=5000000,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create or replace function public.yard_save_map(
  p_expected_rev bigint,
  p_data jsonb,
  p_actor text
) returns table(ok boolean, rev bigint, data jsonb, updated_by text)
language plpgsql
as $$
declare
  v public.map_state%rowtype;
  v_new_rev bigint;
begin
  select * into v from public.map_state where id='yard' for update;
  if not found then
    insert into public.map_state(id, rev, data, updated_by) values ('yard',0,null,p_actor)
    returning * into v;
  end if;

  if v.rev <> p_expected_rev then
    return query select false, v.rev, v.data, v.updated_by;
    return;
  end if;

  v_new_rev := v.rev + 1;
  update public.map_state
    set rev=v_new_rev, data=p_data, updated_by=p_actor, updated_at=now()
    where id='yard';
  insert into public.map_history(rev,data,updated_by,action)
    values(v_new_rev,p_data,p_actor,'save');
  return query select true, v_new_rev, p_data, p_actor;
end;
$$;

create or replace function public.yard_restore_map(
  p_history_id bigint,
  p_actor text
) returns table(ok boolean, rev bigint, data jsonb)
language plpgsql
as $$
declare
  v_hist public.map_history%rowtype;
  v_state public.map_state%rowtype;
  v_new_rev bigint;
begin
  select * into v_hist from public.map_history where id=p_history_id;
  if not found then
    return query select false, 0::bigint, null::jsonb;
    return;
  end if;
  select * into v_state from public.map_state where id='yard' for update;
  v_new_rev := coalesce(v_state.rev,0)+1;
  update public.map_state set rev=v_new_rev, data=v_hist.data, updated_by=p_actor, updated_at=now() where id='yard';
  insert into public.map_history(rev,data,updated_by,action) values(v_new_rev,v_hist.data,p_actor,'restore');
  return query select true, v_new_rev, v_hist.data;
end;
$$;

create or replace function public.yard_bump_alerts_rev()
returns table(alerts_rev bigint)
language sql
as $$
  update public.app_meta set alerts_rev=alerts_rev+1, updated_at=now() where id='yard'
  returning app_meta.alerts_rev;
$$;

create or replace function public.yard_bump_announcements_rev()
returns table(announcements_rev bigint)
language sql
as $$
  update public.app_meta set announcements_rev=announcements_rev+1, updated_at=now() where id='yard'
  returning app_meta.announcements_rev;
$$;

create or replace function public.yard_bump_verifications_rev()
returns table(verifications_rev bigint)
language sql
as $$
  update public.app_meta set verifications_rev=verifications_rev+1, updated_at=now() where id='yard'
  returning app_meta.verifications_rev;
$$;

create or replace function public.yard_alert_recurrence(p_days integer default 30)
returns table(sku text, report_count bigint, last_report_at timestamptz)
language sql
as $$
  select a.sku, count(*)::bigint, max(a.created_at)
  from public.alerts a
  where a.created_at >= now() - make_interval(days => greatest(1, least(p_days,365)))
    and a.sku is not null and length(a.sku) > 0
  group by a.sku
  order by count(*) desc, max(a.created_at) desc;
$$;

create or replace function public.yard_acquire_lock(p_holder text, p_session_id text)
returns table(ok boolean, lock_data jsonb)
language plpgsql
as $$
declare
  v public.edit_lock%rowtype;
begin
  select * into v from public.edit_lock where id='yard' for update;
  if not found then
    insert into public.edit_lock(id) values('yard') returning * into v;
  end if;
  if v.expires_at is null or v.expires_at <= now() or v.session_id = p_session_id then
    update public.edit_lock
      set holder_name=p_holder, session_id=p_session_id,
          acquired_at=case when v.session_id=p_session_id then coalesce(v.acquired_at,now()) else now() end,
          heartbeat_at=now(), expires_at=now()+interval '90 seconds'
      where id='yard'
      returning * into v;
    return query select true, to_jsonb(v);
  end if;
  return query select false, to_jsonb(v);
end;
$$;

create or replace function public.yard_release_lock(p_session_id text)
returns void
language plpgsql
as $$
begin
  update public.edit_lock
  set holder_name=null, session_id=null, acquired_at=null, heartbeat_at=null, expires_at=null
  where id='yard' and session_id=p_session_id;
end;
$$;

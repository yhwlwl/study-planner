create table if not exists public.study_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.study_snapshots enable row level security;

drop policy if exists "Users can read their own study snapshot" on public.study_snapshots;
create policy "Users can read their own study snapshot"
on public.study_snapshots for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own study snapshot" on public.study_snapshots;
create policy "Users can insert their own study snapshot"
on public.study_snapshots for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own study snapshot" on public.study_snapshots;
create policy "Users can update their own study snapshot"
on public.study_snapshots for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 服务端访问日志。浏览器不能直接读写；只有 Vercel Function 使用 service role 写入。
create table if not exists public.visit_logs (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  session_id uuid not null,
  visitor_id uuid,
  event_type text not null default 'page_view',
  occurred_at timestamptz not null default now(),
  client_time timestamptz,
  user_id uuid references auth.users(id) on delete set null,
  ip_address inet,
  country_code text,
  region_code text,
  city text,
  ip_timezone text,
  edge_region text,
  pathname text,
  app_page text,
  referrer_origin text,
  utm_source text,
  utm_campaign text,
  first_referrer text,
  user_agent text,
  browser_language text,
  client_timezone text,
  screen_width integer,
  screen_height integer,
  viewport_width integer,
  viewport_height integer,
  account_mode text not null default 'guest' check (account_mode in ('guest', 'account')),
  is_pwa boolean not null default false,
  app_version text,
  metadata jsonb not null default '{}'::jsonb
);

-- 已上线的 visit_logs 表不会因 create table if not exists 自动获得新列；这里显式做幂等迁移。
alter table public.visit_logs add column if not exists visitor_id uuid;
alter table public.visit_logs add column if not exists app_page text;
alter table public.visit_logs add column if not exists utm_source text;
alter table public.visit_logs add column if not exists utm_campaign text;
alter table public.visit_logs add column if not exists first_referrer text;

alter table public.visit_logs enable row level security;

-- 不创建 anon/authenticated 策略，前端无法查询或伪造写入。
revoke all on table public.visit_logs from anon, authenticated;
grant select, insert, update, delete on table public.visit_logs to service_role;
grant usage, select on sequence public.visit_logs_id_seq to service_role;

create index if not exists visit_logs_occurred_at_idx on public.visit_logs (occurred_at desc);
create index if not exists visit_logs_user_id_idx on public.visit_logs (user_id, occurred_at desc);
create index if not exists visit_logs_ip_address_idx on public.visit_logs (ip_address, occurred_at desc);
create index if not exists visit_logs_visitor_id_idx on public.visit_logs (visitor_id, occurred_at desc);
create index if not exists visit_logs_event_type_idx on public.visit_logs (event_type, occurred_at desc);
create index if not exists visit_logs_attribution_idx on public.visit_logs (utm_source, utm_campaign, occurred_at desc);

comment on table public.visit_logs is 'Server-written access logs. IP-derived location is approximate and may be affected by VPN/proxy.';

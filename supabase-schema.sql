create table if not exists public.study_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1,
  client_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.study_snapshots add column if not exists revision bigint not null default 1;

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

-- 用户意见反馈。浏览器只能提交四个输入列；环境、使用深度与内部状态均由数据库生成或维护。
create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  feedback_type text not null check (feedback_type in ('bug', 'suggestion', 'other')),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  app_version text,
  page_path text,
  user_agent text,
  status text not null default 'new',
  visitor_id uuid,
  account_mode text,
  utm_source text,
  utm_campaign text,
  first_referrer text,
  browser_language text,
  client_timezone text,
  is_pwa boolean,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  tenure_days integer not null default 0,
  total_sessions integer not null default 0,
  total_events integer not null default 0,
  total_active_days integer not null default 0,
  sessions_30d integer not null default 0,
  events_30d integer not null default 0,
  active_days_30d integer not null default 0,
  unique_pages_30d integer not null default 0,
  assignment_count integer not null default 0,
  completed_assignment_count integer not null default 0,
  task_group_count integer not null default 0,
  goal_count integer not null default 0,
  intake_batch_count integer not null default 0,
  replan_count integer not null default 0,
  depth_score integer not null default 0,
  depth_level text not null default 'new',
  depth_calculated_at timestamptz
);

alter table public.feedback_submissions
  add column if not exists app_version text,
  add column if not exists page_path text,
  add column if not exists user_agent text,
  add column if not exists status text not null default 'new',
  add column if not exists visitor_id uuid,
  add column if not exists account_mode text,
  add column if not exists utm_source text,
  add column if not exists utm_campaign text,
  add column if not exists first_referrer text,
  add column if not exists browser_language text,
  add column if not exists client_timezone text,
  add column if not exists is_pwa boolean,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists tenure_days integer not null default 0,
  add column if not exists total_sessions integer not null default 0,
  add column if not exists total_events integer not null default 0,
  add column if not exists total_active_days integer not null default 0,
  add column if not exists sessions_30d integer not null default 0,
  add column if not exists events_30d integer not null default 0,
  add column if not exists active_days_30d integer not null default 0,
  add column if not exists unique_pages_30d integer not null default 0,
  add column if not exists assignment_count integer not null default 0,
  add column if not exists completed_assignment_count integer not null default 0,
  add column if not exists task_group_count integer not null default 0,
  add column if not exists goal_count integer not null default 0,
  add column if not exists intake_batch_count integer not null default 0,
  add column if not exists replan_count integer not null default 0,
  add column if not exists depth_score integer not null default 0,
  add column if not exists depth_level text not null default 'new',
  add column if not exists depth_calculated_at timestamptz;

alter table public.feedback_submissions
  drop constraint if exists feedback_submissions_feedback_type_check,
  add constraint feedback_submissions_feedback_type_check
    check (feedback_type in ('bug', 'suggestion', 'other')),
  drop constraint if exists feedback_submissions_status_check,
  add constraint feedback_submissions_status_check
    check (status in ('new', 'reviewing', 'planned', 'resolved', 'closed')),
  drop constraint if exists feedback_submissions_account_mode_check,
  add constraint feedback_submissions_account_mode_check
    check (account_mode is null or account_mode in ('guest', 'account')),
  drop constraint if exists feedback_submissions_depth_level_check,
  add constraint feedback_submissions_depth_level_check
    check (depth_level in ('new', 'casual', 'returning', 'engaged', 'power')),
  drop constraint if exists feedback_submissions_depth_score_check,
  add constraint feedback_submissions_depth_score_check
    check (depth_score between 0 and 100),
  drop constraint if exists feedback_submissions_nonnegative_depth_metrics_check,
  add constraint feedback_submissions_nonnegative_depth_metrics_check
    check (
      tenure_days >= 0 and total_sessions >= 0 and total_events >= 0 and total_active_days >= 0
      and sessions_30d >= 0 and events_30d >= 0 and active_days_30d >= 0 and unique_pages_30d >= 0
      and assignment_count >= 0 and completed_assignment_count >= 0 and task_group_count >= 0
      and goal_count >= 0 and intake_batch_count >= 0 and replan_count >= 0
    );

alter table public.feedback_submissions enable row level security;

create or replace function public.enrich_feedback_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_score integer := 0;
  v_latest public.visit_logs%rowtype;
  v_snapshot jsonb;
begin
  new.created_at := coalesce(new.created_at, now());
  new.status := 'new';

  select
    min(v.occurred_at),
    max(v.occurred_at),
    count(*)::integer,
    count(distinct v.session_id)::integer,
    count(distinct (v.occurred_at at time zone 'UTC')::date)::integer,
    count(*) filter (where v.occurred_at >= new.created_at - interval '30 days')::integer,
    count(distinct v.session_id) filter (where v.occurred_at >= new.created_at - interval '30 days')::integer,
    count(distinct (v.occurred_at at time zone 'UTC')::date) filter (where v.occurred_at >= new.created_at - interval '30 days')::integer,
    count(distinct coalesce(v.app_page, v.pathname)) filter (where v.occurred_at >= new.created_at - interval '30 days')::integer
  into
    new.first_seen_at,
    new.last_seen_at,
    new.total_events,
    new.total_sessions,
    new.total_active_days,
    new.events_30d,
    new.sessions_30d,
    new.active_days_30d,
    new.unique_pages_30d
  from public.visit_logs v
  where v.occurred_at <= new.created_at
    and (
      (new.user_id is not null and v.user_id = new.user_id)
      or (new.visitor_id is not null and v.visitor_id = new.visitor_id)
    );

  new.tenure_days := case
    when new.first_seen_at is null then 0
    else greatest(0, (new.created_at at time zone 'UTC')::date - (new.first_seen_at at time zone 'UTC')::date)
  end;

  select v.* into v_latest
  from public.visit_logs v
  where v.occurred_at <= new.created_at
    and (
      (new.user_id is not null and v.user_id = new.user_id)
      or (new.visitor_id is not null and v.visitor_id = new.visitor_id)
    )
  order by v.occurred_at desc
  limit 1;

  if found then
    new.account_mode := case when new.user_id is not null then 'account' else coalesce(v_latest.account_mode, 'guest') end;
    new.app_version := v_latest.app_version;
    new.page_path := coalesce(v_latest.app_page, v_latest.pathname);
    new.user_agent := v_latest.user_agent;
    new.utm_source := v_latest.utm_source;
    new.utm_campaign := v_latest.utm_campaign;
    new.first_referrer := v_latest.first_referrer;
    new.browser_language := v_latest.browser_language;
    new.client_timezone := v_latest.client_timezone;
    new.is_pwa := v_latest.is_pwa;
  else
    new.account_mode := case when new.user_id is not null then 'account' else 'guest' end;
  end if;

  if new.user_id is not null then
    select s.data into v_snapshot
    from public.study_snapshots s
    where s.user_id = new.user_id;

    if v_snapshot is not null then
      new.assignment_count := jsonb_array_length(coalesce(v_snapshot->'assignments', '[]'::jsonb));
      select count(*)::integer into new.completed_assignment_count
      from jsonb_array_elements(coalesce(v_snapshot->'assignments', '[]'::jsonb)) a
      where a->>'status' = 'done';
      new.task_group_count := jsonb_array_length(coalesce(v_snapshot->'taskGroups', '[]'::jsonb));
      new.goal_count := jsonb_array_length(coalesce(v_snapshot->'goals', '[]'::jsonb));
      new.intake_batch_count := jsonb_array_length(coalesce(v_snapshot->'intakeBatches', '[]'::jsonb));
      new.replan_count := jsonb_array_length(coalesce(v_snapshot->'replanHistory', '[]'::jsonb));
    end if;
  end if;

  v_score := least(20, new.tenure_days * 2)
    + least(25, new.active_days_30d * 3)
    + least(15, new.total_sessions)
    + least(10, new.events_30d / 5)
    + least(10, new.assignment_count / 3)
    + least(10, new.completed_assignment_count)
    + least(5, new.goal_count * 2)
    + least(5, new.replan_count * 2);

  new.depth_score := least(100, greatest(0, v_score));
  new.depth_level := case
    when new.active_days_30d >= 8 and new.tenure_days >= 7 and new.total_sessions >= 15 and new.depth_score >= 70 then 'power'
    when new.active_days_30d >= 4 and new.tenure_days >= 3 and new.total_sessions >= 8 and new.depth_score >= 50 then 'engaged'
    when new.total_active_days >= 2 or new.tenure_days >= 2 then 'returning'
    when new.total_events >= 3 or new.total_sessions >= 2 or new.assignment_count > 0 then 'casual'
    else 'new'
  end;
  new.depth_calculated_at := now();

  return new;
end;
$$;

revoke all on function public.enrich_feedback_submission() from public, anon, authenticated;

drop trigger if exists feedback_submissions_enrich_before_insert on public.feedback_submissions;
create trigger feedback_submissions_enrich_before_insert
before insert on public.feedback_submissions
for each row execute function public.enrich_feedback_submission();

revoke all on table public.feedback_submissions from anon, authenticated;
grant insert (feedback_type, content, user_id, visitor_id) on public.feedback_submissions to anon, authenticated;
grant select, insert, update, delete on table public.feedback_submissions to service_role;

drop policy if exists "Guests can submit feedback" on public.feedback_submissions;
create policy "Guests can submit feedback"
on public.feedback_submissions for insert to anon
with check (user_id is null);

drop policy if exists "Authenticated users can submit feedback" on public.feedback_submissions;
create policy "Authenticated users can submit feedback"
on public.feedback_submissions for insert to authenticated
with check ((select auth.uid()) = user_id);

create index if not exists feedback_submissions_created_at_idx on public.feedback_submissions (created_at desc);
create index if not exists feedback_submissions_type_created_at_idx on public.feedback_submissions (feedback_type, created_at desc);
create index if not exists feedback_submissions_depth_created_at_idx on public.feedback_submissions (depth_level, created_at desc);
create index if not exists feedback_submissions_status_created_at_idx on public.feedback_submissions (status, created_at desc);

comment on table public.feedback_submissions is 'User-submitted bug reports, product suggestions, and other feedback. Frontend roles may insert only; feedback is not readable from the client.';
comment on column public.feedback_submissions.visitor_id is 'Stable anonymous browser visitor identifier used to connect guest and pre-login visit history.';
comment on column public.feedback_submissions.depth_score is 'Explainable 0-100 usage-depth score captured at feedback submission time. Derived server-side from visit history and cloud snapshot metrics.';
comment on column public.feedback_submissions.depth_level is 'Usage-depth segment at submission time: new, casual, returning, engaged, or power. Power/engaged require multi-day usage to avoid one-session burst misclassification.';

-- 城市级地理位置解析的服务端缓存（尽力而为，由 Vercel Function 使用 service_role 读写）。
-- /api/visit-log 与 /api/metric-event 通过 RPC 复用同一份解析结果，避免重复调用第三方解析器。
create table if not exists public.ip_geo_cache (
  ip inet primary key,
  country_code text,
  region_code text,
  city text,
  timezone text,
  provider text,
  resolved_at timestamptz not null default now(),
  expires_at timestamptz
);

-- 与其他服务端专表一致开启 RLS；表仅授权 service_role（service_role 绕过 RLS），
-- anon/authenticated 无任何授权且无策略，客户端无法读写。
alter table public.ip_geo_cache enable row level security;

revoke all on table public.ip_geo_cache from anon, authenticated;
grant select, insert, update, delete on table public.ip_geo_cache to service_role;

create or replace function public.ip_geo_cache_get(p_ip text)
returns table (city text, country_code text, region_code text, timezone text, resolved_at timestamptz)
language sql
security invoker
as $$
  select c.city, c.country_code, c.region_code, c.timezone, c.resolved_at
  from public.ip_geo_cache c
  where c.ip = p_ip::inet
    and (c.expires_at is null or c.expires_at > now())
  limit 1;
$$;

create or replace function public.ip_geo_cache_put(
  p_ip text,
  p_country_code text default null,
  p_region_code text default null,
  p_city text default null,
  p_timezone text default null,
  p_provider text default null,
  p_ttl_days integer default 30
)
returns void
language sql
security invoker
as $$
  insert into public.ip_geo_cache (ip, country_code, region_code, city, timezone, provider, resolved_at, expires_at)
  values (p_ip::inet, p_country_code, p_region_code, p_city, p_timezone, p_provider, now(), now() + make_interval(days => p_ttl_days))
  on conflict (ip) do update set
    country_code = excluded.country_code,
    region_code = excluded.region_code,
    city = excluded.city,
    timezone = excluded.timezone,
    provider = excluded.provider,
    resolved_at = excluded.resolved_at,
    expires_at = excluded.expires_at;
$$;

revoke all on function public.ip_geo_cache_get(text) from anon, authenticated;
revoke all on function public.ip_geo_cache_put(text, text, text, text, text, text, integer) from anon, authenticated;
grant execute on function public.ip_geo_cache_get(text), public.ip_geo_cache_put(text, text, text, text, text, text, integer) to service_role;

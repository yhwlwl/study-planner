create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  feedback_type text not null check (feedback_type in ('bug', 'suggestion', 'other')),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  app_version text,
  page_path text,
  user_agent text
);

comment on table public.feedback_submissions is
  'User-submitted bug reports, product suggestions, and other feedback. Frontend roles may insert only; feedback is not readable from the client.';

alter table public.feedback_submissions enable row level security;

alter table public.feedback_submissions
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

comment on column public.feedback_submissions.visitor_id is
  'Stable anonymous browser visitor identifier used to connect guest and pre-login visit history.';
comment on column public.feedback_submissions.depth_score is
  'Explainable 0-100 usage-depth score captured at feedback submission time. Derived server-side from visit history and cloud snapshot metrics.';
comment on column public.feedback_submissions.depth_level is
  'Usage-depth segment at submission time: new, casual, returning, engaged, or power. Power/engaged require multi-day usage to avoid one-session burst misclassification.';

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

drop policy if exists "Guests can submit feedback" on public.feedback_submissions;
create policy "Guests can submit feedback"
on public.feedback_submissions for insert to anon
with check (user_id is null);

drop policy if exists "Authenticated users can submit feedback" on public.feedback_submissions;
create policy "Authenticated users can submit feedback"
on public.feedback_submissions for insert to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table public.feedback_submissions from anon, authenticated;
grant insert (feedback_type, content, user_id, visitor_id) on public.feedback_submissions to anon, authenticated;

-- 反馈详情继续使用 feedback_submissions 现有 RLS，不保留额外 SECURITY DEFINER 读取接口。
-- 登录用户只能读取 RLS 允许的自己的记录；feedback_admin 可读取全部。
-- guest_access_hash 永远不授予客户端 SELECT 权限。

drop function if exists public.list_feedback_admin_details();

revoke select on table public.feedback_submissions from authenticated;
grant select (
  id, feedback_type, content, user_id, created_at,
  app_version, page_path, user_agent, status, visitor_id, account_mode,
  utm_source, utm_campaign, first_referrer, browser_language, client_timezone, is_pwa,
  first_seen_at, last_seen_at, tenure_days,
  total_sessions, total_events, total_active_days,
  sessions_30d, events_30d, active_days_30d, unique_pages_30d,
  assignment_count, completed_assignment_count, task_group_count, goal_count, intake_batch_count, replan_count,
  depth_score, depth_level, depth_calculated_at
) on table public.feedback_submissions to authenticated;

comment on table public.feedback_submissions is 'User-submitted feedback with server-derived context/depth snapshot. Authenticated users can read only rows allowed by RLS; guest_access_hash is never granted to clients.';

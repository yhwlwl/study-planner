create index if not exists feedback_submissions_created_at_idx
  on public.feedback_submissions (created_at desc);
create index if not exists feedback_submissions_type_created_at_idx
  on public.feedback_submissions (feedback_type, created_at desc);
create index if not exists feedback_submissions_depth_created_at_idx
  on public.feedback_submissions (depth_level, created_at desc);
create index if not exists feedback_submissions_status_created_at_idx
  on public.feedback_submissions (status, created_at desc);

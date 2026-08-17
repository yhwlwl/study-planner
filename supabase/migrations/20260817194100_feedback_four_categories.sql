-- 将意见反馈扩展为四类：Bug、新功能、体验优化、其他。
alter table public.feedback_submissions
  drop constraint if exists feedback_submissions_feedback_type_check;

alter table public.feedback_submissions
  add constraint feedback_submissions_feedback_type_check
  check (feedback_type in ('bug', 'suggestion', 'experience', 'other'));

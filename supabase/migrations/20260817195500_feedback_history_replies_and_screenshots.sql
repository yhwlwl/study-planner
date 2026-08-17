-- 意见反馈历史、开发者回复与私有截图。
-- 管理员授权使用 auth.app_metadata.feedback_admin；普通用户无法自行修改 app_metadata。

revoke select, update on table public.feedback_submissions from authenticated;
grant select (id, user_id, feedback_type, content, status, created_at) on table public.feedback_submissions to authenticated;
grant update (status) on table public.feedback_submissions to authenticated;

drop policy if exists "Users can view own feedback" on public.feedback_submissions;
create policy "Users can view own feedback"
on public.feedback_submissions
for select
to authenticated
using (
  user_id = (select auth.uid())
  or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
);

drop policy if exists "Feedback admins can update status" on public.feedback_submissions;
create policy "Feedback admins can update status"
on public.feedback_submissions
for update
to authenticated
using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false))
with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false));

create table if not exists public.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_submissions(id) on delete cascade,
  admin_user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  content text not null,
  created_at timestamptz not null default now(),
  constraint feedback_replies_content_check check (char_length(btrim(content)) between 1 and 4000)
);

alter table public.feedback_replies enable row level security;
revoke all on table public.feedback_replies from anon, authenticated;
grant select (id, feedback_id, content, created_at) on table public.feedback_replies to authenticated;
grant insert (feedback_id, content) on table public.feedback_replies to authenticated;

create index if not exists feedback_replies_feedback_created_at_idx
  on public.feedback_replies (feedback_id, created_at asc);

drop policy if exists "Users can view replies to visible feedback" on public.feedback_replies;
create policy "Users can view replies to visible feedback"
on public.feedback_replies
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_submissions feedback
    where feedback.id = feedback_replies.feedback_id
      and (
        feedback.user_id = (select auth.uid())
        or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
      )
  )
);

drop policy if exists "Feedback admins can reply" on public.feedback_replies;
create policy "Feedback admins can reply"
on public.feedback_replies
for insert
to authenticated
with check (
  admin_user_id = (select auth.uid())
  and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
);

create table if not exists public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback_submissions(id) on delete cascade,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint feedback_attachments_path_check check (char_length(storage_path) between 3 and 700),
  constraint feedback_attachments_name_check check (char_length(file_name) between 1 and 255),
  constraint feedback_attachments_mime_check check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint feedback_attachments_size_check check (size_bytes between 1 and 5242880)
);

alter table public.feedback_attachments enable row level security;
revoke all on table public.feedback_attachments from anon, authenticated;
grant select (id, feedback_id, storage_path, file_name, mime_type, size_bytes, created_at) on table public.feedback_attachments to authenticated;
grant insert (feedback_id, storage_path, file_name, mime_type, size_bytes) on table public.feedback_attachments to authenticated;

create index if not exists feedback_attachments_feedback_created_at_idx
  on public.feedback_attachments (feedback_id, created_at asc);

drop policy if exists "Users can view attachments to visible feedback" on public.feedback_attachments;
create policy "Users can view attachments to visible feedback"
on public.feedback_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_submissions feedback
    where feedback.id = feedback_attachments.feedback_id
      and (
        feedback.user_id = (select auth.uid())
        or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
      )
  )
);

drop policy if exists "Users can attach screenshots to own feedback" on public.feedback_attachments;
create policy "Users can attach screenshots to own feedback"
on public.feedback_attachments
for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (
    select 1
    from public.feedback_submissions feedback
    where feedback.id = feedback_attachments.feedback_id
      and feedback.user_id = (select auth.uid())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can upload feedback screenshots" on storage.objects;
create policy "Authenticated users can upload feedback screenshots"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'feedback-screenshots'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Feedback screenshot owners and admins can view" on storage.objects;
create policy "Feedback screenshot owners and admins can view"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'feedback-screenshots'
  and (
    owner_id = (select auth.uid())::text
    or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
  )
);

comment on table public.feedback_replies is 'Developer/admin replies to user feedback. Users can read replies only for feedback they own.';
comment on table public.feedback_attachments is 'Private screenshot metadata for feedback submissions. File bytes live in the private feedback-screenshots Storage bucket.';

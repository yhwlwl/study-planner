-- 意见反馈升级为双向会话：开发者可带图回复，用户/游客可继续追问，并记录收件人已读状态。
-- 迁移保持向后兼容：旧版客户端仍可继续读取/发送管理员文字回复。

alter table public.feedback_replies
  rename column admin_user_id to author_user_id;

alter table public.feedback_replies
  alter column author_user_id drop not null;

alter table public.feedback_replies
  add column if not exists author_type text not null default 'admin',
  add column if not exists read_at timestamptz;

alter table public.feedback_replies
  drop constraint if exists feedback_replies_author_type_check;

alter table public.feedback_replies
  add constraint feedback_replies_author_type_check
  check (author_type in ('admin', 'user', 'guest'));

comment on column public.feedback_replies.author_type is
  'Reply sender: admin = developer/admin, user = authenticated feedback owner, guest = browser-secret authenticated guest.';
comment on column public.feedback_replies.read_at is
  'Timestamp when the reply recipient first viewed the reply. Admin replies are read by the feedback owner; user/guest replies are read by feedback admins.';

revoke insert, update on table public.feedback_replies from authenticated;
grant select (id, feedback_id, content, created_at, author_type, read_at) on table public.feedback_replies to authenticated;
grant insert (feedback_id, content, author_type) on table public.feedback_replies to authenticated;
grant update (read_at) on table public.feedback_replies to authenticated;

drop policy if exists "Feedback admins can reply" on public.feedback_replies;
drop policy if exists "Feedback participants can reply" on public.feedback_replies;
create policy "Feedback participants can reply"
on public.feedback_replies
for insert
to authenticated
with check (
  author_user_id = (select auth.uid())
  and (
    (
      author_type = 'admin'
      and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
    )
    or
    (
      author_type = 'user'
      and exists (
        select 1
        from public.feedback_submissions feedback
        where feedback.id = feedback_replies.feedback_id
          and feedback.user_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "Feedback recipients can mark replies read" on public.feedback_replies;
create policy "Feedback recipients can mark replies read"
on public.feedback_replies
for update
to authenticated
using (
  (
    feedback_replies.author_type = 'admin'
    and exists (
      select 1
      from public.feedback_submissions feedback
      where feedback.id = feedback_replies.feedback_id
        and feedback.user_id = (select auth.uid())
    )
  )
  or
  (
    feedback_replies.author_type in ('user', 'guest')
    and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
  )
)
with check (
  (
    feedback_replies.author_type = 'admin'
    and exists (
      select 1
      from public.feedback_submissions feedback
      where feedback.id = feedback_replies.feedback_id
        and feedback.user_id = (select auth.uid())
    )
  )
  or
  (
    feedback_replies.author_type in ('user', 'guest')
    and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
  )
);

-- 已解决/已关闭的反馈若账号用户继续追问，允许客户端只把状态重新打开为“处理中”。
drop policy if exists "Users can reopen own feedback" on public.feedback_submissions;
create policy "Users can reopen own feedback"
on public.feedback_submissions
for update
to authenticated
using (
  user_id = (select auth.uid())
  and status in ('resolved', 'closed')
)
with check (
  user_id = (select auth.uid())
  and status = 'reviewing'
);

alter table public.feedback_attachments
  add column if not exists reply_id uuid references public.feedback_replies(id) on delete cascade;

grant select (id, feedback_id, reply_id, storage_path, file_name, mime_type, size_bytes, created_at)
  on table public.feedback_attachments to authenticated;
grant insert (feedback_id, reply_id, storage_path, file_name, mime_type, size_bytes)
  on table public.feedback_attachments to authenticated;

create index if not exists feedback_attachments_reply_created_at_idx
  on public.feedback_attachments (reply_id, created_at asc)
  where reply_id is not null;

drop policy if exists "Users can attach screenshots to own feedback" on public.feedback_attachments;
drop policy if exists "Feedback participants can attach screenshots" on public.feedback_attachments;
create policy "Feedback participants can attach screenshots"
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
      and (
        feedback.user_id = (select auth.uid())
        or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
      )
  )
  and (
    feedback_attachments.reply_id is null
    or exists (
      select 1
      from public.feedback_replies reply
      join public.feedback_submissions feedback on feedback.id = reply.feedback_id
      where reply.id = feedback_attachments.reply_id
        and reply.feedback_id = feedback_attachments.feedback_id
        and (
          (
            reply.author_type = 'user'
            and feedback.user_id = (select auth.uid())
          )
          or
          (
            reply.author_type = 'admin'
            and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
          )
        )
    )
  )
);

-- 开发者上传的私有图片也允许对应的登录反馈所有者读取并生成短期签名链接。
drop policy if exists "Feedback screenshot owners and admins can view" on storage.objects;
create policy "Feedback screenshot participants can view"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'feedback-screenshots'
  and (
    owner_id = (select auth.uid())::text
    or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'feedback_admin')::boolean, false)
    or exists (
      select 1
      from public.feedback_attachments attachment
      join public.feedback_submissions feedback on feedback.id = attachment.feedback_id
      where attachment.storage_path = storage.objects.name
        and feedback.user_id = (select auth.uid())
    )
  )
);

-- 游客继续追问：仍使用 visitor_id + 每浏览器随机密钥，不开放 anon 表级 INSERT。
create or replace function public.reply_to_guest_feedback(
  p_feedback_id uuid,
  p_visitor_id uuid,
  p_guest_secret text,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_content text := btrim(coalesce(p_content, ''));
  v_reply_id uuid;
begin
  if p_feedback_id is null or p_visitor_id is null then
    raise exception 'invalid feedback identity' using errcode = '22023';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    raise exception 'invalid reply content' using errcode = '22023';
  end if;
  if p_guest_secret is null or char_length(p_guest_secret) < 32 or char_length(p_guest_secret) > 512 then
    raise exception 'invalid guest secret' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(p_guest_secret, 'UTF8'), 'sha256'), 'hex');

  if not exists (
    select 1
    from public.feedback_submissions feedback
    where feedback.id = p_feedback_id
      and feedback.user_id is null
      and feedback.visitor_id = p_visitor_id
      and feedback.guest_access_hash = v_hash
  ) then
    raise exception 'feedback not found' using errcode = 'P0002';
  end if;

  insert into public.feedback_replies (feedback_id, author_user_id, author_type, content)
  values (p_feedback_id, null, 'guest', v_content)
  returning id into v_reply_id;

  update public.feedback_submissions
     set status = 'reviewing'
   where id = p_feedback_id
     and status in ('resolved', 'closed');

  return v_reply_id;
end;
$$;

revoke all on function public.reply_to_guest_feedback(uuid, uuid, text, text) from public;
grant execute on function public.reply_to_guest_feedback(uuid, uuid, text, text) to anon, authenticated;

create or replace function public.mark_guest_feedback_replies_read(
  p_visitor_id uuid,
  p_guest_secret text
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_count integer := 0;
begin
  if p_visitor_id is null then return 0; end if;
  if p_guest_secret is null or char_length(p_guest_secret) < 32 or char_length(p_guest_secret) > 512 then return 0; end if;

  v_hash := encode(extensions.digest(convert_to(p_guest_secret, 'UTF8'), 'sha256'), 'hex');

  update public.feedback_replies reply
     set read_at = coalesce(reply.read_at, now())
    from public.feedback_submissions feedback
   where feedback.id = reply.feedback_id
     and feedback.user_id is null
     and feedback.visitor_id = p_visitor_id
     and feedback.guest_access_hash = v_hash
     and reply.author_type = 'admin'
     and reply.read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_guest_feedback_replies_read(uuid, text) from public;
grant execute on function public.mark_guest_feedback_replies_read(uuid, text) to anon, authenticated;

-- 游客历史继续由受保护 RPC 返回；增加发送者与已读状态，旧客户端会忽略额外字段。
create or replace function public.list_guest_feedback(
  p_visitor_id uuid,
  p_guest_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_visitor_id is null then return '[]'::jsonb; end if;
  if p_guest_secret is null or char_length(p_guest_secret) < 32 or char_length(p_guest_secret) > 512 then return '[]'::jsonb; end if;

  v_hash := encode(extensions.digest(convert_to(p_guest_secret, 'UTF8'), 'sha256'), 'hex');

  update public.feedback_submissions
     set guest_access_hash = v_hash
   where user_id is null
     and visitor_id = p_visitor_id
     and guest_access_hash is null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', feedback.id,
        'user_id', feedback.user_id,
        'feedback_type', feedback.feedback_type,
        'content', feedback.content,
        'status', feedback.status,
        'created_at', feedback.created_at,
        'replies', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', reply.id,
                'feedback_id', reply.feedback_id,
                'content', reply.content,
                'created_at', reply.created_at,
                'author_type', reply.author_type,
                'read_at', reply.read_at,
                'attachments', '[]'::jsonb
              ) order by reply.created_at asc
            )
            from public.feedback_replies reply
            where reply.feedback_id = feedback.id
          ),
          '[]'::jsonb
        ),
        'attachments', '[]'::jsonb
      ) order by feedback.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.feedback_submissions feedback
  where feedback.user_id is null
    and feedback.visitor_id = p_visitor_id
    and feedback.guest_access_hash = v_hash;

  return v_result;
end;
$$;

revoke all on function public.list_guest_feedback(uuid, text) from public;
grant execute on function public.list_guest_feedback(uuid, text) to anon, authenticated;

comment on table public.feedback_replies is
  'Two-way feedback conversation. admin replies are delivered to the feedback owner; user/guest replies are follow-ups visible to feedback admins.';
comment on table public.feedback_attachments is
  'Private screenshot metadata for original feedback and authenticated reply images. Guest replies remain text-only so the browser secret is never converted into public Storage access.';

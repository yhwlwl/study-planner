-- 游客“我的反馈”：使用每台浏览器独立的随机访问密钥，而不是开放匿名 SELECT。
-- 旧版游客反馈没有访问密钥；第一次使用同一 visitor_id 查询时会被一次性认领。

alter table public.feedback_submissions
  add column if not exists guest_access_hash text;

comment on column public.feedback_submissions.guest_access_hash is
  'SHA-256 of the per-browser guest feedback secret. Used only for secure guest history lookup; never exposed to clients.';

-- 游客提交改走受控 RPC，确保每条新游客反馈都绑定访问密钥。
revoke insert (feedback_type, content, user_id, visitor_id) on table public.feedback_submissions from anon;
drop policy if exists "Guests can submit feedback" on public.feedback_submissions;

create index if not exists feedback_submissions_guest_access_idx
  on public.feedback_submissions (visitor_id, guest_access_hash, created_at desc)
  where user_id is null;

create or replace function public.submit_guest_feedback(
  p_feedback_type text,
  p_content text,
  p_visitor_id text,
  p_guest_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_content text := btrim(coalesce(p_content, ''));
  v_hash text;
begin
  if p_feedback_type not in ('bug', 'suggestion', 'experience', 'other') then
    raise exception 'invalid feedback type' using errcode = '22023';
  end if;
  if char_length(v_content) < 1 or char_length(v_content) > 4000 then
    raise exception 'invalid feedback content' using errcode = '22023';
  end if;
  if p_visitor_id is null or char_length(p_visitor_id) < 8 or char_length(p_visitor_id) > 200 then
    raise exception 'invalid visitor id' using errcode = '22023';
  end if;
  if p_guest_secret is null or char_length(p_guest_secret) < 32 or char_length(p_guest_secret) > 512 then
    raise exception 'invalid guest secret' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(p_guest_secret, 'UTF8'), 'sha256'), 'hex');

  insert into public.feedback_submissions (
    feedback_type,
    content,
    user_id,
    visitor_id,
    guest_access_hash
  ) values (
    p_feedback_type,
    v_content,
    null,
    p_visitor_id,
    v_hash
  )
  returning id into v_id;

  -- 兼容升级前已存在的同浏览器游客反馈。
  update public.feedback_submissions
     set guest_access_hash = v_hash
   where user_id is null
     and visitor_id = p_visitor_id
     and guest_access_hash is null;

  return v_id;
end;
$$;

revoke all on function public.submit_guest_feedback(text, text, text, text) from public, authenticated;
grant execute on function public.submit_guest_feedback(text, text, text, text) to anon;

create or replace function public.list_guest_feedback(
  p_visitor_id text,
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
  if p_visitor_id is null or char_length(p_visitor_id) < 8 or char_length(p_visitor_id) > 200 then
    return '[]'::jsonb;
  end if;
  if p_guest_secret is null or char_length(p_guest_secret) < 32 or char_length(p_guest_secret) > 512 then
    return '[]'::jsonb;
  end if;

  v_hash := encode(extensions.digest(convert_to(p_guest_secret, 'UTF8'), 'sha256'), 'hex');

  -- 第一次查询时，把升级前没有密钥的旧游客反馈认领到当前浏览器。
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
                'created_at', reply.created_at
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

revoke all on function public.list_guest_feedback(text, text) from public;
grant execute on function public.list_guest_feedback(text, text) to anon, authenticated;

comment on function public.submit_guest_feedback(text, text, text, text) is
  'Creates guest feedback using a per-browser secret; direct anonymous table inserts are intentionally disabled.';
comment on function public.list_guest_feedback(text, text) is
  'Returns only guest feedback belonging to the supplied stable visitor id and matching per-browser secret, including developer replies.';

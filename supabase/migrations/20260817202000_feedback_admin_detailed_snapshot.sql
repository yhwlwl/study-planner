-- 反馈管理员读取完整的非敏感反馈快照。
-- guest_access_hash 是游客访问密钥哈希，绝不返回给前端。

create or replace function public.list_feedback_admin_details()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_admin boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'feedback admin authentication required';
  end if;

  select coalesce((u.raw_app_meta_data ->> 'feedback_admin')::boolean, false)
  into v_is_admin
  from auth.users u
  where u.id = auth.uid();

  if not coalesce(v_is_admin, false) then
    raise exception 'feedback admin permission required';
  end if;

  select coalesce(
    jsonb_agg(
      (to_jsonb(f) - 'guest_access_hash')
      || jsonb_build_object('account_email', u.email)
      order by f.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.feedback_submissions f
  left join auth.users u on u.id = f.user_id;

  return v_result;
end;
$$;

revoke all on function public.list_feedback_admin_details() from public, anon, authenticated;
grant execute on function public.list_feedback_admin_details() to authenticated;

comment on function public.list_feedback_admin_details() is 'Returns the full non-secret feedback snapshot plus account email to authenticated feedback admins only. guest_access_hash is never returned.';

# 增长分析与核心漏斗埋点

本页记录 v0.9.0 之后新增的匿名访问身份、首次来源归因、SPA 页面访问和核心漏斗事件口径。

## 1. 身份与首次来源

浏览器首次加载后会在 `localStorage` 生成并长期保留：

- `study-planner:visitor-id`：永久匿名浏览器 ID。用户主动清理浏览器站点数据后会重新生成。
- `study-planner:first-attribution-v1`：第一次捕获到的来源快照，后续访问不覆盖。
- `study-planner:utm_source` / `study-planner:utm_campaign`：便于直接检查的首次来源字段。
- `study-planner:first_referrer`：首次外部 referrer 的 **origin + pathname**；会主动去掉 query 和 hash，既保留来源路径信息，也避免把查询参数中的敏感内容写入日志。

来源优先级：第一次访问 URL 中的 UTM > 已配置的短链映射 > 无来源（direct）。一旦首次来源已保存，之后从其他渠道回来也不会覆盖，因此注册、建计划、完成任务等后续事件仍携带最初来源。

当前已明确配置：

- `/r2` → `xiaohongshu / summer_homework_2`

`/r1`、`/r3` 已配置为 Vercel 短路由，但因为尚未给出对应 source / campaign，暂不猜测归因。确定活动名后只需修改 `src/lib/analytics.ts` 的 `SHORT_LINK_ATTRIBUTION`。

## 2. 访问与页面行为

访问和 SPA 内部页面切换分成两个事件，避免把“网站打开次数”和“应用内部导航次数”混在一起：

| event_type | 触发时机 | 主要用途 |
| --- | --- | --- |
| `page_view` | 页面真正加载；PWA/页面跨自然日恢复可见时再补一条 | 访问量、匿名浏览器数、D1/D3/D7 访问留存 |
| `app_page_view` | 应用内部切换 Today / Calendar / Tasks / Intake / Goals / Stats / Export / Guide / Settings / Timer | 判断进入产品后去了哪里、在哪个模块流失 |

`app_page_view.app_page` 保存逻辑页面名；`pathname` 仍保存入口 URL，因此从 `/r2` 进入后可以同时知道来源短链和应用内页面路径。

## 3. 核心漏斗事件

| event_type | 当前触发口径 |
| --- | --- |
| `signup_started` | 用户点击注册并开始 Supabase 注册请求；metadata 只记录邮箱域名，不记录完整邮箱 |
| `signup_confirmed` | 同一浏览器发起注册后，首次拿到该注册用户的已认证 Session |
| `intake_started` | 当前浏览器第一次创建录入批次 |
| `natural_language_parsed` | 每次使用自然语言文本解析并生成预览；不记录原文 |
| `first_plan_applied` | 当前浏览器第一次从“没有已安排任务”变成应用了含已安排任务的正式方案 |
| `first_task_completed` | 当前浏览器第一次观察到任务从未完成状态进入 `done`；首次加载只建立基线，不回填历史 |
| `review_completed` | 实时状态中新增/更新复盘记录时记录 |
| `schedule_repair_applied` | 新的 repair 事件进入正式状态，且确实发生任务日期变化或新增一次性约束例外时记录 |

`signup_confirmed` 的来源串联依赖注册浏览器里的 pending signup 标记。pending 标记只保存在本机；完整邮箱只用于本地显示与“重新发送验证邮件”，上传到分析日志的仍只有邮箱域名。因此“在 A 设备注册、去 B 设备点验证链接”的确认事件不会错误归给 B 的首次来源；如以后需要完整的跨设备邮箱验证漏斗，应增加服务端 Auth webhook / 审计事件，而不是在客户端猜测。

## 4. 数据库部署顺序

**先执行更新后的 `supabase-schema.sql`，再部署包含新 `/api/visit-log` 的前端/Function。**

已有 `visit_logs` 表会通过幂等 `alter table ... add column if not exists` 新增：

- `visitor_id`
- `app_page`
- `utm_source`
- `utm_campaign`
- `first_referrer`

旧 PWA 缓存客户端没有 `visitor_id` 时，API 仍允许写入，避免升级瞬间丢失旧客户端 page view；新客户端始终发送 `visitor_id`。

## 5. 常用查询

以下示例按北京时间统计；如需要其他业务时区，替换 `Asia/Shanghai`。

### 5.1 真实匿名浏览器数与访问量

```sql
select
  count(*) filter (where event_type = 'page_view') as page_views,
  count(distinct visitor_id) filter (where event_type = 'page_view' and visitor_id is not null) as unique_browsers
from public.visit_logs;
```

### 5.2 来源 → 注册 → 第一份计划

```sql
with visitor_funnel as (
  select
    visitor_id,
    max(utm_source) filter (where utm_source is not null) as utm_source,
    max(utm_campaign) filter (where utm_campaign is not null) as utm_campaign,
    bool_or(event_type = 'page_view') as visited,
    bool_or(event_type = 'signup_started') as signup_started,
    bool_or(event_type = 'signup_confirmed') as signup_confirmed,
    bool_or(event_type = 'first_plan_applied') as first_plan_applied
  from public.visit_logs
  where visitor_id is not null
  group by visitor_id
)
select
  coalesce(utm_source, '(direct)') as source,
  coalesce(utm_campaign, '(none)') as campaign,
  count(*) filter (where visited) as visitors,
  count(*) filter (where signup_started) as signup_started,
  count(*) filter (where signup_confirmed) as signup_confirmed,
  count(*) filter (where first_plan_applied) as first_plan_applied
from visitor_funnel
group by 1, 2
order by visitors desc;
```

### 5.3 D1 / D3 / D7 访问留存

```sql
with visits as (
  select distinct
    visitor_id,
    (occurred_at at time zone 'Asia/Shanghai')::date as visit_date
  from public.visit_logs
  where event_type = 'page_view' and visitor_id is not null
), cohorts as (
  select visitor_id, min(visit_date) as cohort_date
  from visits
  group by visitor_id
)
select
  cohort_date,
  count(*) as cohort_size,
  count(*) filter (where exists (
    select 1 from visits v where v.visitor_id = c.visitor_id and v.visit_date = c.cohort_date + 1
  )) as d1_returned,
  count(*) filter (where exists (
    select 1 from visits v where v.visitor_id = c.visitor_id and v.visit_date = c.cohort_date + 3
  )) as d3_returned,
  count(*) filter (where exists (
    select 1 from visits v where v.visitor_id = c.visitor_id and v.visit_date = c.cohort_date + 7
  )) as d7_returned
from cohorts c
group by cohort_date
order by cohort_date desc;
```

### 5.4 邮箱域名的验证流失

```sql
with started as (
  select visitor_id, metadata ->> 'emailDomain' as email_domain, min(occurred_at) as started_at
  from public.visit_logs
  where event_type = 'signup_started' and visitor_id is not null
  group by visitor_id, metadata ->> 'emailDomain'
), confirmed as (
  select distinct visitor_id
  from public.visit_logs
  where event_type = 'signup_confirmed' and visitor_id is not null
)
select
  coalesce(email_domain, '(unknown)') as email_domain,
  count(*) as signup_started,
  count(*) filter (where c.visitor_id is not null) as signup_confirmed,
  round(100.0 * count(*) filter (where c.visitor_id is not null) / nullif(count(*), 0), 1) as confirmation_rate_pct
from started s
left join confirmed c using (visitor_id)
group by 1
order by signup_started desc;
```

### 5.5 SPA 页面进入量

```sql
select
  app_page,
  count(*) as page_entries,
  count(distinct visitor_id) as unique_browsers
from public.visit_logs
where event_type = 'app_page_view'
group by app_page
order by page_entries desc;
```

这些查询只使用事件事实，不再需要从 Snapshot 反推注册后是否建过计划、是否完成过任务或是否做过计划修复。漏斗接入集中在 `AnalyticsObserver`、认证封装和分析基础层，不修改大型 `App.tsx` / `AppContext.tsx` / `IntakePage.tsx`，便于后续独立 cherry-pick/rebase。

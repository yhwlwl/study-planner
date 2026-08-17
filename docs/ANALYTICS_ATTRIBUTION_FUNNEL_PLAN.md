# Study Planner 匿名归因、转化漏斗与首次激活规划

> 状态：规划稿，暂不实施
>
> 日期：2026-08-16
>
> 适用分支：`preview`

## 1. 结论先行

这轮优化的方向是正确的，但需要把三个概念分开：

1. `visitor_id` 识别的是一个浏览器存储空间，不是一个人，也不是一个 IP。
2. `/r1`、`/r2`、`/r3` 是对外使用的短来源码，后台负责把它们映射到具体渠道和活动。
3. `first_plan_applied` 才是“用户真正完成首次建计划”的激活事件，不能继续用“有 Snapshot”或“访问过页面”代替。

建议的最小方案是：

```text
首次访问
  ↓
生成永久匿名 visitor_id（localStorage）
  ↓
保存首次来源（r2 / UTM / referrer）
  ↓
记录可去重的业务事件
  ↓
visitor_id 与登录后的 user_id 关联
  ↓
按来源、邮箱验证、首次计划和 D1/D3/D7 留存分析
```

`r2 -> xiaohongshu / summer_homework_2` 这种映射比把完整活动名放进 URL 更干净，也方便以后更换活动名称而不更换对外链接。

## 2. 当前实现与问题证据

当前代码已经有访问日志的基础设施，但它仍然是“访问计数”，不是产品行为分析：

| 当前实现 | 位置 | 影响 |
|---|---|---|
| 只在 `sessionStorage` 保存会话 ID | `src/lib/analytics.ts` | 刷新、关闭浏览器或新会话后无法稳定识别同一浏览器 |
| 首屏延迟约 700ms 记录一次 `page_view` | `src/main.tsx` | 只能知道页面加载，不知道用户在页面内做了什么 |
| 服务端允许的事件类型只有 `page_view` | `api/visit-log.ts` | 无法记录注册、解析、排期、完成和复盘漏斗 |
| `visit_logs` 主要保存访问、设备和 IP 派生信息 | `supabase-schema.sql` | 适合访问统计，不适合带业务属性的事件流 |
| 页面由 React 状态切换，URL pathname 基本保持 `/` | `src/App.tsx` | 即使用户进入统计、录入或导出，也无法靠 pathname 区分页面 |
| 注册接口只调用 `supabase.auth.signUp`，成功后提示检查邮箱 | `src/lib/supabase.ts`、`src/App.tsx` | 当前没有“邮件已发送、重新发送、已验证、验证失败”的完整链路 |
| 现有 Snapshot 能说明数据存在，但不能说明用户主动完成首次排期 | `study_snapshots` | 空计划和已完成首次计划会被混在一起 |

因此，当前数据最多回答：

> 有多少次页面访问、访问时间大致是什么时候、来自哪里、设备大概是什么。

当前无法可靠回答：

> 哪篇内容带来了已验证账号？用户在哪一步退出？哪些用户真正生成了第一份计划？他们在第 1、3、7 天是否回来？

### 2.1 对现有基线数字的处理

以下数字来自本轮业务观察，应作为“待核查基线”，不能直接当成最终指标：

- 34 个 Auth 账号中有 10 个尚未完成邮箱确认，约 29.4%；
- 21 个已有 Snapshot 的用户中有 6 个仍为空计划，约 28.6%。

实施第一版埋点后，需要用统一查询重新核对：

- 注册日期窗口；
- 是否真的发送过验证邮件；
- 是否点击过重新发送；
- 是否在随后几天完成验证；
- 空 Snapshot 是用户主动选择空白计划，还是在建档中途退出。

## 3. 目标与不做什么

### 3.1 本轮目标

- 建立一个稳定、低侵入、可解释的匿名浏览器识别方式；
- 记录首次来源，并贯穿到注册、首次排期和后续留存；
- 把“注册成功”和“邮箱验证成功”分成两个事件；
- 把“进入录入”和“首次正式排期”分成两个阶段；
- 找到用户在产品内的真实卡点，而不是从 Snapshot 反向猜测；
- 让 `/r1`、`/r2`、`/r3` 可以直接比较不同内容和活动的转化质量。

### 3.2 明确不做

- 不把 `visitor_id` 当作真实身份或跨网站追踪 ID；
- 不用 IP 作为唯一用户识别；同一 IP 下的多个浏览器应当可以分别计数；
- 不采集任务原文、笔记原文、密码、邮箱正文或完整输入框内容；
- 不在本轮为了统计而改动现有计划算法和任务数据口径；
- 不把“有访问”或“创建了空 Snapshot”定义为产品激活；
- 不为了追求事件数量而对每次键盘输入、每次渲染和每次状态变化都上报。

## 4. 身份与来源模型

### 4.1 永久匿名 `visitor_id`

首次打开应用时生成 UUID，并写入 `localStorage`：

```text
study-planner:visitor-id
```

规则：

- 只生成一次，刷新页面、重新打开浏览器和 SPA 页面切换都不变；
- 使用 `crypto.randomUUID()`，不从 IP、UA、屏幕尺寸等信息计算；
- 发送事件时由服务端校验 UUID 格式和长度；
- `localStorage` 不可用时退回内存 ID，但明确标记为低质量匿名会话；
- 清理站点数据、无痕窗口、换浏览器或换设备会产生新的 ID；
- 登录后仍保留 `visitor_id`，同时由服务端从 Bearer Token 得到 `user_id`；
- 不接受客户端自行传入的 `user_id`，避免伪造账号归因。

需要向产品数据使用者明确：

> `visitor_id` 的分母是浏览器，不是“真实人数”。它可以把 310 个 IP 拆解成若干浏览器访问，但无法判断同一个人换设备后的两个 ID，也无法在清除存储后恢复关联。

### 4.2 会话 ID

继续保留短期 `session_id`，建议使用 `sessionStorage`：

- 一次标签页会话一个 ID；
- 用于判断一次访问中的事件顺序和停留过程；
- 不承担跨天留存识别；
- `visitor_id` 与 `session_id` 同时出现在事件中。

### 4.3 首次来源字段

首次访问时最多保存一次以下对象：

```json
{
  "first_source": "xiaohongshu",
  "first_campaign": "summer_homework_2",
  "first_medium": "social",
  "first_content": "post_2",
  "first_referrer": "https://www.xiaohongshu.com",
  "first_route_code": "r2",
  "first_landing_path": "/r2",
  "first_seen_at": "2026-08-16T00:00:00.000Z"
}
```

推荐的来源优先级：

1. 后台解析出的短路由映射；
2. URL 中的 `utm_source`、`utm_campaign` 等参数；
3. 外部 referrer 的 origin；
4. `direct`。

规则：

- `first_*` 只写第一次有效来源，不被后续普通访问覆盖；
- 如需分析最近一次活动，另存 `last_*`，不能覆盖首次归因；
- `first_referrer` 只保存经过清洗的 origin 或有限长度 URL，不保存可能包含隐私参数的完整 query；
- 同时保存 `first_landing_path`，以便区分首页和短路由落地页；
- 来源字段进入每个核心事件的公共上下文，避免后续只能依赖 join 推断。

### 4.4 短路由映射

建立服务端维护的 `referral_links` 映射表，不把活动名称硬编码进前端：

| code | source | campaign | medium | 状态 |
|---|---|---|---|---|
| `r1` | `xiaohongshu` | 待确定 | `social` | 预留 |
| `r2` | `xiaohongshu` | `summer_homework_2` | `social` | 首个明确映射 |
| `r3` | 待确定 | 待确定 | 待确定 | 预留 |

短路由流程：

```text
/r2
  ↓
服务端查 referral_links
  ↓
记录 route_code=r2 和映射后的 source/campaign
  ↓
跳转到应用首页或指定落地页
  ↓
浏览器保存 first_*，后续事件沿用
```

同一个 code 不应在不同时间复用给不同活动。若活动改变，创建新 code，保留历史映射不变。

## 5. 事件数据模型

### 5.1 推荐的数据表

保留现有 `visit_logs`，不破坏 GitHub 访问徽章和历史 page view 统计；新增业务事件表：

```text
analytics_events
```

推荐字段：

| 字段 | 说明 |
|---|---|
| `event_id` | 客户端生成 UUID，唯一去重键 |
| `event_name` | 事件名称，使用白名单 |
| `event_version` | 事件结构版本 |
| `occurred_at` | 服务端写入时间，作为统计时间主口径 |
| `client_time` | 客户端时间，仅用于诊断时钟偏差 |
| `visitor_id` | 匿名浏览器 ID |
| `session_id` | 当前会话 ID |
| `user_id` | 服务端从认证 Token 得到，可为空 |
| `route_code` | `r1`、`r2`、`r3` 等 |
| `source`、`campaign`、`medium` | 首次来源快照 |
| `screen` | 逻辑页面名，如 `intake`、`stats` |
| `app_version` | 产品版本 |
| `properties` | 经过白名单限制的结构化属性 |
| `idempotency_key` | 业务动作去重键 |

建议的最小数据库约束：

- `event_id` 唯一；
- `event_name` 只允许白名单值；
- `visitor_id` 为 UUID；
- `user_id` 关联 `auth.users`，但允许匿名事件为空；
- `properties` 限制大小，禁止存放原始任务文本；
- 对 `occurred_at`、`event_name`、`visitor_id`、`user_id`、`campaign` 建索引；
- API 使用服务端函数或受限 RPC 写入，不给匿名浏览器直接开放整张表的写权限。

### 5.2 公共事件上下文

所有事件自动附带：

```text
visitor_id
session_id
user_id（如果已认证）
first_source / first_campaign / first_route_code
screen
app_version
client_timezone
device_class
occurred_at（服务端）
```

不能从业务事件属性中重复携带邮箱、任务标题、笔记或自然语言原文。

### 5.3 核心漏斗事件

| 事件 | 触发时机 | 去重建议 | 最小属性 |
|---|---|---|---|
| `signup_started` | 用户打开注册模式或点击注册入口 | 每个会话一次，统计时取首次 | `entry_point` |
| `signup_submitted` | 注册表单提交到 Supabase | 每次提交一个事件 | `provider`、`entry_point` |
| `signup_confirmed` | 邮箱真正确认并完成认证会话 | 每个 `user_id` 一次 | `verification_method` |
| `intake_started` | 用户第一次进入录入并产生明确开始动作 | 每个用户首次一次，另保留普通 `screen_view` | `entry_point`、`is_blank_plan` |
| `natural_language_parsed` | 自然语言/粘贴内容成功解析并产生预览 | 每次成功解析一个 | `input_mode`、`recognized_count`、`has_deadline`、`has_duration` |
| `first_plan_applied` | 用户首次确认并应用有实际任务的正式排期 | 每个用户一次 | `task_count`、`group_count`、`scheduled_minutes` |
| `first_task_completed` | 用户第一次把任务标记为完成 | 每个用户一次 | `actual_minutes_source`、`days_since_plan` |
| `review_completed` | 用户保存某一天的复盘结果 | 每个日期/复盘版本一次 | `review_date`、`unfinished_count`、`decision_type` |
| `schedule_repair_applied` | 用户确认并应用一项重排/修复方案 | 每次方案应用一个 | `reason`、`affected_count`、`moved_count`、`policy` |

### 5.4 `signup_confirmed` 的重要定义

不能把 `supabase.auth.signUp()` 返回成功当作 `signup_confirmed`。在开启邮箱确认时，注册接口可能只代表账号创建成功，用户仍未点击邮件。

因此拆成：

```text
signup_started
  → signup_submitted
  → signup_created（补充事件）
  → email_verification_sent
  → email_verification_resent（可重复）
  → email_verified / signup_confirmed
  → first_authenticated_session
```

`signup_confirmed` 只有在确认邮件后的认证状态能够证明 `email_confirmed_at` 已存在时才发出。如果项目关闭邮箱确认，则在账号创建成功时按配置说明直接视为已确认，但必须保留配置快照。

### 5.5 推荐补充事件

为了定位卡点，建议同时增加：

- `screen_view`：逻辑页面切换，不依赖 pathname；
- `signup_created`、`signup_failed`、`signin_failed`；
- `email_verification_sent`、`email_verification_resent`、`email_verification_help_opened`；
- `onboarding_step_viewed`、`onboarding_step_completed`；
- `plan_preview_opened`、`plan_preview_cancelled`、`plan_preview_applied`；
- `snapshot_created`，仅作数据诊断，不作激活事件；
- `analytics_upload_failed`，只记录错误类别，不记录敏感响应正文；
- `analytics_opt_out`，如果后续提供关闭统计的入口。

## 6. SPA 页面与行为定位

### 6.1 页面必须使用逻辑名

当前 React 使用 `page` 状态切换页面，建议为每个页面定义稳定的 `screen`：

| `screen` | 页面 |
|---|---|
| `today` | 今日 |
| `calendar` | 月历/日历 |
| `tasks` | 任务 |
| `intake` | 录入 |
| `goals` | 目标 |
| `stats` | 统计 |
| `export` | 导出 |
| `guide` | 教程 |
| `settings` | 设置 |
| `timer` | 专注计时 |

进入页面时发送 `screen_view`，属性包含：

- `from_screen`；
- `entry_point`，例如首页按钮、侧边栏、空状态、教程链接；
- `is_first_view`；
- `has_plan`、`pending_intake_count` 等非敏感摘要。

不要把页面标题或任务标题放进属性。这样即使 pathname 永远是 `/`，也可以知道用户在哪个功能模块停留和退出。

### 6.2 只在有业务意义的动作上报

以下行为不应上报成业务事件：

- 每次按键；
- 每次 React 渲染；
- 每次鼠标移动；
- 每次打开下拉框；
- 仅看到按钮但没有点击。

对于“打开预览”和“确认应用”要分开发送，因为两者之间的差值正是用户是否理解并接受方案的重要信号。

## 7. 邮箱验证专项方案

### 7.1 要回答的问题

目前的 10 个未确认账号不能直接解释为“用户不想用”。需要区分：

1. 邮件是否成功发送；
2. 邮件是否被点击；
3. 用户是否点击后回到本站；
4. 用户是否遇到过期、错误或登录失败；
5. 用户是否使用 QQ、163 等特定邮箱域名；
6. 用户是否看到了明确的下一步说明。

### 7.2 首先补齐事件，再诊断投递

认证事件至少要覆盖：

```text
signup_submitted
signup_created
email_verification_sent
email_verification_resent
email_verified
signup_confirmed
signup_failed
signin_failed
```

查询维度：

- 邮箱域名的脱敏分组，如 `qq.com`、`163.com`，不展示完整邮箱；
- 注册后经过的天数：0 天、1–3 天、4–7 天、7 天以上；
- 是否点击重新发送；
- 是否出现验证相关错误；
- 来源和活动；
- 是否在验证后进入录入。

### 7.3 注册成功页的产品改动建议

注册请求成功后，不要只显示“请检查邮箱”，而要明确说明：

> 账号已创建。请打开注册邮箱，点击确认链接后再回来登录。没有收到邮件？先检查垃圾箱，或在这里重新发送。

页面应包含：

- 脱敏后的邮箱地址；
- “重新发送验证邮件”按钮和倒计时；
- “修改邮箱”入口；
- QQ、163 等邮箱检查垃圾箱的简短提示；
- 验证完成后的继续登录/刷新状态动作；
- 发送失败时的可理解错误，而不是原始 Supabase 错误码。

是否更换 SMTP、邮件服务商或邮件模板，要在确认“发送成功但点击率低”还是“根本没有送达”后再决定，不能仅凭未确认账号数量直接更换基础设施。

## 8. 首次建计划与 Onboarding 漏斗

### 8.1 正确的激活定义

第一阶段的核心转化是：

```text
首次访问
  → 注册开始
  → 邮箱确认
  → 进入录入
  → 解析/创建任务
  → 设置目标期限
  → 确认可用时间
  → 打开排期预览
  → 应用第一份正式计划
  → 完成第一个任务
```

其中：

- `snapshot_created` 只是保存数据；
- 空计划可以是合法的空白起点，也可以是中途退出；
- `first_plan_applied` 是激活的主事件；
- `first_task_completed` 是首次价值交付后的执行验证；
- `review_completed` 是进入持续使用闭环的信号。

### 8.2 建议增加的步骤事件

如果当前首次建档仍然是分步流程，统一使用：

- `onboarding_step_viewed`；
- `onboarding_step_completed`；
- `onboarding_abandoned`，仅在明确离开或恢复时记录，不用页面关闭瞬间强行推断。

步骤属性只包含：

- `step`: `intake`、`deadline`、`availability`、`preview`、`apply`；
- `step_index`；
- `entry_point`；
- `elapsed_seconds`；
- `error_code`，如有。

不记录用户输入的任务内容。

### 8.3 空计划的诊断规则

后台需要把以下状态分开：

| 状态 | 含义 |
|---|---|
| 账号已创建，无 Snapshot | 还没有开始云端建档或同步未完成 |
| 有 Snapshot，无录入开始事件 | 可能是初始化空数据、导入或旧版本数据 |
| 已进入录入，有内容但无预览 | 在录入或字段校验阶段退出 |
| 有预览，无应用 | 用户在方案理解、冲突或容量处犹豫 |
| 已应用第一份计划 | 完成核心激活 |
| 已应用但无首个完成 | 还没有进入持续执行阶段 |

这样可以针对真实卡点优化，而不是简单地把所有空计划用户当作同一种流失。

## 9. 指标口径与 KPI

### 9.1 三个主指标

第一版后台只保留三个主指标，其他作为诊断指标：

1. **邮箱确认率**

   ```text
   在统计窗口内完成 email_verified 的用户数
   ÷ 提交 signup 的用户数
   ```

2. **首次计划激活率**

   ```text
   在注册后 7 天内 first_plan_applied 的用户数
   ÷ 同一注册 cohort 的已创建账号数
   ```

3. **D7 留存率**

   ```text
   在首次计划应用后第 7 天窗口内再次产生有效 screen_view 或业务事件的用户数
   ÷ 同一 cohort 中完成 first_plan_applied 的用户数
   ```

留存使用 `user_id` 作为已登录用户的主键；匿名阶段使用 `visitor_id`。完成登录关联后，不把同一用户的不同浏览器匿名 ID 直接相加为“不同的人”。

### 9.2 诊断指标

- 来源落地 → `signup_started`；
- 注册提交 → `signup_created`；
- 账号创建 → `email_verified`；
- 邮箱确认 → `intake_started`；
- 录入开始 → `natural_language_parsed`；
- 解析成功 → `plan_preview_opened`；
- 预览打开 → `first_plan_applied`；
- 首次排期 → `first_task_completed`；
- 首次完成 → `review_completed`；
- 冲突出现 → `schedule_repair_applied`；
- 各步骤的中位耗时和 P75 耗时；
- QQ、163 等邮箱域名的验证率；
- 各来源的首次计划激活率和 D7 留存率。

### 9.3 质量与隐私护栏

- 核心事件中至少 99% 有合法 `event_id`；
- 核心事件中至少 95% 有 `visitor_id` 或已认证 `user_id`；
- 重复事件率低于 1%；
- 事件上传失败要可观测，但不能阻塞任务和排期操作；
- 业务属性不得出现任务原文、笔记、密码或完整邮箱；
- 任何报表都明确标注分母、时间窗口、时区和是否去重；
- 访问 IP 如果继续保留，只用于安全/粗略地域和访问日志，不作为产品行为分析的身份主键；
- 定义数据保留期、删除/导出机制和必要的隐私告知后再默认上线。

## 10. 数据看板与查询产物

第一版不必立刻做复杂后台页面，先生成稳定的 SQL view 或受保护的分析查询：

### 10.1 来源看板

- `r1`、`r2`、`r3` 的独立 visitor 数；
- 注册开始数、账号创建数、邮箱确认数；
- 首次计划应用数；
- D1/D3/D7 留存；
- 每个来源的中位首次激活耗时。

### 10.2 邮箱验证看板

- 注册后 0/1–3/4–7/7+ 天未确认数；
- 发送、重发、验证成功的漏斗；
- 按邮箱域名分组的确认率；
- 验证错误和登录错误；
- 来源与邮箱域名的交叉检查。

### 10.3 Onboarding 看板

- 每一步到达人数和完成率；
- 每一步的退出人数和耗时；
- 空计划的来源状态；
- 首次排期预览打开但未应用的用户；
- 应用计划后仍未完成首个任务的用户。

### 10.4 留存看板

- 按首次访问 cohort；
- 按首次计划应用 cohort；
- D1、D3、D7；后续再增加 D14/D30；
- “回来”必须定义为有效页面访问或业务事件，不能把后台自动刷新当作留存。

## 11. 分阶段落地计划

### P0：口径与安全边界

- [ ] 确认 `signup_confirmed` 代表邮箱已验证，而不是 signUp API 返回成功；
- [ ] 确认 `first_plan_applied` 的激活条件；
- [ ] 确认 `r1/r2/r3` 的正式映射；
- [ ] 确认分析是否需要同意机制、关闭入口和数据保留期；
- [ ] 设计事件白名单、属性白名单和去重规则；
- [ ] 以统一查询核对 34/10、21/6 两组现有基线。

### P1：身份与来源

- [ ] 新增永久匿名 `visitor_id`；
- [ ] 保留并继续使用 `session_id`；
- [ ] 捕获 first-touch 来源；
- [ ] 建立 `referral_links` 和 `/r1`、`/r2`、`/r3` 解析；
- [ ] 使来源跨页面、注册和首次排期保持不变；
- [ ] 为每个事件保留服务端时间。

### P2：事件管道与 SPA 页面

- [ ] 新增 `analytics_events` 或将现有访问日志安全扩展为业务事件表；
- [ ] API 增加事件白名单和严格 payload 校验；
- [ ] 建立本地 outbox、离线补发和重复去重；
- [ ] 增加 `screen_view`；
- [ ] 先实现八个核心事件，再补充诊断事件；
- [ ] 事件发送失败不影响核心产品操作。

### P3：邮箱验证体验

- [ ] 增加发送、重发、验证、失败和帮助事件；
- [ ] 注册成功页明确下一步；
- [ ] 增加重新发送、修改邮箱和垃圾箱提示；
- [ ] 按域名和注册后天数分析 10 个未确认账号；
- [ ] 根据“未发送/未送达/未点击/点击后失败”再决定邮件基础设施是否调整。

### P4：首次激活与留存

- [ ] 增加录入、期限、可用时间、预览和应用步骤事件；
- [ ] 用 `first_plan_applied` 替代空 Snapshot 作为激活主指标；
- [ ] 建立首次计划应用 cohort；
- [ ] 生成来源、认证、Onboarding 和 D1/D3/D7 四类查询；
- [ ] 对照真实用户流程做一次从 `/r2` 到首次计划的端到端验证。

## 12. 验收标准

### 身份与归因

- [ ] 同一浏览器刷新和重新打开后 `visitor_id` 不变；
- [ ] 清理 localStorage 或更换浏览器后产生新 ID，并在报表中按浏览器解释；
- [ ] 从 `/r2` 进入后，后续注册、录入和首次排期事件都能看到 `xiaohongshu / summer_homework_2`；
- [ ] 后续访问不会覆盖首次来源；
- [ ] `r2` 的活动映射改变不会改写历史事件。

### 事件与漏斗

- [ ] 八个核心事件均有明确触发点、版本、去重键和属性白名单；
- [ ] SPA 进入统计、录入、导出等页面可以通过 `screen_view` 区分；
- [ ] 注册 API 成功但未点验证邮件时，不会被记为 `signup_confirmed`；
- [ ] 空 Snapshot 不会被计作 `first_plan_applied`；
- [ ] 首次计划应用、首个任务完成、复盘和修复均可按用户追踪一次或按业务日期去重。

### 数据与隐私

- [ ] 事件中不出现任务原文、笔记、密码和完整邮箱；
- [ ] 损坏的本地 outbox 不会阻塞 App；
- [ ] 网络失败后事件可重试且不重复计数；
- [ ] 服务端时间是统计主口径，并保留客户端时间仅用于诊断；
- [ ] 访问日志的 IP 与业务事件身份分离，报表不使用 IP 当用户主键；
- [ ] 事件覆盖率、重复率、上传失败率都有质量检查。

### 用户体验

- [ ] 注册成功页明确说明“必须去邮箱点击确认”；
- [ ] 未收到邮件时用户能直接重发、修改邮箱并查看帮助；
- [ ] 用户从中途退出后，再回来仍能继续录入和首次排期；
- [ ] 埋点失败、离线或隐私设置不会阻塞新增任务、排期和复盘。

## 13. 待确认事项

1. `r1` 和 `r3` 的正式渠道、活动名和内容位是什么？
2. 是否默认启用匿名产品分析，是否提供设置中的关闭入口？
3. 当前 Supabase Auth 是否使用默认邮件服务，是否能查看发送/退信日志？
4. `signup_confirmed` 是否严格等于邮箱确认，还是需要额外保留“账号已创建”指标？本规划建议两者都保留，但名称必须分开。
5. D1/D3/D7 是按首次访问 cohort，还是按首次计划应用 cohort？本规划建议两个都保留，主看板优先使用首次计划应用 cohort。
6. 分析查询由 Supabase SQL view、独立后台还是导出 CSV 承载？第一阶段建议先用受保护 SQL view 验证口径。

## 14. 本轮交付边界

本次只建立规划文档，不修改埋点代码、Supabase 表结构、认证页面或 URL 路由。下一轮实施应严格按 P0 → P1 → P2 顺序推进，先锁定指标口径和隐私边界，再接入事件，最后做邮箱和 Onboarding 的产品改动。

# 交互式演示教程 v2：流程、稳定性与异常操作审计

> 审计对象：`tutorial:v2`
> 目标：严格覆盖“修复 → 月历 → 目标 → 自然语言录入 → 任务 → 新建目标/绑定 → 排期 → 月历 → 执行 → 复盘 → 顺延 → 月历 → 统计 → 未来重排 → 月历 → 结束”的完整体验，同时保证教程数据不污染真实计划。

## 一、不可破坏的不变量

1. **教程先征得用户选择。** 首次空白访问只显示“体验完整流程”说明弹窗；用户可以直接开始自己的计划。设置和帮助页都可再次打开教程入口。
2. **教程数据完全隔离。** 教程只运行在 `tutorial:v2` namespace；进入前保存真实游客/账号空间，退出成功恢复真实空间后才清除教程 session。
3. **真实智能流程。** 修复、新任务排期、复盘顺延、未来重排都走现有 `PlanChangeEvent → SchedulingProposal → preview → apply` 链路；checkpoint 只负责刷新/损坏恢复，不能冒充调度结果。
4. **一步一事，但功能不消失。** 侧栏、任务操作、目标编辑、Proposal 其他能力、Review 其他能力均保留在界面；非当前步骤的操作只拦截并给轻提示，不通过隐藏制造“假界面”。
5. **关键变化必须有结果反馈。** 修复、录入排期、复盘顺延、未来重排应用后统一先进入月历，高亮受影响日期，再继续下一阶段。
6. **引导可关闭。** 每个步骤都有一条简短引导；关闭后折叠成轻量“查看当前提示”，不会退出教程，也不会遮住主要内容。
7. **刷新可恢复。** 稳定步骤原地恢复；正在生成/预览等瞬态步骤回到最近的安全入口，不自动应用，也不猜测用户选择。
8. **跨午夜一致。** 教程进入日作为 `anchorDate`，本次体验期间“今天”不因真实午夜切换。

## 二、标准主流程（21 个产品阶段）

| 阶段 | 用户动作 | 必须发生的真实结果 | 教程步骤 |
|---|---|---|---|
| 1 | 在说明弹窗选择开始/跳过 | 未选择前不进入教程；跳过不写教程数据 | 入口弹窗 |
| 2 | Today 查看 3 个问题并点重排中心 | 固定存在逾期、今日容量、目标风险；同时有已完成和锁定项 | `repair-entry` |
| 3 | 修复当前问题 → 生成 → 预览 → 应用 | 正式调度器生成可执行方案；完成/锁定不动，目标风险改善 | `repair-action` → `repair-preview` |
| 4 | 查看修复后的月历 | 受影响日期高亮；用户明确看到 proposal 已落到日历 | `repair-calendar` |
| 5 | 打开已有目标详情 | 查看期限、进度、关联任务、预计完成 | `goal-existing` |
| 6 | 打开自然语言录入 | 固定示例文本只读，用户亲手点“解析并预览” | `intake-source` |
| 7 | 查看结构化解析结果并确认 | 四组内容进入待排期批次，不进正式日历 | `intake-parse` |
| 8 | 自动进入任务页 | 显示“刚录入、还未排期”，建立“录入 ≠ 排期” | `tasks-intake` |
| 9 | 新建目标 | 固定名称/今天+5/今天+7 预填，用户亲手确认创建 | `goal-create` |
| 10 | 关联新录入任务 | 用户勾选四组任务并确认，写入待排期项的 `goalIds` | `goal-link` |
| 11 | 回到录入并生成排期预览 | 正式新任务插入/调度 proposal，确认前不进正式计划 | `intake-schedule` → `intake-preview` |
| 12 | 查看新任务月历 | 新任务所在变化日期高亮 | `intake-calendar` |
| 13 | Today 真实执行 | 指定任务完整完成并记录 52 分钟；第二项部分完成 50%/12 分钟；第三项保持未完成 | `execute-complete` → `execute-partial` |
| 14 | 结束今天并复盘 | Review 展示完成、计划时间、实际时间、待处理 | `review-entry` → `review-carry` |
| 15 | 顺延两项未完成任务并看预览 | 合法未来日期由 planner 提供；用户确认后才应用 | `review-carry` → `review-preview` |
| 16 | 查看顺延后的月历 | 未完成任务已进入后续日期 | `review-calendar` |
| 17 | 查看统计并展开详情 | 先看摘要，再由用户亲手展开计划/实际等详细统计 | `stats` → `stats-detail` |
| 18 | 再次进入重排中心 | 当前问题处理后认识“主动重新安排未来”；四个偏好都可见、可选 | `future-entry` → `future-action` |
| 19 | 生成未来重排并看前后对比 | 正式调度生成方案，教学优先选择有真实移动的可执行结果 | `future-preview` |
| 20 | 查看未来重排后的月历 | 高亮未来变化日期，明确“主动规划 ≠ 救火” | `future-calendar` |
| 21 | 结束体验 | “目标 → 录入 → 排期 → 执行 → 复盘 → 调整”；开始我的计划 / 继续看看 | `complete` → 退出或 `free` |

## 三、异常用户操作审计

### 导航和误点

- 点击当前步骤不允许的侧栏页面：页面入口仍显示；`navigate()` 拦截，显示“教程中先完成当前这一步”，步骤不变。
- 手机侧栏误点后：关闭侧栏，不修改教程数据。
- 点击 Today 的非指定任务、任务更多菜单、日期切换、添加任务：控件可见；教程业务层阻止 mutation。
- 点击目标编辑/归档/删除：控件可见，轻提示阻止，不改变 checkpoint。
- 点击 Proposal 的“更多方案”“逐项微调”等：能力仍可见，教程阶段阻止改变剧情。
- 点击 Review 的“更多方案”“仅保存”：能力仍可见，教程阶段阻止绕过顺延主线。

### 弹窗关闭与重试

- 关闭修复中心：`repair-action → repair-entry`。
- 关闭修复 Proposal：`repair-preview → repair-entry`。
- 关闭自然语言输入框：仍停留 `intake-source`；用户可再次点击现有自然语言入口打开，固定文本重新填入。
- 解析后关闭输入框/刷新：瞬态 `intake-parse → intake-source`，避免留下半解析 UI；重新解析结果确定一致。
- 取消目标创建：停留 `goal-create`，可再次打开创建弹窗。
- 取消关联任务：停留 `goal-link`，不写任何链接；重新打开后重新勾选。
- 关闭新任务 Proposal：`intake-preview → intake-schedule`，已录入内容仍存在、未应用。
- 关闭 Review：`review-carry → review-entry`。
- 关闭顺延 Proposal：`review-preview → review-entry`，复盘记录/日期移动未提交。
- 关闭未来重排：`future-action → future-entry`。
- 关闭未来 Proposal：`future-preview → future-entry`。

### 重复点击与并发

- 所有步骤推进都要求 expected-step 匹配，重复事件不会跨两步。
- Proposal 应用、教程启动/退出等关键路径用 transition ref 防止双击并发。
- 真实 plan state 的 commit 继续经过 `AppContext` 教程白名单；仅 UI 阻止不算安全边界。

### 刷新 / 关闭标签页

- `repair-calendar / goal-existing / tasks-intake / goal-create / goal-link / intake-schedule / intake-calendar / execute-* / review-entry / review-calendar / stats* / future-entry / future-calendar / complete`：从对应 canonical checkpoint 校验后继续。
- `repair-action / repair-preview`：恢复 `repair-entry`。
- `intake-parse`：恢复 `intake-source`。
- `intake-preview`：恢复 `intake-schedule`。
- `review-carry / review-preview`：恢复 `review-entry`。
- `future-action / future-preview`：恢复 `future-entry`。
- session JSON 损坏、版本不匹配或非法 anchor：丢弃 session，不执行未知步骤。
- IndexedDB 教程空间缺失/损坏：使用当前安全 checkpoint 重建，只重建教程空间。

### 日期与时间

- 教程过程中跨 00:00：`todayISO()` 保持进入教程时的 `anchorDate`。
- 固定自然语言中的日期、目标期望/最晚日期、fixture 日程都由 `anchorDate` 相对生成，不写死某个自然日。
- Review 顺延日期来自 `suggestMoveDates`；优先 `anchor + 1`，不可用时选择第一个合法未来日期，不强塞冲突日期。

### 游客 / 登录 / 云同步

- 游客已有计划重玩：进入前持久化游客状态；退出恢复游客空间。
- 已登录账号重玩：返回 namespace 记录账号空间；`tutorial:v2` 不进入账号自动云上传。
- 教程中 token refresh / 重复 SIGNED_IN：不应用教程数据到用户账号。
- 教程中登出/身份变化：教程继续；退出时重新计算安全返回空间。
- 原计划读取失败：不清教程 session、不用空白状态覆盖原计划，允许稍后重试退出。
- 教程空间清理失败：若真实空间已成功切回，不阻断用户继续使用真实计划。

## 四、移动端与引导布局

- 页面内步骤的 Coachmark 使用普通文档流 `position: relative`，不覆盖页面按钮；目标位于 Modal 时自动切成右上角小型浮层并位于 Modal 上方，避免出现“弹窗里没有引导”的断层。
- X 只收起当前提示；关闭浮层后不会退出教程，回到普通页面仍可通过“查看当前提示”恢复。浮层宽度/高度受限，手机端不铺满屏幕。
- 高亮只在步骤切换时有限重试寻找 DOM 目标，不使用 MutationObserver 或持续滚动监听追着元素跑。
- 月历结果以日期单元格 outline + “刚调整”标记呈现，不新增遮罩。
- 所有提示文字允许换行；禁止把重要解释为了手机宽度直接删除。

## 五、本轮自动审计要求

提交前必须至少执行：

```bash
node scripts/tutorial-flow-audit.mjs
```

并确保静态流程审计全部通过，同时执行 TypeScript 检查。正式分支 CI 继续执行仓库原有 `quality`：typecheck、Vitest、build 和 planner performance。

新增/更新的 `tests/tutorial.test.ts` 负责运行时验证：固定步骤顺序、三类问题、自然语言解析、真实 repair proposal、checkpoint 区分、执行/复盘状态、四个未来偏好、刷新恢复与业务白名单。

## 六、审计口径

本文件区分两类结论：

- **代码/自动化审计通过**：静态检查、类型检查、单元/集成测试、构建和性能检查按实际运行结果记录。
- **人工浏览器全流程通过**：只有真正从介绍弹窗一路点击到结束，并额外执行误点/关闭/刷新场景后才能标记；不能用静态审计代替人工点击。

教程最终仍遵循产品总原则：**算法计算，系统解释，用户决定；所有智能变更先预览，再应用。**

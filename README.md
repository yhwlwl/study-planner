# Study Planner

> **An adaptive, execution-aware study planner for long-term goals. It treats replanning as schedule repair rather than full-plan regeneration: minimal-disturbance, constraint-aware rescheduling with manual/locked-task protection, multiple scheduling proposals, plan diff & impact analysis, explainable conflict resolution, preview-before-apply, and plan version restore.**

> **一个面向长期学习目标、由真实执行驱动的动态学习计划工具：当现实偏离原计划时，系统会尽量少改、保护已有安排，并在用户确认后再应用调整。**

**Live Demo / 在线体验：** [https://study-planner.yhwlwl.xyz](https://study-planner.yhwlwl.xyz)

![Study Planner rescheduling preview](docs/images/01-rescheduling-preview.png)

*系统不会直接覆盖计划：先生成候选方案，解释冲突、变化与长期影响，用户确认后才应用。*

Unlike traditional todo lists and static study schedules, Study Planner is built for what happens **after reality stops matching the original plan**.

When tasks are unfinished, actual study time differs from estimates, available time changes, or deadlines become harder to meet, Study Planner can **repair and reschedule the remaining plan** while respecting deadlines, daily capacity, task limits, locked tasks, manual arrangements, and protected dates.

The goal is not to regenerate everything from scratch. The scheduler aims for **minimal disturbance**: preserve original dates and user intent whenever possible, then move only what is necessary.

它不只负责“第一次把计划排出来”，而是围绕长期目标建立：

**计划 → 执行 → 复盘 → 偏差 → 计划修复 / 重排 → 继续执行**

的完整闭环。

---

## Key Features

- **Execution-aware schedule repair / dynamic rescheduling** — recalculate future study tasks when actual progress differs from the original plan, including unfinished tasks, partial completion, missed study sessions, and actual time spent;
- **Minimal-disturbance rescheduling** — preserve original dates, locked tasks, manual intent, and protected dates whenever possible instead of regenerating the whole schedule;
- **Deadline & capacity-aware scheduling** — schedule around target dates, hard deadlines, daily study capacity, per-task limits, unavailable dates, reduced-capacity days, and special-capacity dates;
- **Constraint-aware scheduling** — balance multiple scheduling constraints instead of simply pushing overdue tasks to the next available day;
- **Manual intent / locked-task protection** — locked tasks, manually scheduled work, and protected dates are treated as user intent and are not silently rewritten;
- **Multiple Scheduling Proposals** — generate alternative repair strategies with different trade-offs instead of forcing a single automatic result;
- **Plan diff & impact analysis** — show task movements, date-load changes, goal impacts, rejected alternatives, and affected manual intent before applying a proposal;
- **Preview before apply** — proposed schedule changes are shown before they modify the active plan;
- **Explainable conflict resolution** — explain why constraints conflict, which tasks and values are involved, what the consequences are, and which resolution choices are available;
- **Plan versions / restore** — major adjustments create recoverable plan versions while preserving real execution records;
- **Real execution feedback** — record completed and partially completed tasks, actual duration, planned-vs-actual performance, and recent execution patterns;
- **Web / PWA** — responsive desktop and mobile web app with installable PWA support.

---

## Scheduling Model

Study Planner treats replanning as **schedule repair**, not full-plan regeneration.

```text
Execution difference (planned vs. actual)
  → constraint-aware schedule repair
  → multiple SchedulingProposal candidates
  → plan diff + impact analysis + conflict resolution
  → user preview / approval
  → apply
  → PlanVersion
```

The scheduler aims for **minimal disturbance**: preserve locked tasks, manual intent, protected dates, and original task dates whenever possible, then move only what is necessary to keep the long-term goal feasible.

换句话说，它追求的不是“每次都重新算出一张理论上更优的新计划”，而是：

> **在真实执行、长期目标和用户已有安排之间，尽量少动原计划地修复偏差。**

---

## 典型场景 / Typical Scenario

你计划在 **60 天内完成一门课程**，已经根据截止日期和每天可学习时间排好了任务。

### 1. 先有一个真正可执行的长期计划

计划不是简单的任务列表，而是分布在未来日期上的学习安排，并同时受到每日容量、任务规则和目标期限约束。

![Calendar month view](docs/images/03-calendar-month-view.png)

### 2. 真实执行开始偏离原计划

现实中可能出现：

- 今天原本计划学习 3 小时，实际只完成了 1.5 小时；
- 某个任务实际用了 4 小时，而原本只预计 2 小时；
- 下周突然有两天无法学习；
- 某些任务必须在月底前完成；
- 某些任务已经手动安排好，不希望系统移动；
- 还有一些任务已经锁定，不能为了“优化”被自动改写。

Study Planner 会记录完成、部分完成和实际用时，而不是只留下一个“完成 / 未完成”的勾选状态。

![Today execution view](docs/images/02-today-execution.png)

### 3. 复盘真实执行，而不是假设原估时永远正确

一天结束后，可以直接比较计划时间和实际时间，并逐项决定未完成任务接下来怎么处理。

![Review summary and unfinished tasks](docs/images/16-review-summary-and-unfinished-tasks.png)

系统还可以根据近期真实样本给出更合理的时长建议，但**只提供建议，不会静默覆盖原来的估时或移动计划**。

![Adaptive duration suggestions](docs/images/17-review-adaptive-duration-suggestions.png)

### 4. 需要调整时，先决定“为什么调”和“希望怎么调”

传统 Todo List 或静态 Planner 通常只能告诉你：

> **任务逾期了。**

剩下几十天怎么重新安排，仍然需要自己计算。

Study Planner 会重新评估：

**剩余任务 + 实际完成情况 + 截止日期 + 每日可用时间 + 每日上限 + 任务规则 + 手动/锁定任务 + 日期约束**

并允许用户选择这次调整更重视什么，例如：

- 尽量少改原计划；
- 让未来负载更均衡；
- 优先保障近期目标；
- 为后续保留更多缓冲空间。

![Adjustment strategy selection](docs/images/05-adjustment-strategy.png)

### 5. 重排不是简单把逾期任务全部往后推

系统会重新计算未来日期的任务负载，并展示调整前后的变化。

![Daily workload before and after rescheduling](docs/images/06-daily-workload-before-after.png)

对于具体任务，可以继续查看它为什么被移动、为什么没有移动，或者为什么找不到满足当前约束的新日期。

![Task-level rescheduling explanation](docs/images/07-task-level-rescheduling.png)

### 6. 最后检查长期目标是否仍然可达

任务重排之后，系统会继续评估目标预计完成时间以及最晚期限风险，而不是只回答“明天学什么”。

![Goal impact after rescheduling](docs/images/08-goal-impact.png)

所以一次重排最终回答的不只是：

> “下一项任务放到哪一天？”

而是：

> **“按照我现在真实的进度、未来可用时间和已有安排，我还能不能完成这个长期目标？”**

所有系统调整都会先生成候选方案并解释影响。你可以预览、逐项微调，确认后再应用；如果之后发现调整结果并不合适，还可以恢复之前保存的计划版本。

---

## 这是什么

学习计划真正困难的往往不是第一次把任务排出来，而是：

> **原计划和真实执行开始产生偏差以后怎么办？**

实际学习中，任务可能没有完成、只完成了一部分、耗时比预计更长；某些日期可能突然无法学习，每天可投入的时间也可能变化，原本宽裕的目标会因此逐渐变得紧张。

Study Planner 把：

**计划生成 → 实际执行 → 复盘 → 偏差识别 → 冲突处理 → 调整预览 → 继续执行**

做成一个完整闭环。

当真实执行与原计划发生偏差时，系统不是简单地“重新生成一张新计划”，而是以现有计划为基线进行 **schedule repair / 计划修复**：根据剩余任务、目标期限、每日容量和已有安排重新计算后续计划，同时尽量保留原有日期和用户已经表达过的意图。

但“能够自动重排”并不意味着“系统可以随便改”。

Study Planner 把用户已经表达的意图视为调度约束：能少改就不多改，锁定任务、手动安排和受保护日期不会被静默覆盖。需要重新规划时，系统会先生成可解释的候选方案，用户确认后才修改正式计划。

---

## 核心能力

- **目标驱动的计划设计**：Goal 使用期望日期（软约束）与最晚日期（硬目标）表达，支持全部 / 百分比 / 数量完成条件；
- **任务与任务组**：任务组定义共享规则，包括科目、优先级、每日上限、活动类型与强度；单项任务可覆盖标题、时长、备注与锁定状态；
- **日期约束**：支持不可用、降低容量、特殊容量、受保护缓冲日、日期说明以及日期范围；
- **Today 执行入口**：支持完成、部分完成、实际用时记录与专注计时；
- **真实执行反馈**：计划不只记录“完成 / 未完成”，还可以记录部分完成与实际耗时，为后续调整提供真实执行数据；
- **复盘与自适应时长建议**：比较计划 / 实际、处理未完成任务，并根据近期真实样本给出时长建议；建议不会自动覆盖原估时；
- **执行偏差驱动的计划修复**：任务未完成、实际耗时变化、日期容量变化或目标变化后，可以基于现有计划重新计算后续安排；
- **最小扰动式重排**：优先保留原日期、手动安排、锁定任务和受保护日期，只在必要范围内移动任务；
- **约束感知调度**：重排同时考虑目标期限、每日容量、每日上限、任务规则、日期约束以及用户已有安排，而不是简单把逾期任务向后顺延；
- **多方案调整**：针对同一次变化可以生成不同取舍的 Scheduling Proposal，而不是强制接受唯一的“最优解”；
- **Plan diff / 影响分析**：展示任务移动、日期负载变化、目标影响、被拒绝的替代安排以及手动意图影响；
- **计划调整预览**：变化事件 → 候选方案 → 方案内逐项微调 → 用户确认 → 正式应用；
- **冲突可解释与决策**：区分绝对阻断、用户保护、可一次性例外、目标或结构冲突，并说明涉及任务、数值、原因、后果以及可选解决方式；
- **手动意图保护**：锁定任务、手动安排、受保护日期不会被系统静默改写；
- **计划版本与恢复**：重大变化自动保存本地 PlanVersion，恢复计划时保留已经发生的真实执行记录；
- **本地数据与同步边界**：游客与账号数据空间隔离，云端只同步可移植状态；
- **桌面 + 手机 + PWA**：响应式布局，支持移动端使用，并可作为 PWA 添加到主屏幕。

---

## 设计原则

Study Planner 的调度系统并不是为了在数学意义上“不惜一切代价地优化计划”，而是在：

> **用户意图 + 现实约束 + 长期目标**

之内寻找更合适的后续计划。

例如，用户只是删除一个任务时，系统的第一方案应该只完成删除，而不应该因为发现了“更优排法”，就未经请求重新安排大量其他任务。

- **User intent first** — 用户明确表达的操作和安排优先；
- **Minimal disturbance / Minimal-scope changes** — 能少改就不多改，优先保留原日期与已有结构；
- **Execution-aware planning** — 计划需要随着真实执行变化，而不是假设用户永远严格按照原计划行动；
- **Constraint-aware schedule repair** — 在已有计划上修复偏差，同时考虑期限、容量、任务规则和已有安排，而不是机械顺延或整表重生成；
- **Manual intent protection** — 锁定任务、手动排期和保护日期被视为明确的用户意图；
- **Preview before apply** — 系统修改正式计划之前，先生成可解释、可预览的候选方案；
- **Explainable conflict resolution** — 不只告诉用户“排不下”，还要说明是什么约束导致、涉及哪些任务、有什么后果，以及可以如何处理；
- **Recoverable planning** — 重大调整产生 PlanVersion，可以恢复，并尽量不破坏已经发生的真实执行记录。

---

## 架构概览

```text
用户操作 / 变化事件 (PlanChangeEvent)
  → 调整策略协调（精确校验 / 推荐预览 / 可选优化 / 探索式优化）
  → 统一调度核心（容量、每日上限、目标期限、手动意图、日期保护）
  → schedule repair / 多方案生成（Web Worker 计算，可取消）
  → SchedulingProposal
      ├─ task movements / plan diff
      ├─ date load changes
      ├─ goal impacts
      ├─ manual intent impacts
      ├─ rejected alternatives
      └─ explainable conflicts / resolutions
  → 方案预览、逐项微调、冲突决策
  → 用户确认
  → 应用并记录一次性例外
  → 创建 PlanVersion
```

底层只有一套调度引擎。

「尽量少改 / 均衡执行 / 目标优先 / 更多休息」四种策略是同一调度引擎在不同目标下的评分取舍，而不是四套互相独立的重排系统。

---

## 项目状态

- 当前版本：`v0.8.15`
- 状态：`Active development`（持续迭代）
- 数据：本地优先（IndexedDB），可选 Supabase 账号同步；游客空间独立
- 在线体验：[https://study-planner.yhwlwl.xyz](https://study-planner.yhwlwl.xyz)

---

## 技术栈

React 18、TypeScript（strict）、Vite、PWA（vite-plugin-pwa）、Supabase、IndexedDB（idb）、Recharts、date-fns、lucide-react。

---

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

`.env` 示例：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

浏览器端不得使用 `service_role` 或 `sb_secret_...`；访问日志所需的高权限密钥只能放在服务端环境变量中，且不能使用 `VITE_` 前缀。

访问计数接口为 `/api/visit-log`，健康状态与累计页浏览量均可直接查看；README 徽章使用同一数据源。

---

## 验证

```bash
npm run typecheck
npm run test:scale
npm run test:scenarios
npm run test:ui
npm run test:efficiency
npm run validate:v08
npm run build
```

验证性质说明（不夸大）：

- `typecheck`：TypeScript 严格静态检查；
- `validate:v08`：76 项架构、行为、运行级精确校验与非功能验证；
- `test:scenarios`：44 个目标、复盘、冲突、局部操作与用户效率场景；
- `test:ui`：桌面与手机界面布局静态审计；
- `test:efficiency`：用户效率与统计口径验证；
- `test:scale`：20 个目标、50 个任务组、500 项任务、30 个日期约束的规模夹具；
- `build`：真实 Vite 生产构建。

以上除 `typecheck` 与 `build` 外均为项目内自定义 Node 验证脚本，不是完整单元测试框架，也不提供测试覆盖率数据。

---

## 数据与隐私

- 游客计划保存在独立本地命名空间；
- 登录账号使用独立数据空间，不会静默上传已修改的游客计划；
- 首次登录可选择导入游客计划、使用账号演示计划或从空白开始；
- 云端同步只上传当前可移植状态，不上传重型本地计划版本、旧重排快照或冲突备份；
- 完整计划版本历史仅保存在当前设备，设置页会明确提示。

---

## 文档索引

- [更新日志](docs/CHANGELOG.md)
- [迁移指南](docs/MIGRATION_GUIDE.md)
- [部署说明](docs/DEPLOYMENT.md)

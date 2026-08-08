# Study Planner
> Study Planner is an adaptive, execution-aware study scheduling web app.

Unlike traditional todo lists and static planners, it dynamically
reschedules future study tasks when actual execution differs from the
original plan.

Key features:
- Dynamic rescheduling based on actual progress
- Deadline and capacity-aware scheduling
- Manual intent / locked-task protection
- Multiple rescheduling proposals
- Preview before apply
- Explainable scheduling conflicts
- Recoverable plan versions
- Web / PWA demo
> 目标驱动、可解释、可恢复的动态学习计划系统。
>
> An explainable and recoverable study planning system built around real execution.


## 文档索引

- [更新日志](docs/CHANGELOG.md)
- [迁移指南](docs/MIGRATION_GUIDE.md)
- [部署说明](docs/DEPLOYMENT.md)

## 项目状态

- 当前版本：`v0.8.15`
- 状态：`Active development`（持续迭代）
- 数据：本地优先（IndexedDB），可选 Supabase 账号同步；游客空间独立
- 体验：https://study-planner.yhwlwl.xyz
- 累计访问：![网站累计访问](https://study-planner.yhwlwl.xyz/api/visit-log?format=svg)

## 这是什么

学习计划经常面临"排期与执行脱节"：计划排好后，实际用时、临时缺勤、目标变化都会让原计划失效，而手动调整又容易产生新的冲突。

Study Planner 把「计划生成 — 实际执行 — 复盘 — 冲突处理 — 调整预览」做成完整闭环：所有改动先解释、先预览，确认后才应用到正式计划，并且可以恢复到之前的版本。

## 核心能力

- **目标驱动的计划设计**：Goal 用期望日期（软约束）与最晚日期（硬目标）表达，支持全部 / 百分比 / 数量完成条件；
- **任务与任务组**：任务组定义共享规则（科目、优先级、每日上限、活动类型、强度），单项任务可覆盖标题、时长、备注与锁定状态；
- **日期约束**：不可用、降低容量、特殊容量、受保护缓冲日、日期说明，支持日期范围；
- **Today 执行入口**：完成、部分完成、实际用时记录、专注计时；
- **复盘**：完成率、计划/实际对比、未完成任务逐项决定、基于近期样本的自适应时长建议（只建议，不自动覆盖）；
- **计划调整预览**：变化事件 → 多种可解释方案 → 方案内逐项微调 → 确认应用；
- **冲突可解释**：绝对阻断 / 用户保护 / 可一次性例外 / 目标或结构冲突分类处理，每一项都说明涉及任务、数值与后果；
- **手动意图保护**：锁定任务、手动安排、受保护日期不会被系统静默改写；
- **计划版本与恢复**：重大变化自动保存本地版本，恢复时保留真实执行记录；
- **本地数据与同步边界**：游客与账号数据空间隔离，云端只同步可移植状态；
- **桌面 + 手机 + PWA**：响应式布局，iPhone 可添加到主屏幕使用。

## 设计原则

一个典型的例子：用户只是删除一个任务时，系统的第一方案只应完成删除，而不应未经请求自动调整大量其他任务。

- **User intent first** — 用户明确的操作优先；
- **Minimal-scope changes** — 系统优化后置，不擅自扩大改动范围；
- **Preview before apply** — 任何系统改动先生成可解释方案；
- **Recoverable planning** — 应用后创建可恢复版本；
- **Explainable conflicts** — 区分既有问题与本次新增问题，逐项解释。

## 架构概览

```text
用户操作 / 变化事件 (PlanChangeEvent)
  → 调整策略协调（精确校验 / 推荐预览 / 可选优化 / 探索式优化）
  → 统一调度核心（容量、每日上限、目标期限、手动意图、日期保护）
  → 多方案生成（Web Worker 计算，可取消）
  → 方案预览、逐项微调、冲突决策
  → 应用并记录一次性例外 / 创建计划版本
```

底层只有一套调度引擎；「尽量少改 / 均衡执行 / 目标优先 / 更多休息」四种策略是同一引擎的不同评分取舍，而不是多套重排系统。

## 技术栈

React 18、TypeScript（strict）、Vite、PWA（vite-plugin-pwa）、Supabase、IndexedDB（idb）、Recharts、date-fns、lucide-react。

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

浏览器端不得使用 `service_role` 或 `sb_secret_...`；访问日志所需的高权限密钥只能放在服务端环境变量中，且不能使用 `VITE_` 前缀。 访问计数接口为 `/api/visit-log`，健康状态与累计页浏览量均可直接查看；README 徽章使用同一数据源。

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

## 数据与隐私

- 游客计划保存在独立本地命名空间；
- 登录账号使用独立数据空间，不会静默上传已修改的游客计划；
- 首次登录可选择导入游客计划、使用账号演示计划或从空白开始；
- 云端同步只上传当前可移植状态，不上传重型本地计划版本、旧重排快照或冲突备份；
- 完整计划版本历史仅保存在当前设备，设置页会明确提示。



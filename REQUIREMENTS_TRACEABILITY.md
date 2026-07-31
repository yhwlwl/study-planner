# Study Planner v0.8.4 需求追踪表

本表以最终冻结的 v0.8 架构与验收规格为唯一需求来源。状态含义：

- ✅ 已实现并通过代码级自动验证或严格静态检查。
- 🧪 已实现，仍需在真实依赖、浏览器、iPhone 或 Supabase 环境完成最终运行验收。
- ⛔ 按需求明确延期或排除，未误实现。

## 一、UI 与入口

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| 移除 Today 浮动加号及快捷面板 | ✅ | `src/App.tsx`、`src/styles.css` |
| Today 标题附近添加低干扰“添加任务” | ✅ | `TodayPage` |
| 日期详情添加“添加到这一天” | ✅ | `CalendarPage` |
| 全部任务分离“添加单项任务/创建任务组” | ✅ | `TasksPage` |
| 空计划提供两个清晰入口 | ✅ | `TasksPage` 空状态 |
| Goals 顶级导航页 | ✅ | `GoalsPage`、导航配置 |
| 用户界面不再以“局部修复/全面重排”为主概念 | ✅ | 改为“发生了什么/取舍偏好/调整方案”，内部动作不直接暴露 |
| 复盘摘要优先、图表按需展开 | ✅ | `ReviewDialog` |

## 二、领域模型与迁移

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| Goal、GoalCondition | ✅ | `types.ts`、`goals.ts` |
| 一个任务组关联多个目标 | ✅ | Goal 链接与条件 |
| 目标直接关联特殊 Assignment | ✅ | `linkedAssignmentIds`、目标编辑器 |
| 全部/百分比/数量条件 | ✅ | `requiredCount`、目标 UI |
| 多目标不重复计数 | ✅ | Set 去重的目标与全局统计 |
| Assignment 自定义标题/时长保护 | ✅ | `titleCustomized`、`durationCustomized` |
| 独立任务隐藏单项组 | ✅ | `prepareSingleAssignment`、删除清理 |
| TaskGroup 数量与 Assignment 一致 | ✅ | 生命周期归一化与安全增减 |
| 用户自定义科目/类别 | ✅ | 设置、自定义输入、动态筛选 |
| 统一 CalendarConstraint 范围模型 | ✅ | `CalendarConstraintManager`、`date.ts` |
| PlanChangeEvent | ✅ | `types.ts`、AppContext 准备操作 |
| SchedulingProposal | ✅ | `types.ts`、`planner.ts` |
| PlanVersion | ✅ | `versions.ts`、`db.ts` |
| 移除当前设置中的旧全局目标日期 | ✅ | 设置页已移除，当前调度不再引用 |
| v0.7 确定性无损迁移 | ✅ | `seed.ts` |
| 旧目标字段仅迁移兼容 | ✅ | `types.ts` 注入兼容，当前计算无引用 |

## 三、目标系统

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| 创建、编辑标题和说明 | ✅ | `GoalsPage` |
| 期望日期软约束、最晚日期硬目标 | ✅ | GoalEvaluator、placement validation |
| 具体条件、计入任务、剩余工作可展开 | ✅ | Goal 卡片详情 |
| 显示共享任务组的其他目标 | ✅ | Goal 卡片共享详情 |
| 自动完成、归档、取消归档 | ✅ | 生命周期与 UI |
| 删除目标前影响预览 | ✅ | `prepareGoalDelete` |
| 收紧目标生成目标优先方案 | ✅ | goal-tightening event |
| 放宽目标不自动推迟，提供保持/减负方向 | ✅ | goal-relaxation event + 多偏好方案 |
| 最近相关期限优先，不因目标数量加权 | ✅ | `nearestRelevantGoalDate` |

## 四、创建、编辑与编号

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| 创建任务组并预览排期 | ✅ | `TaskGroupDialog`、Insert |
| 创建为未安排任务 | ✅ | Prepared state without scheduling |
| 单项任务加入现有组 | ✅ | 继承共享规则与目标 |
| 单项任务作为独立任务 | ✅ | 隐藏组模型 |
| 系统安排/偏好日期/锁定日期 | ✅ | `SingleTaskDialog` |
| 指定日期完整放置校验 | ✅ | `checkAssignmentPlacement` |
| 增加缺失子任务只创建新增项 | ✅ | `prepareTaskGroupEdit` |
| 减少数量不删除执行过/锁定/计时任务 | ✅ | protectedIds 安全规则 |
| 组重命名只改自动标题 | ✅ | `titleCustomized` |
| 默认时长只影响未开始、非自定义任务 | ✅ | 任务组预览更新 |
| 移动到另一任务组保留进度和实际用时 | ✅ | 任务详情组切换 |
| 可选择采用新组默认时长 | ✅ | 任务详情确认 |
| 顺序冲突提示并按日期重编号 | ✅ | 继承 `sequence.ts` 并跳过自定义标题 |
| 删除任务与任务组的加强确认/版本 | ✅ | AppContext + UI |
| 任务组自动完成并保留历史 | ✅ | 生命周期 |

## 五、调度与约束

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| Insert/Repair/Optimize/Rebuild 共用核心 | ✅ | `generateSchedulingProposals` |
| 变化原因、动作范围、偏好分离 | ✅ | `PlanChangeEvent` + action + preference |
| 过去冻结、今日半冻结 | ✅ | v0.7 约束核心保留 |
| 今日实际/推定用时消耗容量 | ✅ | actual workload snapshot |
| 完成任务继续计入每日上限 | ✅ | day stats |
| 部分完成使用剩余工作量 | ✅ | `effectiveMinutes` |
| 正在计时任务不可移动 | ✅ | placement/move candidate filtering |
| 手动安排长期保护 | ✅ | `intentStrength`、扰动分数 |
| 锁定任务不可移动 | ✅ | hard constraint |
| 日期保护需明确例外 | ✅ | CalendarConstraint + proposal |
| 每日容量、组上限、活动类型、长任务、高强度 | ✅ | 共用 constraint evaluator |
| 最晚目标条件硬校验 | ✅ | nearest relevant latest date |
| 期望日期软优化 | ✅ | goal preference |
| 无解时如实保留未安排 | ✅ | infeasible proposal |
| 从小范围逐级扩展 | ✅ | local radius/event action |
| 最小扰动包含移动数、距离、手动、日期、负载等 | ✅ | disturbance + proposal metrics |
| 新任务优先零移动，再低扰动，再扩展目标窗口 | ✅ | Insert + preserve first |
| 时长证据只建议提高上限 | ✅ | proposal issue explanation |
| 方案计算可取消 | ✅ | Web Worker terminate |

## 六、可解释方案

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| 所有计数可展开到具体项目 | ✅ | ProposalDialog details |
| 任务前后日期、负载、原因、目标、手动影响 | ✅ | TaskMovement cards |
| 日期前后总分钟和任务集合 | ✅ | DateLoadChange |
| 目标前后进度、预计完成和风险 | ✅ | GoalImpact |
| 问题显示当前/允许/后果/处理 | ✅ | ProposalIssue |
| 解释为什么不选其他日期 | ✅ | rejected alternatives |
| 一次性例外不修改永久默认 | ✅ | exception model/UI |
| 小/中/大影响等级 | ✅ | proposal metrics |
| 稳定度 | ✅ | stability score |
| 更多方案真正不同并去重 | ✅ | distinct signature |
| 手机端垂直前后布局、完整换行 | ✅ | CSS |

## 七、复盘与自适应时长

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| 保留原有未完成任务处理 | ✅ | Today 结束流程未重建 |
| 结束学习或全部完成触发复盘 | ✅ | TodayPage |
| 默认摘要指标 | ✅ | Review summary |
| 每个数量可展开 | ✅ | details |
| 最近 10 个有效可比样本 | ✅ | duration window |
| 样本不足不主动提示 | ✅ | minimumSamples |
| IQR 降低孤立异常值影响 | ✅ | planner |
| 可配置偏差阈值与样本数 | ✅ | Settings |
| 历史只产生建议 | ✅ | Review + prepared event |
| 只改预计/最小优化/更广重组 | ✅ | contextual keep + multi-preference proposals |
| 不改完成历史、实际用时、自定义时长 | ✅ | prepareDurationChange |
| 任务、组、日趋势、完成率、误差、组均值图表 | ✅ | Review charts |
| 不评价质量、正确率、掌握程度 | ✅ | 明确排除 |

## 八、版本、统计、云与游客

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| 重大变化创建版本 | ✅ | AppContext |
| 小文本编辑不创建重型版本 | ✅ | 轻量 commit |
| 恢复前保存当前计划 | ✅ | restore version flow |
| 恢复保护不可变执行记录 | ✅ | `restoreVersionState` |
| 版本差异预览 | ✅ | Settings 版本详情 |
| 当前计划/历史计划统计 | ✅ | Stats perspective |
| 目标统计与多目标去重 | ✅ | Stats + goals |
| 时长统计和建议历史基础 | ✅ | Stats/Review/versions |
| 重型版本本机独立保存 | ✅ | IndexedDB versions key |
| 云端只同步可移植当前状态 | ✅ | state/supabase |
| 本地与云写入合并串行 | ✅ | db/App cloud queue |
| 数字输入失焦提交，避免逐位云写入 | ✅ | NumericInput + settings drafts |
| 游客缓存与账号隔离 | ✅ | namespace |
| 修改游客计划注册时询问导入 | ✅ | onboarding |

## 九、移动端、性能和可靠性

| 需求 | 状态 | 主要实现 |
|---|---:|---|
| iPhone standalone、安全区、Home Indicator | ✅ | Vite PWA + CSS |
| 100dvh 和 iOS 模态适配 | ✅ | CSS |
| 月历手机完整七列 | ✅ | CSS |
| 月/周切换、日期底部抽屉、长按移动 | ✅ | v0.7 基线保留 |
| 无必要横向滚动和右侧溢出 | ✅ | min-width/word-break/overflow rules |
| 大型方案移动端全屏 | ✅ | mobileFullscreen |
| 20 目标/50 组/500 任务/30 约束/10 版本 | ✅ | 自动规模夹具 |
| 普通状态不携带重型版本 | ✅ | portable state |
| 计算失败不修改计划 | ✅ | prepared state + worker |
| 方案应用原子化 | ✅ | hydrate/apply in one state update |
| 恢复失败保持当前状态 | ✅ | restore preview/normalization |
| 实际时间和完成历史不丢失 | ✅ | migration/restore policies |
| 真实 Vite 生产构建 | 🧪 | 当前容器无法从 npm 源取得完整依赖；需在正常网络环境执行 |
| 真实 iPhone PWA 视觉和触控验收 | 🧪 | 代码与 CSS 已完成，需设备验收 |
| 实际 Supabase 登录/同步端到端验收 | 🧪 | 接口和队列已完成，需项目密钥与网络环境 |

## 十、明确延期/排除

| 项目 | 状态 |
|---|---:|
| 独立 Milestone 系统 | ⛔ 按要求不实现 |
| 独立 Execution Drift 模块 | ⛔ 按要求不实现 |
| 独立 AI 时长预测服务 | ⛔ 按要求不实现 |
| AI 自然语言界面 | ⛔ 仅预留 `PlanIntentParser` 接口 |
| 学习质量、正确率、掌握度评价 | ⛔ 按要求不实现 |
| 通用依赖图、自动任务拆分 | ⛔ 延期 |
| 高级重复任务例外模型 | ⛔ 延期 |
| 云端完整重型版本历史 | ⛔ 延期 |
| 正式 Cancelled 生命周期 | ⛔ 延期 |

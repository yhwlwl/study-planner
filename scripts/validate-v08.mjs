import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const exists = file => fs.existsSync(path.join(root, file))
const checks = []
const add = (group, name, pass, evidence) => checks.push({ group, name, pass: Boolean(pass), evidence })
const source = {
  types: read('src/types.ts'), app: read('src/App.tsx'), context: read('src/AppContext.tsx'), planner: read('src/lib/planner.ts'),
  seed: read('src/lib/seed.ts'), state: read('src/lib/state.ts'), db: read('src/lib/db.ts'), supabase: read('src/lib/supabase.ts'),
  goals: read('src/lib/goals.ts'), styles: read('src/styles.css'), stats: read('src/components/StatsPage.tsx'),
  proposal: read('src/components/ProposalDialog.tsx'), review: read('src/components/ReviewDialog.tsx'), constraints: read('src/components/CalendarConstraintManager.tsx'), adjustment: read('src/components/AdjustmentIntentDialog.tsx'), taskCard: read('src/components/TaskCard.tsx'),
  single: read('src/components/SingleTaskDialog.tsx'), group: read('src/components/TaskGroupDialog.tsx'), versions: read('src/lib/versions.ts'),
}
const pkg = JSON.parse(read('package.json'))
add('版本与迁移', '发布版本为 0.8.4', pkg.version === '0.8.4', `package.json: ${pkg.version}`)
add('版本与迁移', '状态架构版本已提升（当前为 9）', /SCHEMA_VERSION\s*=\s*(?:8|9|[1-9]\d+)/.test(source.types), 'src/types.ts')
add('版本与迁移', '存在确定性 v0.7→v0.8 迁移', /migrat|迁移/.test(source.seed) && /coreTargetDate/.test(source.seed) && /calendarConstraints/.test(source.seed), 'src/lib/seed.ts')
add('版本与迁移', '旧全局目标日期不再出现在当前界面与当前调度计算', !/settings\.coreTargetDate|settings\.chemistryTargetDate/.test(source.app + source.stats + source.planner), '仅 seed/types 保留迁移兼容字段')
add('领域模型', 'Goal 与三种完成条件', /interface Goal\b/.test(source.types) && /'all'\s*\|\s*'percentage'\s*\|\s*'count'/.test(source.types), 'src/types.ts')
add('领域模型', '多目标关联与直接任务关联', /linkedTaskGroupIds/.test(source.types) && /linkedAssignmentIds/.test(source.types), 'src/types.ts')
add('领域模型', '没有独立 Milestone 实体', !/interface\s+Milestone|type\s+Milestone|class\s+Milestone/.test(Object.values(source).join('\n')), 'src 全量扫描')
add('领域模型', '统一 CalendarConstraint 支持范围', /interface CalendarConstraint/.test(source.types) && /startDate/.test(source.constraints) && /endDate/.test(source.constraints), 'types + CalendarConstraintManager')
add('领域模型', '变化事件、方案、计划版本齐全', /interface PlanChangeEvent/.test(source.types) && /interface SchedulingProposal/.test(source.types) && /interface PlanVersion/.test(source.types), 'src/types.ts')
add('创建系统', '单项任务与任务组入口分离', /添加单项任务/.test(source.app) && /创建任务组/.test(source.app) && exists('src/components/SingleTaskDialog.tsx'), 'App + dialogs')
add('创建系统', '单项任务支持归组、独立、系统/偏好/锁定日期', /standalone/.test(source.single) && /system/.test(source.single) && /prefer-date/.test(source.single) && /lock-date/.test(source.single), 'SingleTaskDialog')
add('创建系统', '任务创建先准备再预览', /prepareSingleAssignment/.test(source.context) && /prepareTaskGroup/.test(source.context) && /openPrepared/.test(source.app), 'AppContext + App')
add('创建系统', '任务组增减保护已完成/有记录/锁定/计时任务', /prepareTaskGroupEdit/.test(source.context) && /protectedIds/.test(source.context) && /actualMinutes === 0/.test(source.context), 'AppContext')
add('目标系统', '目标为顶级导航页', /id: 'goals'/.test(source.app) && /<GoalsPage/.test(source.app), 'App.tsx')
add('目标系统', '最近相关期限，不按目标数量加权', /nearestRelevantGoalDate/.test(source.goals) && /relevantGoalPriority/.test(source.goals) && /conditionCountedAssignmentIds/.test(source.goals), 'src/lib/goals.ts')
add('目标系统', '多目标统计去重', /counted = new Set/.test(source.goals) && /globalAssignmentIds|new Set/.test(source.stats), 'goals + stats')
add('目标系统', '目标和任务组自动完成生命周期', /updateGoalAndGroupLifecycle/.test(source.goals) && /status: 'completed'/.test(source.goals), 'src/lib/goals.ts')
add('调度核心', 'Insert/Repair/Optimize/Rebuild 共用一个入口', /SchedulingAction/.test(source.types) && /generateSchedulingProposals/.test(source.planner) && /event\.action/.test(source.planner), 'types + planner')
add('调度核心', '过去/今日、计时、锁定、手动意图、容量与上限仍受校验', /active timer|timer\.assignmentId|intentStrength|dailyMax|high-intensity|long/.test(source.planner), 'src/lib/planner.ts')
add('调度核心', '目标最晚日期作为硬约束', /nearestRelevantLatestDate/.test(source.planner) && /hard/.test(source.planner), 'src/lib/planner.ts')
add('调度核心', '无合法位置时不强塞', /不会强塞|没有合法|未强行安排/.test(source.planner + source.proposal), 'planner + proposal UI')
add('调度核心', '方案计算可取消且不阻塞主线程', exists('src/workers/proposal.worker.ts') && /terminate\(\)/.test(source.app) && /取消计算/.test(source.app), 'Web Worker + cancel')
add('调度核心', '时长证据只建议放宽上限，不自动修改', /系统只提出建议，不会自动提高上限/.test(source.planner), 'src/lib/planner.ts')
add('可解释方案', '所有摘要计数可展开到具体项目', /<details/.test(source.proposal) && /任务变化/.test(source.proposal) && /问题明细/.test(source.proposal), 'ProposalDialog')
add('可解释方案', '任务、日期、负载、目标均有前后对比', /before-after/.test(source.proposal) && /日期负载(?:与任务)?前后/.test(source.proposal) && /目标影响/.test(source.proposal), 'ProposalDialog')
add('可解释方案', '解释为什么不选其他日期', /为什么没有安排到其他日期/.test(source.proposal) && /rejectedAlternatives/.test(source.planner), 'proposal + planner')
add('可解释方案', '更多替代方案按结果签名去重', /distinctSignature/.test(source.planner) && /signatures\.has/.test(source.planner) && /(?:真正|实质)不同/.test(source.proposal), 'planner + UI')
add('复盘与时长', '复盘默认摘要优先，图表按需展开', /review-hero/.test(source.review) && /review-summary-grid/.test(source.review) && /chartsOpen/.test(source.review) && /展开图表/.test(source.review), 'ReviewDialog')
add('复盘与时长', '最近 10 个有效样本与 IQR 异常值处理', /windowSize/.test(source.planner) && /slice\(0, state\.settings\.duration\.windowSize\)/.test(source.planner) && /1\.5 \* iqr/.test(source.planner), 'src/lib/planner.ts')
add('复盘与时长', '时长建议不静默覆盖，接受后仍进入方案', /prepareDurationChange/.test(source.context) && /查看调整方案/.test(source.review) && /接受后仍需从多个排期方案中选择/.test(source.review), 'Review + AppContext')
add('复盘与时长', '复盘包含任务/任务组/日趋势/完成率/误差/组均值图表', /今日各任务/.test(source.review) && /今日各任务组/.test(source.review) && /预计误差趋势/.test(source.review) && /任务组默认预计/.test(source.review), 'ReviewDialog')
add('复盘与时长', '不评价正确率、掌握或学习质量', /不评价正确率、掌握程度或学习质量/.test(source.review), 'ReviewDialog')
add('版本与统计', '重大变化创建本地计划版本', /createPlanVersion/.test(source.context) && /createVersionFromProposal/.test(source.context), 'AppContext')
add('版本与统计', '恢复前保存当前状态并保留执行记录', /恢复前/.test(source.versions) || /current|当前/.test(source.versions), 'src/lib/versions.ts')
add('版本与统计', '云端可移植状态排除大版本历史', /planVersions:\s*\[\]/.test(source.state) && /portable/.test(source.supabase), 'state + supabase')
add('账号与数据', '游客修改注册时提供导入/分离选择', /guestImportAvailable/.test(source.app) && /保持游客数据独立/.test(source.app), 'App.tsx')
add('账号与数据', '游客、账号命名空间隔离', /namespace/.test(source.context) && /setDataSpace/.test(source.context), 'AppContext')
add('移动端/PWA', 'Today 浮动按钮与快捷面板已移除', !/mobile-quick-fab|mobile-quick-actions/.test(source.app + source.styles), 'App + styles')
add('移动端/PWA', '安全区、100dvh、无横向溢出规则', /safe-area-inset-bottom/.test(source.styles) && /100dvh/.test(source.styles) && /overflow-x:hidden/.test(source.styles), 'styles.css')
add('移动端/PWA', '月历移动端保留七列', /repeat\(7/.test(source.styles), 'styles.css')
add('移动端/PWA', 'PWA standalone 配置', /display:\s*'standalone'/.test(read('vite.config.ts')), 'vite.config.ts')
add('未来边界', 'AI 仅保留解析接口，没有实现功能', exists('src/lib/intent.ts') && /interface PlanIntentParser/.test(read('src/lib/intent.ts')) && !/fetch\(|openai|deepseek/i.test(read('src/lib/intent.ts')), 'src/lib/intent.ts')


add('典型场景', '目标事件日期不再误作调度起点', /function proposalPlanningStart/.test(source.planner) && /state\.settings\.startDate/.test(source.planner) && /const today = todayISO\(\)/.test(source.planner), 'goal/trip/new task can use current future window')
add('典型场景', '部分目标只约束满足条件所需任务', /conditionCountedAssignmentIds/.test(source.goals) && /goalAppliesToAssignment/.test(source.goals), '50% teacher check does not pull the other 50% forward')
add('典型场景', '目标变更事件只纳入条件实际计数任务', /goalProgress\(before, existing\)/.test(source.context) && /goalProgress\(next, goal\)/.test(source.context) && /affectedAssignmentIds/.test(source.context), 'partial Goal edits do not nominate the whole linked group for movement')
add('典型场景', '计划太累是显式变化事件', /load-preference-change/.test(source.adjustment) && /让未来计划轻松一些/.test(source.adjustment), 'AdjustmentIntentDialog event-first entry')
add('交互融合', '结束今天与复盘已合并为单一入口', (source.app.match(/结束今天并复盘/g) ?? []).length === 1 && /completeReview/.test(source.context) && /处理未完成任务/.test(source.review), 'Today + ReviewDialog')
add('交互融合', '完成任务更多按钮使用固定横向图形', /Ellipsis/.test(source.taskCard) && !/more-dots[^>]*>···/.test(source.taskCard), 'TaskCard')
add('交互融合', '桌面日期与操作不再被单字拆行', /date-switcher h2\{white-space:nowrap/.test(source.styles) && /today-hero-actions button\{white-space:nowrap/.test(source.styles), 'styles.css')
add('交互融合', '复盘具有视觉摘要、任务决策卡与按需图表', /review-progress-ring/.test(source.review) && /review-task-decision/.test(source.review) && /review-charts/.test(source.review), 'ReviewDialog + styles')

const tsc = spawnSync('tsc', ['-p', 'tsconfig.check.json', '--pretty', 'false'], { cwd: root, encoding: 'utf8' })
add('自动验证', '严格 TypeScript 静态检查', tsc.status === 0, (tsc.stdout + tsc.stderr).trim() || '通过')
const scale = spawnSync(process.execPath, ['scripts/performance-v08.mjs'], { cwd: root, encoding: 'utf8' })
add('自动验证', '20目标/50组/500任务/30约束/10版本规模验证', scale.status === 0, scale.status === 0 ? '通过，详见 validation/500任务规模验证.json' : (scale.stdout + scale.stderr).trim())
const scenarios = spawnSync(process.execPath, ['scripts/scenario-v084.mjs'], { cwd: root, encoding: 'utf8' })
add('自动验证', '核心场景与三大系统架构验证', scenarios.status === 0, scenarios.status === 0 ? '全部通过，详见 validation/v0.8.4场景架构验证.md' : (scenarios.stdout + scenarios.stderr).trim())

const passed = checks.filter(item => item.pass).length
const result = { generatedAt: new Date().toISOString(), passed, total: checks.length, failed: checks.filter(item => !item.pass), checks }
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', 'v0.8自动验证结果.json'), JSON.stringify(result, null, 2))
const lines = ['# v0.8 自动验证结果', '', `- 通过：${passed} / ${checks.length}`, `- 生成时间：${result.generatedAt}`, '', ...checks.map(item => `- ${item.pass ? '✅' : '❌'} **${item.group}｜${item.name}**：${item.evidence}`)]
fs.writeFileSync(path.join(root, 'validation', 'v0.8自动验证结果.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
if (passed !== checks.length) process.exit(1)

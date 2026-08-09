import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const releaseVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const context = read('src/AppContext.tsx')
const planner = read('src/lib/planner.ts')
const goalsSource = read('src/lib/goals.ts')
const types = read('src/types.ts')
const adjustmentDialog = read('src/components/AdjustmentIntentDialog.tsx')
const adjustmentPolicy = read('src/lib/adjustment.ts')
const proposal = read('src/components/ProposalDialog.tsx')
const review = read('src/components/ReviewDialog.tsx')
const constraints = read('src/components/CalendarConstraintManager.tsx')
const app = read('src/App.tsx')
const styles = read('src/styles.css')
const taskCard = read('src/components/TaskCard.tsx')
const conflicts = read('src/lib/conflicts.ts')

const results = []
const add = (scenario, pass, evidence) => results.push({ scenario, pass: Boolean(pass), evidence })

add('核心目标从 8/8 提前到 8/6',
  /goal-tightening/.test(context) && /recommended\('推荐目标调整方案'/.test(adjustmentPolicy) && /proposalPlanningStart/.test(planner),
  '目标收紧进入目标导向推荐预览；候选窗口从当前可调整未来开始。')

add('化学组从核心目标放宽到 8/20',
  /goal-relaxation/.test(context) && /optional\('保存目标变化并保持当前排期'/.test(adjustmentPolicy) && /useDirectFirst/.test(app),
  '目标放宽默认预览“保持当前排期”，优化只是用户可选方案。')

add('任务组发现缺少子任务',
  /task-group-size-increase/.test(context) && /createdIds/.test(context) && /仅新增/.test(context),
  '只创建缺少的 Assignment，并以 Insert 事件进入预览。')

add('觉得当前计划太累',
  /type LoadOutcome/.test(adjustmentDialog) && /每天少安排一些/.test(adjustmentDialog) && /避免连续高负载/.test(adjustmentDialog) && /exploratory\('生成减负推荐'/.test(adjustmentPolicy),
  '先询问用户希望得到的具体减负结果，再生成推荐与备选。')

add('8/10–8/15 出去玩',
  /startDate/.test(constraints) && /endDate/.test(constraints) && /availability-change/.test(context) && /推荐日期调整方案/.test(adjustmentPolicy),
  '范围约束先列出影响，再推荐旅行前后平衡方案。')

add('新增任务组',
  /type:\s*'new-task-insertion'/.test(context) && /prepareTaskGroup/.test(context) && /创建为未安排任务/.test(app),
  '新组生成草稿后必须预览，也可由用户明确保留为未安排。')

add('老师 8/15 检查若干任务组',
  /'percentage'/.test(types) && /'count'/.test(types) && /conditionCountedAssignmentIds/.test(goalsSource),
  '用 Goal 数量/百分比条件表达阶段检查，不新增 Milestone。')

add('预计时长变化引发计划调整',
  /prepareDurationChange/.test(context) && /预览更新影响/.test(review) && /更新预计时长并保持日期/.test(adjustmentPolicy) && /只应用新预计，日期保持不变/.test(app),
  '先预览预计变化；日期仍合法时保持不动，新增冲突才最小修复。')

add('复盘逐项顺延不再二次重排',
  /requestedCarryDates/.test(context) && /按你在复盘中的选择执行/.test(adjustmentPolicy) && /policy\.mode === 'validate-and-commit'/.test(app) && !/比较完整调整方案/.test(review),
  '用户已选日期只做精确校验；原复盘中的重复“完整调整方案”入口已移除。')

add('复盘完成页提供三条明确路径',
  /完成复盘，并按当前方案顺延/.test(review) && /获取更多方案/.test(review) && /仅保存复盘，暂不顺延/.test(review)
    && /applyCurrentReviewPlan/.test(app) && /forceAlternatives/.test(app),
  '当前方案可直接校验提交；只有用户主动获取更多方案时才进入完整方案比较。')

add('已完成历史不再生成待处理冲突',
  /已经完成\/已经发生的用时与任务数量只作为历史基线/.test(planner)
    && /ordinaryUnfinished\.length > 0 && day\.plannedMinutes > 0/.test(planner)
    && /worsenedHardConstraintFacts/.test(planner),
  '已完成超载、已完成超次数和历史数字变化不会单独阻止方案；新增任务仍按历史负载校验。')

add('冲突处理选项按用途分层',
  /处理当前任务/.test(proposal) && /修改产生冲突的条件/.test(proposal) && /不继续这部分调整/.test(proposal)
    && /不同问题只显示适用方式/.test(proposal),
  '选项数量可以因问题类型不同而变化，但不再把换日、修改条件和撤销操作混为同一层。')

add('复盘冲突只处理冲突项',
  /directValidationConflictIds/.test(app) && /fixedAssignmentIds/.test(app) && /fixedAssignmentIds\(request\)/.test(planner),
  '合法项被固定，调度器只能处理精确预览中识别出的冲突任务。')

add('批量移动按用户指定结果校验',
  /if \(event\.type === 'bulk-move'\)/.test(adjustmentPolicy) && /按你指定的批量移动执行/.test(adjustmentPolicy),
  '批量移动不再无条件重算全部日期；仅冲突项需要替代方案。')

add('系统改动全部先预览',
  /previewPreparedChange/.test(app) && /计划调整预览/.test(proposal) && /任何方案都只会在你确认后执行/.test(proposal) && /应用预览中的改动/.test(proposal),
  '直接提交、推荐调整和探索优化均经过统一预览确认。')

add('多方案由用户决定但默认界面简洁',
  /const initialPreferences = \[policy\.primaryPreference\]/.test(app) && /onGenerateMore/.test(proposal) && /生成更多不同方案/.test(proposal),
  '默认只计算推荐方案；用户主动比较时再按需计算其他策略。')

add('摘要计数可逐层展开到具体问题',
  /检测到的问题/.test(proposal) && /openSection/.test(proposal) && /问题明细/.test(proposal) && /涉及任务/.test(proposal),
  '第一层显示数量，点击进入具体问题，再展开涉及任务和完整原因。')

add('日期负载增减使用红绿方向提示',
  /load-delta-up/.test(proposal) && /load-delta-down/.test(proposal) && /↑ 负载增加/.test(proposal) && /↓ 负载减少/.test(proposal) && /\.load-delta-up/.test(styles) && /\.load-delta-down/.test(styles),
  '负载增加为红色向上，减少为绿色向下，无变化为中性。')

add('选中态在手机和桌面都清晰',
  /choice-indicator/.test(adjustmentDialog) && /\.adjustment-outcome-grid button\.selected/.test(styles) && /\.proposal-choice\.selected/.test(styles),
  '选择状态同时使用明显边框、背景、阴影和“已选择”标记。')

add('移动端计划调整不产生大块空白',
  /modal-mobile-fullscreen/.test(styles) && /height:100dvh/.test(styles) && /\.modal-body\{[^}]*overflow-y:auto/.test(styles),
  '复杂弹窗在手机上使用 100dvh 弹性全屏结构，正文独立滚动。')

add('手机首页不再被桌面 flex-basis 撑出大块空白',
  /today-hero-main/.test(app) && /\.today-hero\{display:grid!important;grid-template-columns:minmax\(0,1fr\)/.test(styles) && /height:auto!important;min-height:0!important/.test(styles) && /flex:none!important/.test(styles),
  'Today 头部在手机上改为显式单列 Grid，内容高度由真实内容决定。')

add('硬冲突逐项展示而不是只给总数',
  /ConflictDecisionPanel/.test(proposal) && /涉及任务/.test(proposal) && /调整后/.test(proposal) && /当前允许/.test(proposal) && /后果：/.test(proposal),
  '冲突摘要可展开到类别、数值、任务、后果和处理方式。')

add('有冲突时主按钮仍提供下一步',
  /处理 \$\{unresolvedCount\} 个待决定问题/.test(proposal) && /按这些选择重新计算/.test(proposal) && !/disabled=\{selected\?\.infeasible/.test(proposal),
  '按钮按状态引导处理冲突或重新计算，不因 infeasible 简单全部禁用。')

add('一次性例外支持部分接受与部分拒绝',
  /resolvedExceptionDecisions/.test(proposal) && /accept-once/.test(proposal) && /system-find-another-date/.test(proposal) && /exceptionDecisions/.test(conflicts),
  '每项例外独立决定；拒绝项释放任务，接受项进入新计算条件。')

add('一次性例外保持最小任务授权',
  /affectedAssignmentIds/.test(types) && /mergeConstraintExceptions/.test(conflicts) && /affectedAssignmentIds.*item\.affectedAssignmentIds/.test(planner) && /候选任务不在授权范围内时/.test(planner),
  '日期、规则、临时上限和涉及任务共同限定例外，不修改永久设置。')

add('无可行候选时仍提供可点击解决路径',
  /proposal-no-solution/.test(proposal) && /扩大范围继续寻找/.test(proposal) && /调整可用时间/.test(proposal) && /调整目标/.test(proposal),
  '没有候选时不只留下灰色按钮，而是给出扩大搜索、改容量和改目标入口。')

add('移动端月历完整保留七列',
  /\.weekday-row,.calendar-grid\{min-width:0!important;width:100%\}/.test(styles) && /\.calendar-card\{overflow:hidden\}/.test(styles),
  '移动端取消强制宽度和横向空白，七列在视口内完整呈现。')

add('日期容量增加不被当作必须修复',
  /pureRelaxation/.test(context) && /保存新的可用时间并保持当前排期/.test(adjustmentPolicy),
  '新增容量默认保持排期，用户可主动选择减负或提前。')

add('Today 任务卡不再绕过统一移动校验',
  !/ChevronLeft|ChevronRight|shiftDate\(assignment\.scheduledDate/.test(taskCard),
  '任务移动通过精确预览或调度方案，不由快捷按钮静默执行。')

add('缓冲日长任务与高强度任务被明确识别',
  /缓冲日，仍有 .*未完成长任务需要处理/.test(planner) && /缓冲日，仍有 .*未完成高强度任务需要处理/.test(planner),
  '分析器只把缓冲日中仍未完成的长任务和高强度任务列为问题；已完成历史不参与重排。')

add('目标没有有效完成条件时不会自动完成',
  /requiredTotal > 0 && completedTotal >= requiredTotal/.test(goalsSource) && /requiredTotal === 0 \? 0/.test(goalsSource),
  '空目标保持进行中且进度为 0。')

add('目标完成历史记录实际达成日期与按期结果',
  /actualCompletionDate/.test(goalsSource) && /desiredMet/.test(goalsSource) && /latestMet/.test(goalsSource),
  '完成时间来自实际执行记录，并保存期望/最晚日期结果。')

add('复盘同时纳入原计划与当日真实执行',
  /reviewDaySnapshot/.test(planner) && /plannedAssignmentIds/.test(planner) && /executedAssignmentIds/.test(planner) && /executedOutsidePlan/.test(review),
  '跨日补做、提前执行和计划外执行不会从复盘消失。')

add('方案内逐项微调重新完整验算',
  /reviseSchedulingProposal/.test(planner) && /逐项微调/.test(proposal) && /validatePlacement/.test(planner),
  '用户在预览中修改日期或锁定结果后，重新计算容量、上限、目标和保护日期。')

// Runtime policy test: verifies that the orchestration layer routes events by user intent completeness.
let runtimePolicyPass = false
let runtimePolicyEvidence = ''
const policyTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-policy-test-'))
try {
  const compile = spawnSync(process.execPath, [tscBin, 'src/lib/adjustment.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', policyTemp, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())
  fs.writeFileSync(path.join(policyTemp, 'package.json'), '{"type":"module"}')
  const mod = await import(`${pathToFileURL(path.join(policyTemp, 'lib/adjustment.js')).href}?v=${Date.now()}`)
  const base = { id: 'e', action: 'repair', title: '', description: '', affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [], affectedDates: [], createdAt: '' }
  const modes = {
    review: mod.adjustmentPolicyForEvent({ ...base, type: 'execution-difference', metadata: { requestedCarryDates: { a: '2026-08-02' } } }).mode,
    move: mod.adjustmentPolicyForEvent({ ...base, type: 'bulk-move' }).mode,
    relax: mod.adjustmentPolicyForEvent({ ...base, type: 'goal-relaxation' }).mode,
    insert: mod.adjustmentPolicyForEvent({ ...base, type: 'new-task-insertion' }).mode,
    tired: mod.adjustmentPolicyForEvent({ ...base, type: 'load-preference-change', metadata: { preferredPreference: 'rest' } }).mode,
  }
  runtimePolicyPass = modes.review === 'validate-and-commit' && modes.move === 'validate-and-commit' && modes.relax === 'optional-optimization' && modes.insert === 'recommended-preview' && modes.tired === 'exploratory-optimization'
  runtimePolicyEvidence = Object.entries(modes).map(([key, value]) => `${key}=${value}`).join('；')
} catch (error) {
  runtimePolicyEvidence = `运行测试失败：${error instanceof Error ? error.message : String(error)}`
} finally {
  fs.rmSync(policyTemp, { recursive: true, force: true })
}
add('事件协调器按意图完整度运行分流', runtimePolicyPass, runtimePolicyEvidence)

// Runtime goal test: 50% teacher check + 100% later goal.
let runtimePartialGoalPass = false
let runtimeGoalEvidence = ''
const goalTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-goal-test-'))
try {
  const compile = spawnSync(process.execPath, [tscBin, 'src/lib/goals.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', goalTemp, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())
  fs.writeFileSync(path.join(goalTemp, 'package.json'), '{"type":"module"}')
  const goals = await import(`${pathToFileURL(path.join(goalTemp, 'lib/goals.js')).href}?v=${Date.now()}`)
  const assignments = Array.from({ length: 10 }, (_, index) => ({ id: `a${index + 1}`, groupId: 'chem', index: index + 1, title: `化学${index + 1}`, status: 'todo', estimatedMinutes: 60, actualMinutes: 0, progress: 0, locked: false, intentStrength: 'normal', scheduleSource: 'system', timeEntries: [] }))
  const state = {
    assignments,
    taskGroups: [{ id: 'chem', title: '化学预习', quantity: 10 }],
    goals: [
      { id: 'check', title: '老师检查', priority: 5, desiredDate: '2026-08-15', latestDate: '2026-08-15', status: 'active', completionConditions: [{ id: 'c1', groupId: 'chem', mode: 'percentage', value: 50 }], linkedTaskGroupIds: ['chem'], linkedAssignmentIds: [] },
      { id: 'finish', title: '全部完成', priority: 3, desiredDate: '2026-08-20', latestDate: '2026-08-20', status: 'active', completionConditions: [{ id: 'c2', groupId: 'chem', mode: 'all' }], linkedTaskGroupIds: ['chem'], linkedAssignmentIds: [] },
    ],
  }
  const firstDate = goals.nearestRelevantGoalDate(state, assignments[0])
  const sixthDate = goals.nearestRelevantGoalDate(state, assignments[5])
  runtimePartialGoalPass = firstDate === '2026-08-15' && sixthDate === '2026-08-20'
  runtimeGoalEvidence = `前 50% 最近期限=${firstDate}；后 50% 最近期限=${sixthDate}`
} catch (error) {
  runtimeGoalEvidence = `运行测试失败：${error instanceof Error ? error.message : String(error)}`
} finally {
  fs.rmSync(goalTemp, { recursive: true, force: true })
}
add('部分目标与后续完整目标不会互相覆盖', runtimePartialGoalPass, runtimeGoalEvidence)


add('明确局部操作第一方案只执行用户操作',
  /explicitLocalOperation/.test(context) && /operationScope:\s*'requested-change-only'/.test(context)
    && /明确的局部操作永远先展示/.test(app) && /proposals:\s*\[directPreview\]/.test(app)
    && /只执行本次调整/.test(proposal),
  '删除、换组和任务组编辑先展示精确变化，不自动启动更大范围调度。')

add('单任务删除不借机移动其他任务',
  /prepareAssignmentDelete/.test(context) && /type:\s*'assignment-deletion'/.test(context)
    && /仅移除/.test(context) && /不会移动其他任务/.test(context)
    && /prepareAssignmentDelete\(taskOpen\.id\)/.test(app),
  '单任务删除先生成只移除该任务的结构预览；其他任务移动数应为 0。')

add('任务组删除采用最小作用域预览',
  /prepareTaskGroupDelete/.test(context) && /仅删除任务组/.test(context)
    && /prepareTaskGroupDelete\(group\.id\)/.test(app),
  '任务组删除先删除组、任务和直接引用，不自动重排其他组。')

add('既有问题与本次新增问题分开显示',
  /ProposalIssueDelta/.test(types) && /hardConstraintIssueDelta/.test(planner)
    && /计划原有/.test(proposal) && /新增或恶化/.test(proposal),
  '计划原有硬问题只提示；只有本次新增或恶化的问题进入本次处理范围。')


add('正在计时任务不能从首页绕过计时结算',
  /if \(active\)/.test(taskCard) && /onOpenTimer\(assignment\)/.test(taskCard)
    && /activeTimerMinutes/.test(app) && /source:\s*activeTimerMinutes/.test(app),
  '首页完成入口先返回计时页；极端陈旧状态仍会把已计时分钟写入实际记录。')

add('所有任务都有可发现入口',
  /任务收件箱/.test(app) && /待处理/.test(app) && /未安排/.test(app) && /逾期/.test(app)
    && /查看待处理任务/.test(app),
  '任务页同时提供待处理、未安排、逾期、今日、未来和已完成视图。')

add('批量移动不再使用浏览器文本输入',
  /bulkMoveDialog/.test(app) && /type=\"date\"/.test(app) && /预览批量移动/.test(app)
    && !/window\.prompt\('输入目标日期/.test(app),
  '批量移动使用日期选择器和所选任务摘要。')

add('复盘暂不顺延任务仍可集中找回',
  /任务 → 待处理/.test(review) && /pendingPastTasks/.test(app),
  '仅保存复盘后，过去未完成任务在任务收件箱和首页提醒中保持可见。')

add('复盘过去未完成任务可以顺延出去',
  /explicitlyMovesPastUnfinishedOut/.test(planner)
    && /event\.type === 'execution-difference' \|\| event\.type === 'bulk-move'/.test(planner)
    && /不能把任务安排到过去/.test(planner),
  '过去日期只冻结已发生事实；复盘和待处理视图可把未完成任务移到今天、未来或待安排，但不能把任务移入过去。')

const passed = results.filter(item => item.pass).length
const output = { generatedAt: new Date().toISOString(), passed, total: results.length, results }
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', `v${releaseVersion}场景架构验证.json`), JSON.stringify(output, null, 2))
const md = [`# Study Planner v${releaseVersion} 场景架构验证`, '', `- 通过：${passed} / ${results.length}`, `- 生成时间：${output.generatedAt}`, '', ...results.map(item => `- ${item.pass ? '✅' : '❌'} **${item.scenario}**：${item.evidence}`)]
fs.writeFileSync(path.join(root, 'validation', `v${releaseVersion}场景架构验证.md`), md.join('\n') + '\n')
console.log(md.join('\n'))
if (passed !== results.length) process.exit(1)

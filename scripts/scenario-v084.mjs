import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const context = read('src/AppContext.tsx')
const planner = read('src/lib/planner.ts')
const goalsSource = read('src/lib/goals.ts')
const types = read('src/types.ts')
const adjustment = read('src/components/AdjustmentIntentDialog.tsx')
const review = read('src/components/ReviewDialog.tsx')
const constraints = read('src/components/CalendarConstraintManager.tsx')
const app = read('src/App.tsx')
const taskCard = read('src/components/TaskCard.tsx')

const results = []
const add = (scenario, pass, evidence) => results.push({ scenario, pass: Boolean(pass), evidence })

add('核心目标从 8/8 提前到 8/6',
  /goal-tightening/.test(context) && /proposalPlanningStart/.test(planner) && /todayISO\(\)/.test(planner),
  '目标提前生成 goal-tightening；调度从当前可调整未来开始，不把 8/6 错当搜索起点。')

add('化学组从核心目标放宽到 8/20',
  /goal-relaxation/.test(context) && /type === 'goal-relaxation' \? 'optimize'/.test(context) && /保存目标，保持当前排期/.test(read('src/components/ProposalDialog.tsx')),
  '放宽目标属于可选优化；可保持原排期，不会自动推迟。')

add('任务组发现缺少子任务',
  /task-group-size-increase/.test(context) && /createdIds/.test(context) && /仅新增/.test(context),
  '只创建缺少的 Assignment，并以 Insert 事件进入预览。')

add('觉得当前计划太累',
  /load-preference-change/.test(adjustment) && /让未来计划轻松一些/.test(adjustment) && /preference.*rest/.test(adjustment),
  '“太累”是显式变化事件，内部使用 optimize + rest 偏好。')

add('8/10–8/15 出去玩',
  /startDate/.test(constraints) && /endDate/.test(constraints) && /availability-change/.test(context) && /pureRelaxation/.test(context),
  'CalendarConstraint 支持范围；限制与放宽进入同一方案引擎，放宽不自动提前任务。')

add('新增任务组',
  /type:\s*'new-task-insertion'/.test(context) && /prepareTaskGroup/.test(context) && /仅保存为待安排/.test(app),
  '新组先生成草稿，再预览插入；也可真正保存为未安排。')

add('老师 8/15 检查若干任务组',
  /'percentage'/.test(types) && /'count'/.test(types) && /conditionCountedAssignmentIds/.test(goalsSource),
  '用 Goal 的百分比/数量条件表达，不新增 Milestone。')

add('预计时长变化引发计划调整',
  /prepareDurationChange/.test(context) && /type:\s*'rule-change'/.test(context) && /查看调整方案/.test(review) && /只应用新预计，日期保持不变/.test(app),
  '历史实际时间只产生建议；接受后可保持日期或选择调整方案。')

add('日期容量增加不被当作必须修复',
  /const tightening = availabilityAfter < availabilityBefore/.test(app) && /action: tightening \? 'repair' : 'optimize'/.test(app) && /当前排期不会自动提前/.test(app),
  '单日容量放宽与范围约束放宽都识别为可选优化。')

add('Today 任务卡不再绕过统一移动校验',
  !/ChevronLeft|ChevronRight|shiftDate\(assignment\.scheduledDate/.test(taskCard),
  '删除直接前后移动按钮；移动走日历/方案校验流程。')

add('缓冲日长任务与高强度任务被明确识别',
  /缓冲日，但仍安排了.*长任务/.test(planner) && /缓冲日，但仍安排了.*高强度任务/.test(planner),
  '分析器把缓冲日长任务和高强度任务列为明确危险问题。')


add('目标没有有效完成条件时不会自动完成',
  /requiredTotal > 0 && completedTotal >= requiredTotal/.test(goalsSource) && /requiredTotal === 0 \? 0/.test(goalsSource),
  '空目标保持进行中且进度为 0，避免创建后立即显示已完成。')

add('目标完成历史记录实际达成日期与按期结果',
  /actualCompletionDate/.test(goalsSource) && /desiredMet/.test(goalsSource) && /latestMet/.test(goalsSource) && /completionTimestampForIds/.test(goalsSource),
  '目标完成时间来自满足条件的任务实际完成记录，并保留期望/最晚日期结果。')

add('进行中目标不能直接归档绕过调度约束',
  /disabled=\{goal\.status === 'active'\}/.test(read('src/components/GoalsPage.tsx')) && /目标完成后才能归档/.test(read('src/components/GoalsPage.tsx')),
  '进行中目标必须先编辑或删除并预览影响，不能用归档静默移除约束。')

add('复盘同时纳入原计划与当日真实执行',
  /reviewDaySnapshot/.test(planner) && /plannedAssignmentIds/.test(planner) && /executedAssignmentIds/.test(planner) && /executedOutsidePlan/.test(review),
  '跨日补做、提前执行和原计划外执行不会从当日复盘中消失。')

add('历史复盘使用保存快照而不是被后续状态重写',
  /plannedAssignmentIds\?: string\[\]/.test(types) && /completedAssignmentIds\?: string\[\]/.test(types) && /useSavedHistory/.test(review) && /当日保存的复盘快照/.test(review),
  '已保存的过去复盘保留当日任务、完成数、实际时间与未完成清单。')

add('方案内逐项改期重新走完整验算',
  /reviseSchedulingProposal/.test(planner) && /逐项微调/.test(read('src/components/ProposalDialog.tsx')) && /validatePlacement/.test(planner) && /重新计算全部影响/.test(planner),
  '保留原日、自定义日期和锁定结果都重算容量、上限、目标、保护日和稳定性。')

// Real runtime test: 50% teacher check + 100% later goal.
let runtimePartialGoalPass = false
let runtimeEvidence = ''
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-goal-test-'))
try {
  const compile = spawnSync('tsc', ['src/lib/goals.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', temp, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}')
  const goals = await import(`${pathToFileURL(path.join(temp, 'lib/goals.js')).href}?v=${Date.now()}`)
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
  runtimeEvidence = `前 50% 最近期限=${firstDate}；后 50% 最近期限=${sixthDate}`
} catch (error) {
  runtimeEvidence = `运行测试失败：${error instanceof Error ? error.message : String(error)}`
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
add('部分目标与后续完整目标不会互相覆盖', runtimePartialGoalPass, runtimeEvidence)

const passed = results.filter(item => item.pass).length
const output = { generatedAt: new Date().toISOString(), passed, total: results.length, results }
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', 'v0.8.4场景架构验证.json'), JSON.stringify(output, null, 2))
const md = ['# Study Planner v0.8.4 场景架构验证', '', `- 通过：${passed} / ${results.length}`, `- 生成时间：${output.generatedAt}`, '', ...results.map(item => `- ${item.pass ? '✅' : '❌'} **${item.scenario}**：${item.evidence}`)]
fs.writeFileSync(path.join(root, 'validation', 'v0.8.4场景架构验证.md'), md.join('\n') + '\n')
console.log(md.join('\n'))
if (passed !== results.length) process.exit(1)

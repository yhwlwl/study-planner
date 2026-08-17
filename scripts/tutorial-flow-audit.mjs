import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = {
  app: read('src/App.tsx'),
  context: read('src/AppContext.tsx'),
  tutorial: read('src/lib/tutorial.ts'),
  intake: read('src/components/IntakePage.tsx'),
  goals: read('src/components/GoalsPage.tsx'),
  proposal: read('src/components/ProposalDialog.tsx'),
  stats: read('src/components/StatsPage.tsx'),
  guide: read('src/components/GuidePage.tsx'),
}

const results = []
const has = (text, ...needles) => needles.every(needle => text.includes(needle))
const check = (group, name, ok) => results.push({ group, name, ok: Boolean(ok) })

const expectedSteps = [
  'repair-entry','repair-action','repair-preview','repair-calendar','goal-existing',
  'intake-entry','intake-source','intake-parse','tasks-intake','goal-create','goal-link','intake-schedule','intake-preview','intake-calendar',
  'execute-complete','execute-partial','review-entry','review-carry','review-preview','review-calendar',
  'stats','stats-detail','future-entry','future-action','future-preview','future-calendar','stats-final','complete','free',
]

check('00 版本与入口', '教程升级到 v4，旧 session 不会误恢复', has(source.tutorial, 'TUTORIAL_VERSION = 4'))
check('00 版本与入口', '首次入口明确教程独立且不修改真实计划', has(source.app, '体验完整流程', '教程使用演示数据，不会修改你的真实计划。', '开始体验', '直接开始我的计划'))
check('00 版本与入口', '设置和使用教程都可重新打开', has(source.app, '重新体验完整流程', 'onStartTutorial={() => setTutorialOfferOpen(true)}') && has(source.guide, 'onStartTutorial'))

for (const step of expectedSteps) check('01 严格路线', `存在正式步骤 ${step}`, source.tutorial.includes(`'${step}'`))
check('01 严格路线', '录入确认后先进入任务页', has(source.app, "advanceTutorialStable('intake-parse', 'tasks-intake')"))
check('01 严格路线', '任务页之后依次新建目标、关联任务、再排期', has(source.app, "advanceTutorialStable('tasks-intake', 'goal-create')", "advanceTutorialStable('goal-create', 'goal-link')", "advanceTutorialStable('goal-link', 'intake-schedule')"))
check('01 严格路线', '未来重排月历后回统计再结束', has(source.app, "advanceTutorialStable('future-calendar', 'stats-final')", "advanceTutorialStable('stats-final', 'complete')"))

check('02 开场与修复', 'Today 明确显示计划问题', has(source.app, '个计划问题'))
check('02 开场与修复', '开场包含完成、锁定、逾期、超载和目标风险 fixture', has(source.tutorial, 'tutorial-task-done', 'tutorial-task-locked', 'tutorial-task-overdue', 'tutorial-task-goal-risk', 'capacityDanger'))
check('02 开场与修复', 'Proposal 显示完成/锁定保护和目标延期风险缓解', has(source.proposal, '已完成任务保持不变', '已锁定任务保持不变', '目标延期风险得到缓解'))
check('02 开场与修复', '明显排期变化后进入月历', has(source.app, "applyTutorialProposal(proposal, 'repair-preview', 'repair-calendar')", "applyTutorialProposal(proposal, 'intake-preview', 'intake-calendar')", "applyTutorialProposal(proposal, 'review-preview', 'review-calendar')", "applyTutorialProposal(proposal, 'future-preview', 'future-calendar')"))

check('03 目标与录入', '已有目标可查看期望/最晚/进度/预计完成/关联任务', has(source.goals, '期望完成', '最晚完成', '当前进度', '预计完成', '关联任务'))
check('03 目标与录入', '自然语言示例只读并由用户解析', has(source.intake, 'readOnly={tutorialNaturalEntry}', '解析并预览', '确认录入'))
check('03 目标与录入', '任务页真实展示待排期内容并说明录入不等于排期', has(source.app, 'tutorial-task-intake-list', '录入 ≠ 排期', '待排期'))
check('03 目标与录入', '教程新目标使用固定名称与 today+5/today+7', has(source.goals, 'TUTORIAL_NEW_GOAL_TITLE', 'shiftDate(tutorialAnchor, 5)', 'shiftDate(tutorialAnchor, 7)'))
check('03 目标与录入', '新目标需用户亲手确认', has(source.goals, 'tutorial-goal-create-confirm', "tutorialAction: 'tutorial-goal-create'"))
check('03 目标与录入', '关联任务独立一步且限定待排期批次', has(source.goals, '关联任务到目标', 'tutorial-goal-link-confirm', 'tutorialItems', "tutorialAction: 'tutorial-goal-link'"))
check('03 目标与录入', '排期前所有录入项已绑定共同目标', has(source.tutorial, 'hasLinkedTutorialIntake', 'TUTORIAL_NEW_GOAL_ID'))

check('04 执行与复盘', '执行包含完整完成与部分完成', has(source.tutorial, 'execute-complete', 'execute-partial', 'TUTORIAL_PARTIAL_ASSIGNMENT_ID'))
check('04 执行与复盘', '完整完成预填 52 分钟，部分完成预填 12 分钟/50%', has(source.app, "tutorialStep === 'execute-partial' ? '12' : '52'", "tutorialStep === 'execute-partial' ? 50 : 100"))
check('04 执行与复盘', '复盘顺延仍走真实 Proposal', has(source.app, "'review-carry': 'review-preview'", "applyTutorialProposal(proposal, 'review-preview', 'review-calendar')"))

check('05 统计与未来重排', '第一次统计先摘要后展开', has(source.stats, 'tutorial-stats-expand', 'onTutorialExpanded?.()') && has(source.app, "advanceTutorialStable('stats', 'stats-detail')"))
check('05 统计与未来重排', '未来重排四种偏好不隐藏', has(source.app, '四种偏好都保留显示'))
check('05 统计与未来重排', '最后一次月历后再次进入统计', has(source.tutorial, "'stats-final'") && has(source.app, "'stats-final': { text:"))

check('06 结束与隔离', '结束文案包含完整闭环', has(source.app, '你已经走完一次真实的计划循环。', '目标 → 录入 → 排期 → 执行 → 复盘 → 调整'))
check('06 结束与隔离', '继续看看进入 free，开始我的计划退出教程', has(source.app, "advanceTutorialOnly('complete', 'free')", 'exitTutorial(true)'))
check('06 结束与隔离', '业务层继续限制教程非当前 mutation', has(source.context, 'tutorialAllowsCommit(readTutorialSession()'))

const grouped = new Map()
for (const item of results) {
  const list = grouped.get(item.group) ?? []
  list.push(item)
  grouped.set(item.group, list)
}
for (const [group, items] of grouped) {
  console.log(`\n${group}`)
  for (const item of items) console.log(`${item.ok ? '✓' : '✗'} ${item.name}`)
}
const failed = results.filter(item => !item.ok)
console.log(`\n教程流程静态审计：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exit(1)

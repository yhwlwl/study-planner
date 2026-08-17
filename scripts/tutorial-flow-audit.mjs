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
  modal: read('src/components/Modal.tsx'),
  adjustment: read('src/components/AdjustmentIntentDialog.tsx'),
  proposal: read('src/components/ProposalDialog.tsx'),
  review: read('src/components/ReviewDialog.tsx'),
  stats: read('src/components/StatsPage.tsx'),
  coach: read('src/components/TutorialCoachmark.tsx'),
  css: read('src/tutorial.css'),
  styles: read('src/styles.css'),
}

const results = []
const has = (text, ...needles) => needles.every(needle => text.includes(needle))
const lacks = (text, ...needles) => needles.every(needle => !text.includes(needle))
const check = (group, name, ok) => results.push({ group, name, ok: Boolean(ok) })

const expectedSteps = [
  'repair-entry','repair-action','repair-preview','repair-calendar','goal-existing',
  'intake-entry','intake-source','intake-parse','intake-schedule','intake-preview','intake-calendar',
  'execute-complete','execute-partial','review-entry','review-carry','review-preview','review-calendar',
  'stats','stats-detail','future-entry','future-action','future-preview','future-calendar','complete','free',
]

check('00 版本与入口', '教程升级到 v3，旧流程不会把用户恢复到已删除步骤', has(source.tutorial, 'TUTORIAL_VERSION = 3', 'tutorial:v${TUTORIAL_VERSION}'))
check('00 版本与入口', '教程仍使用独立数据空间', has(source.tutorial, 'TUTORIAL_NAMESPACE = `tutorial:v${TUTORIAL_VERSION}`') && has(source.app, 'clearDataSpace(TUTORIAL_NAMESPACE)'))
check('00 版本与入口', '入口明确不会修改真实计划', has(source.app, '教程使用演示数据，不会修改你的真实计划。'))

for (const step of expectedSteps) check('01 真实路线', `存在正式步骤 ${step}`, source.tutorial.includes(`'${step}'`))
check('01 真实路线', '主步骤数组不再经过教程专属任务页/新建目标/假关联', lacks(source.tutorial.match(/export const TUTORIAL_STEPS:[\s\S]*?\n\]/)?.[0] ?? '', "'tasks-intake'", "'goal-create'", "'goal-link'"))
check('01 真实路线', '录入确认后直接回真实录入页生成排期', has(source.app, "advanceTutorialStable('intake-parse', 'intake-schedule')"))
check('01 真实路线', '目标步骤只查看真实目标详情', has(source.tutorial, "if (step === 'goal-existing') return 'goals'"))

check('02 修复', '开场问题仍由真实分析数据产生', has(source.tutorial, 'return Number(overdue) + Number(capacityDanger) + Number(goalRisk)'))
check('02 修复', '修复仍走正式 proposal 引擎', has(source.app, 'generateProposals(prepared, event, baseline, undefined, 0)', 'repairTeachingProposals'))
check('02 修复', '预览继续显示已完成和锁定保护', has(source.proposal, '已完成任务保持不变', '已锁定任务保持不变'))

check('03 目标', '目标查看使用真实卡片的查看按钮', has(source.goals, 'tutorial-goal-view', 'title="查看详情"'))
check('03 目标', '看完目标通过正常关闭动作继续', has(source.goals, 'const closeDetail = () =>', 'onClose={closeDetail}', 'onClick={closeDetail}>关闭'))
check('03 目标', '没有教程专属“关联新录入任务”产品按钮或弹窗', lacks(source.goals, '关联新录入任务', 'tutorial-goal-link-confirm', 'linkOpen'))

check('04 录入', '先到录入页再点真实自然语言入口', has(source.app, "'intake-entry': { target: 'tutorial-natural-input'", "advanceTutorialStable('intake-entry', 'intake-source')"))
check('04 录入', '自然语言解析和加入批次使用现有按钮', has(source.intake, '解析并预览', '加入当前批次', 'tutorial-import-confirm'))
check('04 录入', '任务确认后不再插入教程专属任务页', lacks(source.app, 'tutorial-task-intake-list', '刚录入、还未排期'))
check('04 录入', '真实排期按钮作为下一步目标', has(source.intake, 'data-tutorial-target={tutorialCanSchedule ? "schedule-intake" : undefined}', '生成排期预览'))
check('04 录入', 'checkpoint 不再预造共同目标绑定', has(source.tutorial, "ensureParsedTutorialBatch(state, anchorDate)\n    return state") && lacks(source.tutorial, 'hasLinkedTutorialIntake'))
check('04 录入', '带截止日的示例在应用后按真实规则产生对应目标', has(source.tutorial, "title: '读书报告完成目标'", "groupId: 'tutorial-added-report'"))

check('05 执行与复盘', '完成和部分完成仍写真实执行记录', has(source.tutorial, 'TUTORIAL_EXECUTE_ASSIGNMENT_ID', 'TUTORIAL_PARTIAL_ASSIGNMENT_ID', "action === 'execute-task'"))
check('05 执行与复盘', '复盘仍走真实顺延与 proposal 预览', has(source.app, "'review-carry': 'review-preview'", "applyTutorialProposal(proposal, 'review-preview', 'review-calendar')"))

check('06 统计', '统计提示只指向实际需要展开的 summary', lacks(source.stats, 'tutorial-stats-summary') && has(source.stats, '<summary data-tutorial-target={tutorialMode ? "tutorial-stats-expand" : undefined}>查看连续记录和学习热力图</summary>'))
check('06 统计', '展开后才推进 stats-detail', has(source.stats, 'event.currentTarget.open', 'onTutorialExpanded?.()') && has(source.app, "advanceTutorialStable('stats', 'stats-detail')"))

check('07 文案', '关键动作标题是直接动词句', has(source.app, "'repair-entry': '打开重排中心'", "'intake-entry': '打开自然语言录入'", "stats: '展开详细统计'"))
check('07 文案', '录入文案明确“现在还不会进入日历”', has(source.app, '现在还不会进入日历'))
check('07 文案', '预览文案明确确认后才进入正式计划', has(source.app, '这时才会进入正式计划'))

check('08 Coachmark', '浮层不再提供随机换位置按钮', lacks(source.coach, '换空位', 'tutorial-position-button', 'safeFloatingPositions'))
check('08 Coachmark', '桌面浮层锚定真实目标上下方', has(source.coach, "type FloatingMode = 'above' | 'below' | 'top-dock' | 'bottom-dock'", 'targetRect.bottom + gap', 'targetRect.top - measuredHeight - gap'))
check('08 Coachmark', '移动端弹窗提示固定到目标反侧边缘', has(source.coach, 'dockBottom', "mode: dockBottom ? 'bottom-dock' : 'top-dock'"))
check('08 Coachmark', '提示保留阶段/标题/正文层级', has(source.coach, 'tutorial-coachmark-head', 'tutorial-coachmark-title', 'tutorial-coachmark-copy'))
check('08 Coachmark', '关联气泡有指向目标的箭头，移动端 dock 不伪装指向', has(source.css, '.tutorial-coachmark-floating::after', '.tutorial-placement-top-dock::after'))

check('09 移动端弹窗', 'Modal 使用 visualViewport 的实际可见高度', has(source.modal, 'window.visualViewport', '--modal-visible-height'))
check('09 移动端弹窗', '全屏弹窗正文独立滚动且 footer 永远占据可见高度', has(source.styles, '/* v0.9 tutorial: visible viewport modal guarantee */', 'flex:1 1 0!important', 'flex:0 0 auto!important'))
check('09 移动端弹窗', 'footer 仍由 Modal 结构化拆出，不依赖滚到正文底部', has(source.modal, 'splitTrailingModalActions', '<footer className="modal-footer">'))

check('10 约束', '教程错误导航继续由真实页面白名单拦截', has(source.app, 'tutorialAllowsPage(current.step, target)'))
check('10 约束', '教程仍允许随时退出', has(source.coach, '退出教程', 'onExit'))
check('10 约束', '真实账号/游客数据恢复逻辑未被教程 UI 改写', has(source.app, '暂时无法恢复你的原计划，请稍后再退出教程'))

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

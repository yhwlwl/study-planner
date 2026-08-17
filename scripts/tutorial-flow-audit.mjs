import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = {
  app: read('src/App.tsx'),
  context: read('src/AppContext.tsx'),
  tutorial: read('src/lib/tutorial.ts'),
  intake: read('src/components/IntakePage.tsx'),
  intakeLib: read('src/lib/intake.ts'),
  goals: read('src/components/GoalsPage.tsx'),
  adjustment: read('src/components/AdjustmentIntentDialog.tsx'),
  proposal: read('src/components/ProposalDialog.tsx'),
  review: read('src/components/ReviewDialog.tsx'),
  stats: read('src/components/StatsPage.tsx'),
  task: read('src/components/TaskCard.tsx'),
  coach: read('src/components/TutorialCoachmark.tsx'),
  guide: read('src/components/GuidePage.tsx'),
  css: read('src/tutorial.css'),
}

const results = []
const has = (text, ...needles) => needles.every(needle => text.includes(needle))
const lacks = (text, ...needles) => needles.every(needle => !text.includes(needle))
const check = (group, name, ok, detail = '') => results.push({ group, name, ok: Boolean(ok), detail })

const expectedSteps = [
  'repair-entry','repair-action','repair-preview','repair-calendar','goal-existing',
  'intake-entry','intake-source','intake-parse','tasks-intake','goal-create','goal-link','intake-schedule','intake-preview','intake-calendar',
  'execute-complete','execute-partial','review-entry','review-carry','review-preview','review-calendar',
  'stats','stats-detail','future-entry','future-action','future-preview','future-calendar','complete','free',
]

check('00 入口', '教程版本独立升级到 v2', has(source.tutorial, 'TUTORIAL_VERSION = 2', 'tutorial:v${TUTORIAL_VERSION}'))
check('00 入口', '首次空白游客只弹介绍、不自动启动', has(source.app, '!tutorialCompleted()', 'setTutorialOfferOpen(true)') && lacks(source.app, "if (namespace === 'guest' && !sessionUser && !loadedFromStorage && !tutorialCompleted()) {\n      void startTutorial"))
check('00 入口', '介绍弹窗明确独立演示和不修改真实计划', has(source.app, 'title="体验完整流程"', '这是一个独立的演示教程', '教程使用演示数据，不会修改你的真实计划。'))
check('00 入口', '介绍弹窗可开始或直接跳过', has(source.app, '直接开始我的计划', '开始体验', 'markTutorialOfferDismissed'))
check('00 入口', '介绍弹窗说明关闭后可在使用教程重新打开', has(source.app, '之后可以在“使用教程”里重新打开'))
check('00 入口', '互动教程入口归到使用教程页，设置页不再重复', has(source.guide, 'onStartTutorial', '打开互动教程', '重新打开提示') && lacks(source.app, 'title="交互教程"'))

for (const step of expectedSteps) check('01 状态机', `存在步骤 ${step}`, source.tutorial.includes(`'${step}'`))
check('01 状态机', '页面映射覆盖月历/目标/录入/任务/统计', has(source.tutorial, "'repair-calendar', 'intake-calendar', 'review-calendar', 'future-calendar'", "'goal-existing', 'goal-create', 'goal-link'", "step === 'tasks-intake'", "'stats', 'stats-detail'"))
check('01 状态机', '瞬态刷新回安全 checkpoint', has(source.tutorial, "'repair-preview': 'repair-entry'", "'intake-source': 'intake-entry'", "'intake-parse': 'intake-entry'", "'intake-preview': 'intake-schedule'", "'review-preview': 'review-entry'", "'future-preview': 'future-entry'"))
check('01 状态机', '运行时不因普通状态偏差自动跳回', lacks(source.app, '教程状态已自动恢复到当前步骤'))
check('01 状态机', '重复推进要求 expected step 匹配', has(source.tutorial, 'if (!allowed.includes(session.step)) return session'))
check('01 状态机', '跨午夜锁定 anchor 时钟', has(source.tutorial, 'setNowProvider(() => new Date(`${anchorDate}T12:00:00`))'))

check('02 独立空间', '教程使用独立 namespace', has(source.tutorial, 'TUTORIAL_NAMESPACE = `tutorial:v${TUTORIAL_VERSION}`'))
check('02 独立空间', '进入前保存真实空间', has(source.app, 'if (returnHadData) await setDataSpace(returnNamespace, stateRef.current, false)'))
check('02 独立空间', '退出成功后才清教程 session/空间', has(source.app, 'if (!switched) return', 'clearTutorialSession(markCompleted)', 'clearDataSpace(TUTORIAL_NAMESPACE)'))
check('02 独立空间', '退出恢复失败不会覆盖真实计划', has(source.app, '暂时无法恢复你的原计划，请稍后再退出教程', 'return'))
check('02 独立空间', '教程 namespace 不参与账号普通云同步', has(source.app, 'namespace !== `user:${sessionUser.id}`'))

check('03 开场问题', 'fixture 有完成、锁定、逾期、今日超载、目标风险数据', has(source.tutorial, "id: 'tutorial-task-done'", "id: 'tutorial-task-overdue'", "id: 'tutorial-task-locked'", 'regularMinutes: 160', "id: 'tutorial-task-goal-risk'"))
check('03 开场问题', '首页教程问题数按三类心智问题计算', has(source.tutorial, 'return Number(overdue) + Number(capacityDanger) + Number(goalRisk)'))
check('03 开场问题', '开场引导指向重排中心', has(source.app, "'repair-entry': { target: 'replan-center'", '计划已经赶不上变化了'))

check('04 修复', '修复中心只允许本步动作但其他动作仍渲染', has(source.adjustment, 'const allowedTutorialAction', 'blocked={!allowedTutorialAction}', "item.id === (tutorialMode === 'repair' ? 'current-conflicts' : 'replan')"))
check('04 修复', '修复用正式 proposal 引擎而非写死结果', has(source.app, 'generateProposals(prepared, event, baseline, undefined, 0)', 'repairTeachingProposals') && lacks(source.app, 'buildTutorialRepairedFrom(prepared'))
check('04 修复', '修复教学方案要求真实移动和目标风险改善', has(source.app, "tutorial.step === 'repair-action'", 'item.movements.length > 0', 'goal.latestRiskBefore && !goal.latestRiskAfter'))
check('04 修复', 'Proposal 显示完成/锁定保护和目标风险结果', has(source.proposal, '✓ 已完成任务保持不变', '🔒 已锁定任务保持不变', '⚠ 目标风险得到缓解'))

check('05 修复后月历', '修复应用后进入 repair-calendar', has(source.app, "applyTutorialProposal(proposal, 'repair-preview', 'repair-calendar')"))
check('05 修复后月历', '月历记录并高亮变化日期', has(source.app, 'highlightDates', 'proposal.movements.flatMap') && has(source.css, 'tutorial-calendar-changed'))
check('05 修复后月历', '月历有结果说明和继续动作', has(source.app, "'repair-calendar':", '高亮日期就是发生变化的位置', '继续：看看目标'))

check('06 已有目标', '已有目标可点详情并展示期限/进度/预计完成/关联任务', has(source.goals, 'tutorial-goal-view', '期望完成', '最晚完成', '当前进度', '预计完成', '关联任务'))
check('06 已有目标', '查看后先进入录入页而不是直接弹自然语言框', has(source.app, "advanceTutorialOnly('goal-existing', 'intake-entry')", "setPage('intake')"))

check('07 自然语言录入', '固定示例文本包含四类任务', has(source.tutorial, '数学卷子 2 张，每张 60 分钟', '英语阅读 3 篇，每篇 30 分钟', '读书报告 1 份，每份 90 分钟', '整理物理错题 1 次，每次 45 分钟'))
check('07 自然语言录入', '先高亮录入页的自然语言入口并由用户亲手打开', has(source.app, "'intake-entry': { target: 'tutorial-natural-input'", "advanceTutorialStable('intake-entry', 'intake-source')") && has(source.intake, "tutorialStep === 'intake-entry'", 'onTutorialNaturalOpen?.()'))
check('07 自然语言录入', '点击入口后才打开现有自然语言框并只读', has(source.intake, 'tutorialNaturalChoice', 'tutorialNaturalEntry', 'setPasteText(tutorialText)', 'setPasteOpen(true)', 'readOnly={tutorialNaturalEntry}'))
check('07 自然语言录入', '用户亲手点击解析', has(source.intake, "'tutorial-parse'", 'onTutorialParsed?.()'))
check('07 自然语言录入', '解析结果完整显示但教程不可编辑', has(source.intake, 'tutorial-import-preview-fieldset', 'disabled={tutorialNaturalEntry}', '加入当前批次'))
check('07 自然语言录入', '自然语言解析支持张/篇/份等每项时长单位', has(source.intakeLib, '张|篇|份|个|章|节|组'))

check('08 任务页', '确认录入后进入 tasks-intake', has(source.app, "advanceTutorialStable('intake-parse', 'tasks-intake')"))
check('08 任务页', '任务页展示待排期录入内容', has(source.app, '刚录入、还未排期', 'tutorial-task-intake-list', '待排期'))

check('09 新建目标', '从任务页进入 goal-create', has(source.app, "advanceTutorialStable('tasks-intake', 'goal-create')"))
check('09 新建目标', '创建目标字段预填固定期限并由用户确认', has(source.goals, 'TUTORIAL_NEW_GOAL_TITLE', 'shiftDate(tutorialAnchorDate, 5)', 'shiftDate(tutorialAnchorDate, 7)', 'tutorial-goal-create-confirm'))
check('09 新建目标', '教程目标创建使用业务 commit 白名单', has(source.goals, "tutorialAction: 'goal-create'") && has(source.tutorial, "session.step === 'goal-create' && action === 'goal-create'"))

check('10 关联目标', '新目标创建后进入 goal-link', has(source.app, "advanceTutorialStable('goal-create', 'goal-link')"))
check('10 关联目标', '用户逐项勾选四组新录入任务并确认关联', has(source.goals, '关联新录入任务', 'linkIds', '确认关联', 'linkIds.length !== tutorialPendingItems.length'))
check('10 关联目标', '绑定写回 intake goalIds 且受白名单保护', has(source.goals, "tutorialAction: 'goal-link'", 'item.goalIds =') && has(source.tutorial, "session.step === 'goal-link' && action === 'goal-link'"))

check('11 新任务排期', '绑定后进入 intake-schedule', has(source.app, "advanceTutorialStable('goal-link', 'intake-schedule')"))
check('11 新任务排期', '用户亲手生成排期预览', has(source.intake, 'tutorialCanSchedule', 'schedule-intake') && has(source.app, "'intake-schedule': 'intake-preview'"))
check('11 新任务排期', '排期仍用正式 proposal 引擎', has(source.app, 'generateProposals(prepared, event, baseline, undefined, 0)'))
check('11 新任务排期', '确认后进入 intake-calendar', has(source.app, "applyTutorialProposal(proposal, 'intake-preview', 'intake-calendar')"))

check('12 新任务月历', '新任务月历有高亮结果说明', has(source.app, "'intake-calendar':", '刚才录入的任务现在真正进入计划了', '继续：执行今天'))

check('13 今日执行', '第一项要求完整完成并预填 52 分钟', has(source.app, "tutorialStep === 'execute-complete'", "'52'", 'tutorial-complete-confirm'))
check('13 今日执行', '第二项要求部分完成并预填 12 分钟/50%', has(source.app, "tutorialStep === 'execute-partial'", "'12'", '50', 'tutorial-partial-confirm'))
check('13 今日执行', '两步只允许指定任务写入', has(source.tutorial, 'TUTORIAL_EXECUTE_ASSIGNMENT_ID', 'TUTORIAL_PARTIAL_ASSIGNMENT_ID', "action === 'execute-task'"))

check('14 复盘', '部分完成后进入 review-entry', has(source.app, "advanceTutorialStable('execute-partial', 'review-entry')"))
check('14 复盘', '复盘入口有高亮引导', has(source.app, "'review-entry':", '结束今天并复盘'))
check('14 复盘', '复盘摘要保留完成/计划/实际/待处理信息', has(source.review, '已完成', '计划时间', '实际时间', '待处理'))

check('15 顺延', '教程保留每项未完成任务和合法日期选择', has(source.review, 'tutorialPreferredTarget', 'legalOptions', 'review-carry-date'))
check('15 顺延', '用户必须确认当前顺延方案', has(source.review, 'review-carry', '完成复盘，并按当前方案顺延'))
check('15 顺延', '顺延仍通过 proposal 预览', has(source.app, "'review-carry': 'review-preview'"))
check('15 顺延', '确认后进入 review-calendar', has(source.app, "applyTutorialProposal(proposal, 'review-preview', 'review-calendar')"))

check('16 复盘月历', '复盘月历解释未完成已接到未来', has(source.app, "'review-calendar':", '一天没做完，不等于整个计划废掉'))

check('17 统计', '复盘月历后进入 stats', has(source.app, "advanceTutorialStable('review-calendar', 'stats')"))
check('17 统计', '统计页有摘要目标和展开详情目标', has(source.stats, 'tutorial-stats-summary', 'tutorial-stats-expand'))
check('17 统计', '用户展开后才进入 stats-detail', has(source.stats, 'onTutorialExpanded?.()') && has(source.app, "advanceTutorialStable('stats', 'stats-detail')"))

check('18 未来重排', 'stats-detail 后进入 future-entry', has(source.app, "advanceTutorialStable('stats-detail', 'future-entry')"))
check('18 未来重排', '重排中心区分没有问题时的主动未来调整', has(source.app, "'future-entry':", '没有故障，也可以主动改变后面的节奏'))
check('18 未来重排', '四个偏好全部可见可点击', has(source.adjustment, "(['preserve', 'balanced', 'goal', 'rest'] as ReplanOutcome[])", 'onClick={() => setReplanOutcome(item)}') && lacks(source.adjustment, "disabled={tutorialMode === 'future' && item !=="))
check('18 未来重排', '未来教学方案优先选择有真实移动的方案', has(source.app, 'futureTeachingProposals', 'item.movements.length > 0'))
check('18 未来重排', '未来确认后进入 future-calendar', has(source.app, "applyTutorialProposal(proposal, 'future-preview', 'future-calendar')"))

check('19 最终月历', '最终月历说明主动规划和修复故障的区别', has(source.app, "'future-calendar':", '这次不是修复故障，而是主动重新规划后面的节奏'))
check('20 结束', '结束文案包含完整闭环并有两个出口', has(source.app, '你已经走完一次真实的计划循环', '目标 → 录入 → 排期 → 执行 → 复盘 → 调整', '开始我的计划', '继续看看'))
check('20 结束', '继续看看进入 free，真实计划仍隔离', has(source.app, "advanceTutorialOnly('complete', 'free')") && has(source.tutorial, "session.step === 'free'"))

check('21 引导体验', '每一个教程步骤都有 coach config', expectedSteps.filter(step => step !== 'free').every(step => source.app.includes(`'${step}':`) || source.app.includes(`${step}:`)))
check('21 引导体验', '引导关闭只收起当前提示，且有明确重新打开入口', has(source.coach, 'setCollapsed(true)', '重新打开提示') && lacks(source.coach, 'aria-label="关闭当前提示" onClick={onExit}'))
check('21 引导体验', '引导为普通文档流而非覆盖悬浮', has(source.css, '.tutorial-coachmark {\n  position: relative;'))
check('21 引导体验', '弹窗步骤自动切为小型可关闭浮层并高于 Modal', has(source.coach, "target.closest('.modal-card')", 'tutorial-coachmark-floating') && has(source.css, '.tutorial-coachmark-floating {', 'z-index: 180'))
check('21 引导体验', '弹窗浮层只在不遮挡当前目标或可操作控件的安全位置间切换', has(source.coach, 'safeFloatingPositions', 'targetOverlap === 0 && item.controlOverlap === 0', '移动到其他安全位置', '换空位') && has(source.css, '.tutorial-position-top-left', '.tutorial-position-middle-right', '.tutorial-position-middle-left'))
check('21 引导体验', '提示文案有阶段、标题、正文和动作词强调层级', has(source.coach, 'headline?: string', 'tutorial-coachmark-title', 'tutorial-inline-emphasis') && has(source.app, 'const headlines:', "'intake-entry': '在录入页选择自然语言录入'") && has(source.css, '.tutorial-coachmark-title', '.tutorial-inline-emphasis'))
check('21 引导体验', '移动端教程介绍弹窗保留顶部安全间距', has(source.css, '.modal-backdrop:has(.tutorial-offer-copy)', 'env(safe-area-inset-top)'))
check('21 引导体验', '任务与目标教学文字在窄屏保持自然排版', has(source.css, '.tutorial-pending-item > span', '[data-tutorial-target="tutorial-goal-link"]', 'white-space: nowrap'))
check('21 引导体验', '教程页面切换使用轻量进入动画且尊重减少动画偏好', has(source.css, '@keyframes tutorial-page-enter', '@media (prefers-reduced-motion: reduce)'))
check('21 引导体验', '目标高亮有限重试，不持续 mutation/scroll 追踪', has(source.coach, 'for (const delay of [0, 100, 280, 650])') && lacks(source.coach, 'MutationObserver'))

check('22 显示但阻止', '侧栏仍完整渲染，错误导航由 navigate 拦截', has(source.app, 'navItems.map', 'tutorialAllowsPage', 'tutorialNotice()'))
check('22 显示但阻止', '任务操作仍显示，教程用 aria-disabled/业务拦截', has(source.task, 'tutorial-disabled-control', 'onTutorialBlocked'))
check('22 显示但阻止', '目标编辑/归档/删除仍显示但会阻止', has(source.goals, '教程中先查看目标，不修改它', '教程中暂不归档目标', '教程中暂不删除目标'))
check('22 显示但阻止', 'Proposal 更多方案/逐项微调仍显示但不可改剧情', has(source.proposal, '生成更多不同方案（教程中暂不可用）', '逐项微调', '教程中完整展示该功能'))
check('22 显示但阻止', 'Review 更多方案/仅保存仍显示但不可改剧情', has(source.review, '获取更多方案', '仅保存复盘，暂不顺延', '教程中先使用当前顺延方案'))
check('22 显示但阻止', 'AppContext 业务层仍有教程白名单', has(source.context, 'tutorialAllowsCommit(readTutorialSession()', 'guidedTutorialMutationBlocked'))

const failed = results.filter(item => !item.ok)
const grouped = new Map()
for (const item of results) {
  if (!grouped.has(item.group)) grouped.set(item.group, [])
  grouped.get(item.group).push(item)
}
for (const [group, items] of grouped) {
  console.log(`\n${group}`)
  for (const item of items) console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}
console.log(`\n教程流程静态审计：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.error(`失败 ${failed.length} 项：${failed.map(item => item.name).join('；')}`)
  process.exit(1)
}

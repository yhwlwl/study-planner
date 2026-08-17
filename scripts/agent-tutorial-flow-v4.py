from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise RuntimeError(f'missing exact anchor in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))

def sub_once(path, pattern, repl, flags=re.S):
    text = read(path)
    next_text, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'regex anchor count={count} in {path}: {pattern[:120]!r}')
    write(path, next_text)

# ---- src/lib/tutorial.ts ----
P = 'src/lib/tutorial.ts'
replace_once(P, 'export const TUTORIAL_VERSION = 3', 'export const TUTORIAL_VERSION = 4')
replace_once(P, "  | 'intake-parse'\n  | 'intake-schedule'", "  | 'intake-parse'\n  | 'tasks-intake'\n  | 'goal-create'\n  | 'goal-link'\n  | 'intake-schedule'")
replace_once(P, "  | 'future-preview'\n  | 'future-calendar'\n  | 'complete'", "  | 'future-preview'\n  | 'future-calendar'\n  | 'stats-final'\n  | 'complete'")
replace_once(P,
"  'intake-entry', 'intake-source', 'intake-parse', 'intake-schedule', 'intake-preview', 'intake-calendar',\n  'execute-complete', 'execute-partial', 'review-entry', 'review-carry', 'review-preview', 'review-calendar',\n  'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'complete', 'free',",
"  'intake-entry', 'intake-source', 'intake-parse', 'tasks-intake', 'goal-create', 'goal-link', 'intake-schedule', 'intake-preview', 'intake-calendar',\n  'execute-complete', 'execute-partial', 'review-entry', 'review-carry', 'review-preview', 'review-calendar',\n  'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'stats-final', 'complete', 'free',")
replace_once(P,
"  if (['repair-calendar', 'intake-calendar', 'review-calendar', 'future-calendar'].includes(step)) return 'calendar'\n  if (step === 'goal-existing') return 'goals'\n  if (['intake-entry', 'intake-source', 'intake-parse', 'intake-schedule', 'intake-preview'].includes(step)) return 'intake'\n  if (['stats', 'stats-detail'].includes(step)) return 'stats'",
"  if (['repair-calendar', 'intake-calendar', 'review-calendar', 'future-calendar'].includes(step)) return 'calendar'\n  if (step === 'tasks-intake') return 'tasks'\n  if (['goal-existing', 'goal-create', 'goal-link'].includes(step)) return 'goals'\n  if (['intake-entry', 'intake-source', 'intake-parse', 'intake-schedule', 'intake-preview'].includes(step)) return 'intake'\n  if (['stats', 'stats-detail', 'stats-final'].includes(step)) return 'stats'")
replace_once(P,
"  if (session.step === 'intake-parse' && action === 'intake-import') return true\n  if (session.step === 'execute-complete'",
"  if (session.step === 'intake-parse' && action === 'intake-import') return true\n  if (session.step === 'goal-create' && action === 'tutorial-goal-create' && targetId === TUTORIAL_NEW_GOAL_ID) return true\n  if (session.step === 'goal-link' && action === 'tutorial-goal-link' && targetId === TUTORIAL_INTAKE_BATCH_ID) return true\n  if (session.step === 'execute-complete'")

helper_anchor = """function ensureParsedTutorialBatch(state: AppState, anchorDate: string, goalId?: string) {
  const batch = buildTutorialIntakeBatch(anchorDate, true, goalId)
  state.intakeBatches = [...state.intakeBatches.filter(item => item.id !== TUTORIAL_INTAKE_BATCH_ID), batch]
}
"""
helper_new = helper_anchor + """
function tutorialNewGoal(anchorDate: string): Goal {
  const now = stamp(anchorDate, '13')
  return {
    id: TUTORIAL_NEW_GOAL_ID,
    title: TUTORIAL_NEW_GOAL_TITLE,
    description: '教程示例目标：把刚录入的一批新作业放进同一个完成目标。',
    priority: 3,
    desiredDate: shiftDate(anchorDate, 5),
    latestDate: shiftDate(anchorDate, 7),
    status: 'active',
    completionConditions: [],
    linkedTaskGroupIds: [],
    linkedAssignmentIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

function buildTutorialIntakePreparation(anchorDate: string, stage: 'parsed' | 'goal' | 'linked'): AppState {
  const state = buildRepairedCheckpoint(anchorDate)
  ensureParsedTutorialBatch(state, anchorDate)
  if (stage !== 'parsed') {
    state.goals = [...state.goals.filter(item => item.id !== TUTORIAL_NEW_GOAL_ID), tutorialNewGoal(anchorDate)]
  }
  if (stage === 'linked') {
    const batch = state.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)
    if (batch) batch.taskGroups = batch.taskGroups.map(item => ({ ...item, goalIds: [TUTORIAL_NEW_GOAL_ID], updatedAt: stamp(anchorDate, '13') }))
  }
  return updateGoalAndGroupLifecycle(state)
}
"""
replace_once(P, helper_anchor, helper_new)
replace_once(P,
"  state.taskGroups.push(...definitions.map(item => item.group))\n  state.assignments.push(...definitions.flatMap(item => item.tasks))\n  const reportGoalId = 'tutorial-auto-goal-report'",
"  state.taskGroups.push(...definitions.map(item => item.group))\n  state.assignments.push(...definitions.flatMap(item => item.tasks))\n  const commonGoal = tutorialNewGoal(anchorDate)\n  commonGoal.linkedTaskGroupIds = definitions.map(item => item.group.id)\n  commonGoal.completionConditions = definitions.map((item, index) => ({ id: `tutorial-new-condition-${index + 1}`, groupId: item.group.id, mode: 'all' as const }))\n  state.goals = [...state.goals.filter(item => item.id !== TUTORIAL_NEW_GOAL_ID), commonGoal]\n  const reportGoalId = 'tutorial-auto-goal-report'")
replace_once(P, "  const batch = buildTutorialIntakeBatch(anchorDate, true)\n", "  const batch = buildTutorialIntakeBatch(anchorDate, true, TUTORIAL_NEW_GOAL_ID)\n")

sub_once(P,
r"export function buildTutorialCheckpoint\(step: TutorialStep, anchorDate: string\): AppState \{.*?\n\}\n\nexport function tutorialIssueCount",
"""export function buildTutorialCheckpoint(step: TutorialStep, anchorDate: string): AppState {
  if (['repair-entry', 'repair-action', 'repair-preview'].includes(step)) return baseTutorialState(anchorDate)
  if (['repair-calendar', 'goal-existing'].includes(step)) return buildRepairedCheckpoint(anchorDate)
  if (['intake-entry', 'intake-source', 'intake-parse'].includes(step)) return ensureTutorialIntakeBatch(buildRepairedCheckpoint(anchorDate), anchorDate)
  if (['tasks-intake', 'goal-create'].includes(step)) return buildTutorialIntakePreparation(anchorDate, 'parsed')
  if (step === 'goal-link') return buildTutorialIntakePreparation(anchorDate, 'goal')
  if (['intake-schedule', 'intake-preview'].includes(step)) return buildTutorialIntakePreparation(anchorDate, 'linked')
  if (['intake-calendar', 'execute-complete'].includes(step)) return buildScheduledCheckpoint(anchorDate)
  if (step === 'execute-partial') return buildCompleteCheckpoint(anchorDate)
  if (['review-entry', 'review-carry', 'review-preview'].includes(step)) return buildExecutedCheckpoint(anchorDate)
  if (['review-calendar', 'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview'].includes(step)) return buildReviewedCheckpoint(anchorDate)
  if (['future-calendar', 'stats-final', 'complete', 'free'].includes(step)) return buildTutorialFutureFrom(buildReviewedCheckpoint(anchorDate), anchorDate)
  return baseTutorialState(anchorDate)
}

export function tutorialIssueCount""")

replace_once(P,
"function hasAppliedTutorialIntake(state: AppState) {",
"""function hasTutorialNewGoal(state: AppState) {
  return state.goals.some(goal => goal.id === TUTORIAL_NEW_GOAL_ID && goal.title === TUTORIAL_NEW_GOAL_TITLE && goal.status === 'active')
}

function hasLinkedTutorialIntake(state: AppState) {
  const batch = tutorialBatch(state)
  return Boolean(batch?.taskGroups.length === 4 && batch.taskGroups.every(item => item.goalIds.includes(TUTORIAL_NEW_GOAL_ID)))
}

function hasAppliedTutorialGoal(state: AppState) {
  const batch = tutorialBatch(state)
  const goal = state.goals.find(item => item.id === TUTORIAL_NEW_GOAL_ID)
  const groupIds = batch?.taskGroups.map(item => item.appliedGroupId).filter((id): id is string => Boolean(id)) ?? []
  return Boolean(goal && groupIds.length === 4 && groupIds.every(groupId => goal.linkedTaskGroupIds.includes(groupId) && goal.completionConditions.some(condition => condition.groupId === groupId)))
}

function hasAppliedTutorialIntake(state: AppState) {""")
replace_once(P,
"  if (['intake-entry', 'intake-source', 'intake-parse'].includes(session.step) && !tutorialBatch(state)) return { ok: false as const, reason: '教程录入批次缺失' }\n  if (['intake-schedule', 'intake-preview'].includes(session.step) && !hasParsedTutorialIntake(state)) return { ok: false as const, reason: '教程自然语言录入结果缺失' }",
"""  if (['intake-entry', 'intake-source', 'intake-parse'].includes(session.step) && !tutorialBatch(state)) return { ok: false as const, reason: '教程录入批次缺失' }
  if (['tasks-intake', 'goal-create', 'goal-link', 'intake-schedule', 'intake-preview'].includes(session.step) && !hasParsedTutorialIntake(state)) return { ok: false as const, reason: '教程自然语言录入结果缺失' }
  if (['goal-link', 'intake-schedule', 'intake-preview'].includes(session.step) && !hasTutorialNewGoal(state)) return { ok: false as const, reason: '教程新目标缺失' }
  if (['intake-schedule', 'intake-preview'].includes(session.step) && !hasLinkedTutorialIntake(state)) return { ok: false as const, reason: '教程新任务尚未关联共同目标' }""")
for old, new in [
("'future-calendar', 'complete', 'free'", "'future-calendar', 'stats-final', 'complete', 'free'"),
("'future-preview', 'future-calendar', 'complete', 'free'", "'future-preview', 'future-calendar', 'stats-final', 'complete', 'free'"),
]:
    text = read(P)
    if old in text:
        write(P, text.replace(old, new))
replace_once(P,
"    if (!hasAppliedTutorialIntake(state)) return { ok: false as const, reason: '教程新增任务 checkpoint 缺失或未应用' }\n  }",
"    if (!hasAppliedTutorialIntake(state)) return { ok: false as const, reason: '教程新增任务 checkpoint 缺失或未应用' }\n    if (!hasAppliedTutorialGoal(state)) return { ok: false as const, reason: '教程共同目标没有随任务排期建立正式关联' }\n  }")

# ---- src/App.tsx ----
P = 'src/App.tsx'
replace_once(P,
"  TUTORIAL_EXECUTE_ASSIGNMENT_ID, TUTORIAL_PARTIAL_ASSIGNMENT_ID, TUTORIAL_NAMESPACE, advanceTutorialSession, buildTutorialCheckpoint, buildTutorialState,",
"  TUTORIAL_EXECUTE_ASSIGNMENT_ID, TUTORIAL_PARTIAL_ASSIGNMENT_ID, TUTORIAL_INTAKE_BATCH_ID, TUTORIAL_NAMESPACE, advanceTutorialSession, buildTutorialCheckpoint, buildTutorialState,")
replace_once(P,
"  const advanceTutorialAfterImport = () => advanceTutorialStable('intake-parse', 'intake-schedule')\n  const tutorialStatsExpanded = () => advanceTutorialStable('stats', 'stats-detail')",
"""  const advanceTutorialAfterImport = () => advanceTutorialStable('intake-parse', 'tasks-intake')
  const tutorialIntakeSeen = () => advanceTutorialStable('tasks-intake', 'goal-create')
  const tutorialGoalCreated = () => advanceTutorialStable('goal-create', 'goal-link')
  const tutorialGoalLinked = () => advanceTutorialStable('goal-link', 'intake-schedule')
  const tutorialStatsExpanded = () => advanceTutorialStable('stats', 'stats-detail')""")

new_base = r"""    const base: Partial<Record<TutorialStep, TutorialCoachmarkConfig>> = {
      'repair-entry': { target: 'replan-center', text: '计划已经赶不上变化了，先看看哪里出了问题。' },
      'repair-action': { target: 'repair-submit|repair-current', text: '先解决已经发生的问题。' },
      'repair-preview': { target: 'proposal-primary', text: '查看完整变更，确认已完成和锁定任务不动、目标延期风险得到缓解，再应用方案。' },
      'repair-calendar': { text: '刚才的调整已经落到计划里了，先看看任务发生了什么变化。', actionLabel: '继续', onAction: () => advanceTutorialStable('repair-calendar', 'goal-existing') },
      'goal-existing': { target: 'tutorial-goal-view', text: '排期会考虑目标和截止时间，不只是把任务放进日历。' },
      'intake-entry': { target: 'tutorial-natural-input', text: '现实里可以直接把一批事情这样告诉计划器。现在试着让它识别。' },
      'intake-source': { target: 'tutorial-parse', text: '示例文字已经填好且保持只读。点“解析并预览”。' },
      'intake-parse': { target: 'tutorial-import-confirm', text: '自然语言已经变成结构化任务。确认后，它们只会进入待排期区。' },
      'tasks-intake': { target: 'tutorial-task-intake-list', text: '现在任务已经记下来了，但还没有进入日历。', actionLabel: '继续：新建目标', onAction: tutorialIntakeSeen },
      'goal-create': { target: 'tutorial-goal-create', text: '现在给刚才那批任务一个共同的完成目标。' },
      'goal-link': { target: 'tutorial-goal-link', text: '目标会影响这些任务之后的排期和风险判断。' },
      'intake-schedule': { target: 'schedule-intake', text: '任务和目标都准备好了，现在让计划器安排时间。' },
      'intake-preview': { target: 'proposal-primary', text: '确认后，这些任务才正式进入日历。' },
      'intake-calendar': { text: '刚才录入的任务，现在已经真正进入计划。', actionLabel: '继续：执行今天', onAction: () => advanceTutorialStable('intake-calendar', 'execute-complete') },
      'execute-complete': { target: 'tutorial-complete-confirm|tutorial-execute', text: '计划排好了，现在只需要处理今天。先完成高亮任务，并记录 52 分钟实际用时。' },
      'execute-partial': { target: 'tutorial-partial-confirm|tutorial-execute', text: '再把第二项按真实情况记录为部分完成：12 分钟、50%。' },
      'review-entry': { target: 'today-review', text: '按实际情况结束今天，不需要假装所有任务都完成。' },
      'review-carry': { target: 'review-carry', text: '今天没做完的，不需要重新录入。选择顺延并查看预览。' },
      'review-preview': { target: 'proposal-primary', text: '确认未完成任务会接到哪里，再应用顺延。' },
      'review-calendar': { text: '今天没完成的内容已经接到后面的计划里。', actionLabel: '继续：看统计', onAction: () => advanceTutorialStable('review-calendar', 'stats') },
      stats: { target: 'tutorial-stats-expand', text: '这里记录的是实际执行，不只是原来的计划。展开一次详细统计。' },
      'stats-detail': { text: '你已经看到计划与实际、完成情况和近期记录。', actionLabel: '继续：重新安排未来', onAction: () => advanceTutorialStable('stats-detail', 'future-entry') },
      'future-entry': { target: 'replan-center', text: '没有出问题，也可以主动改变后面的节奏。' },
      'future-action': { target: 'future-submit|future-replan', text: '四种偏好都保留显示。选择一个方向，生成一次未来重排。' },
      'future-preview': { target: 'proposal-primary', text: '这次不是救火。对比未来安排前后，再确认应用。' },
      'future-calendar': { text: '这次不是救火，而是主动重新规划后面的节奏。', actionLabel: '继续：再看统计', onAction: () => advanceTutorialStable('future-calendar', 'stats-final') },
      'stats-final': { text: '最后再看一次统计：计划变化和真实执行会一起留在这里，方便之后继续调整。', actionLabel: '完成体验', onAction: () => advanceTutorialStable('stats-final', 'complete') },
      complete: { text: '你已经走完一次真实的计划循环。\n\n目标 → 录入 → 排期 → 执行 → 复盘 → 调整', actionLabel: '开始我的计划', onAction: () => { void exitTutorial(true) }, secondaryLabel: '继续看看', onSecondary: () => { const updated = advanceTutorialOnly('complete', 'free'); if (updated) setPage('today') } },
    }
"""
sub_once(P, r"    const base: Partial<Record<TutorialStep, TutorialCoachmarkConfig>> = \{.*?\n    \}\n    const headlines:", new_base + "    const headlines:")
new_headlines = r"""    const headlines: Partial<Record<TutorialStep, string>> = {
      'repair-entry': '先看哪里出了问题',
      'repair-action': '修复当前问题',
      'repair-preview': '查看变更并确认',
      'repair-calendar': '看调整落到月历',
      'goal-existing': '认识已有目标',
      'intake-entry': '自然语言录入',
      'intake-source': '让计划器识别',
      'intake-parse': '确认结构化结果',
      'tasks-intake': '录入不等于排期',
      'goal-create': '新建共同目标',
      'goal-link': '把新任务关联到目标',
      'intake-schedule': '生成排期预览',
      'intake-preview': '确认新任务排期',
      'intake-calendar': '看新任务进入日历',
      'execute-complete': '完整完成一项任务',
      'execute-partial': '记录一次部分完成',
      'review-entry': '结束今天并复盘',
      'review-carry': '处理未完成任务',
      'review-preview': '确认顺延结果',
      'review-calendar': '看顺延后的计划',
      stats: '查看执行统计',
      'stats-detail': '展开详细统计',
      'future-entry': '认识重新安排未来',
      'future-action': '选择未来节奏',
      'future-preview': '对比未来重排',
      'future-calendar': '看主动重排结果',
      'stats-final': '回到统计看结果',
      complete: '完整计划循环走完了',
    }
"""
sub_once(P, r"    const headlines: Partial<Record<TutorialStep, string>> = \{.*?\n    \}\n    const phase", new_headlines + "    const phase")
replace_once(P,
"      : tutorialStepValue === 'goal-existing' ? '02 · 目标'\n        : tutorialStepValue.startsWith('intake') ? '03 · 录入与排期'",
"      : ['goal-existing', 'goal-create', 'goal-link'].includes(tutorialStepValue) ? '02 · 目标'\n        : tutorialStepValue === 'tasks-intake' || tutorialStepValue.startsWith('intake') ? '03 · 录入与排期'")
replace_once(P,
"<span>{currentIssueCount ? `${currentIssueCount} 个问题需处理` : '计划有变化'}</span>",
"<span>{tutorialActive && tutorialStepValue === 'repair-entry' ? `${currentIssueCount} 个计划问题` : currentIssueCount ? `${currentIssueCount} 个问题需处理` : '计划有变化'}</span>")
replace_once(P,
"{page === 'tasks' && <TasksPage onOpenIntake={() => navigate('intake')} onPrepared={openPrepared} tutorialMode={tutorialRestricted} tutorialStep={tutorialStepValue} onTutorialBlocked={tutorialNotice}/>}",
"{page === 'tasks' && <TasksPage onOpenIntake={() => navigate('intake')} onPrepared={openPrepared} tutorialMode={tutorialRestricted} tutorialStep={tutorialStepValue} onTutorialIntakeSeen={tutorialIntakeSeen} onTutorialBlocked={tutorialNotice}/>}")
replace_once(P,
"{page === 'goals' && <GoalsPage onPrepared={openPrepared} tutorialMode={tutorialRestricted && tutorialPageForStep(tutorialStepValue!) === 'goals'} tutorialStep={tutorialStepValue} onTutorialExistingViewed={() => { void enterTutorialIntake() }} onTutorialBlocked={tutorialNotice}/>}",
"{page === 'goals' && <GoalsPage onPrepared={openPrepared} tutorialMode={tutorialRestricted && tutorialPageForStep(tutorialStepValue!) === 'goals'} tutorialStep={tutorialStepValue} onTutorialExistingViewed={() => { void enterTutorialIntake() }} onTutorialGoalCreated={tutorialGoalCreated} onTutorialGoalLinked={tutorialGoalLinked} onTutorialBlocked={tutorialNotice}/>}")
replace_once(P,
"{page === 'stats' && <StatsPage onOpenReplan={date => openAdjustment(date, 'current-conflicts')} tutorialMode={tutorialRestricted && (tutorialStepValue === 'stats' || tutorialStepValue === 'stats-detail')} onTutorialExpanded={tutorialStatsExpanded}/>}",
"{page === 'stats' && <StatsPage onOpenReplan={date => openAdjustment(date, 'current-conflicts')} tutorialMode={tutorialRestricted && (tutorialStepValue === 'stats' || tutorialStepValue === 'stats-detail' || tutorialStepValue === 'stats-final')} onTutorialExpanded={tutorialStatsExpanded}/>}")
replace_once(P,
"{page === 'settings' && <SettingsPage sessionUserId={sessionUser?.id} sessionEmail={sessionUser?.email} cloudMessage={cloudMessage} onCloudUpload={uploadCloudNow} onPrepared={openPrepared}/>}",
"{page === 'settings' && <SettingsPage sessionUserId={sessionUser?.id} sessionEmail={sessionUser?.email} cloudMessage={cloudMessage} onCloudUpload={uploadCloudNow} onPrepared={openPrepared} onStartTutorial={() => setTutorialOfferOpen(true)}/>}")
replace_once(P,
"<p>如果暂时关闭，之后可以在“使用教程”里重新打开。</p>",
"<p>如果暂时关闭，之后可以从“设置”或“使用教程”重新打开。</p>")

replace_once(P,
"function TasksPage({ onOpenIntake, onPrepared, tutorialMode = false, tutorialStep, onTutorialBlocked }: { onOpenIntake: () => void; onPrepared: (state: AppState, event: PlanChangeEvent) => void; tutorialMode?: boolean; tutorialStep?: TutorialStep; onTutorialBlocked?: (message?: string) => void }) {",
"function TasksPage({ onOpenIntake, onPrepared, tutorialMode = false, tutorialStep, onTutorialIntakeSeen, onTutorialBlocked }: { onOpenIntake: () => void; onPrepared: (state: AppState, event: PlanChangeEvent) => void; tutorialMode?: boolean; tutorialStep?: TutorialStep; onTutorialIntakeSeen?: () => void; onTutorialBlocked?: (message?: string) => void }) {")
replace_once(P,
"  const today = todayISO()\n  const query = search.trim().toLowerCase()",
"  const today = todayISO()\n  const tutorialPendingItems = tutorialMode && tutorialStep === 'tasks-intake' ? state.intakeBatches.find(batch => batch.id === TUTORIAL_INTAKE_BATCH_ID)?.taskGroups.filter(item => !item.appliedAt) ?? [] : []\n  const query = search.trim().toLowerCase()")
replace_once(P,
"    {mode === 'tasks' ? <>",
"""    {tutorialMode && tutorialStep === 'tasks-intake' && <section className="section-block" data-tutorial-target="tutorial-task-intake-list">
      <div className="section-title"><div><h2>刚录入的任务</h2><p>这些内容已经记下来了，但还没有正式日期。录入 ≠ 排期。</p></div><span className="status-pill">待排期 {tutorialPendingItems.length} 组</span></div>
      <div className="assignment-list">{tutorialPendingItems.map(item => <article className="assignment-list-card needs-attention" key={item.id}><div className="assignment-list-main"><div><strong>{item.title}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</strong><span>{item.subject} · 每项 {item.unitMinutes} 分钟</span></div><span className="status-pill">待排期</span></div></article>)}</div>
      <div className="button-wrap"><button className="primary-button" data-tutorial-target="tutorial-tasks-continue" onClick={onTutorialIntakeSeen}>继续：新建目标</button></div>
    </section>}

    {mode === 'tasks' ? <>""")

replace_once(P,
"function SettingsPage({ sessionUserId, sessionEmail, cloudMessage, onCloudUpload, onPrepared }: { sessionUserId?: string; sessionEmail?: string; cloudMessage?: string; onCloudUpload: () => Promise<string>; onPrepared: (state: AppState, event: PlanChangeEvent) => void }) {",
"function SettingsPage({ sessionUserId, sessionEmail, cloudMessage, onCloudUpload, onPrepared, onStartTutorial }: { sessionUserId?: string; sessionEmail?: string; cloudMessage?: string; onCloudUpload: () => Promise<string>; onPrepared: (state: AppState, event: PlanChangeEvent) => void; onStartTutorial: () => void }) {")
replace_once(P,
"  return <div className=\"settings-stack\">\n    <SettingsSection title=\"计划基础\"",
"  return <div className=\"settings-stack\">\n    <SettingsSection title=\"演示教程\" description=\"教程运行在独立演示空间，不会修改你的真实计划；也可以从“使用教程”页面重新打开。\"><div className=\"button-wrap\"><button className=\"secondary-button\" onClick={onStartTutorial}>重新体验完整流程</button></div></SettingsSection>\n    <SettingsSection title=\"计划基础\"")

# ---- GoalsPage ----
P = 'src/components/GoalsPage.tsx'
replace_once(P, "import { fmtDate, minutesText } from '../lib/date'", "import { fmtDate, minutesText, shiftDate, todayISO } from '../lib/date'")
replace_once(P, "import { TUTORIAL_GOAL_ID, type TutorialStep } from '../lib/tutorial'", "import { TUTORIAL_GOAL_ID, TUTORIAL_INTAKE_BATCH_ID, TUTORIAL_NEW_GOAL_ID, TUTORIAL_NEW_GOAL_TITLE, type TutorialStep } from '../lib/tutorial'")
replace_once(P,
"export function GoalsPage({ onPrepared, tutorialMode = false, tutorialStep, onTutorialExistingViewed, onTutorialBlocked }: { onPrepared: (prepared: AppState, event: PlanChangeEvent) => void; tutorialMode?: boolean; tutorialStep?: TutorialStep; onTutorialExistingViewed?: () => void; onTutorialBlocked?: (message?: string) => void }) {",
"export function GoalsPage({ onPrepared, tutorialMode = false, tutorialStep, onTutorialExistingViewed, onTutorialGoalCreated, onTutorialGoalLinked, onTutorialBlocked }: { onPrepared: (prepared: AppState, event: PlanChangeEvent) => void; tutorialMode?: boolean; tutorialStep?: TutorialStep; onTutorialExistingViewed?: () => void; onTutorialGoalCreated?: () => void; onTutorialGoalLinked?: () => void; onTutorialBlocked?: (message?: string) => void }) {")
replace_once(P,
"  const [detailGoal, setDetailGoal] = useState<Goal>()\n  const goals = useMemo",
"  const [detailGoal, setDetailGoal] = useState<Goal>()\n  const [tutorialLinkOpen, setTutorialLinkOpen] = useState(false)\n  const [tutorialLinkIds, setTutorialLinkIds] = useState<string[]>([])\n  const goals = useMemo")
replace_once(P,
"  const groupMap = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])\n\n  const save",
"""  const groupMap = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])
  const tutorialBatch = state.intakeBatches.find(batch => batch.id === TUTORIAL_INTAKE_BATCH_ID)
  const tutorialItems = tutorialBatch?.taskGroups.filter(item => !item.appliedAt) ?? []
  const tutorialAnchor = todayISO()
  const tutorialGoalDefaults: GoalDraft = {
    title: TUTORIAL_NEW_GOAL_TITLE,
    description: '把刚才录入的新作业放进同一个完成目标。',
    priority: 3,
    desiredDate: shiftDate(tutorialAnchor, 5),
    latestDate: shiftDate(tutorialAnchor, 7),
    completionConditions: [],
    linkedTaskGroupIds: [],
    linkedAssignmentIds: [],
  }
  const tutorialCanCreate = tutorialMode && tutorialStep === 'goal-create'

  useEffect(() => {
    if (tutorialStep !== 'goal-link') {
      setTutorialLinkOpen(false)
      setTutorialLinkIds([])
    }
  }, [tutorialStep])

  const save""")
replace_once(P,
"  const save = (draft: GoalDraft, goalId?: string) => {\n    const existing = goalId ? state.goals.find(goal => goal.id === goalId) : undefined",
"""  const save = (draft: GoalDraft, goalId?: string) => {
    if (tutorialCanCreate && !goalId) {
      const now = new Date().toISOString()
      commit(next => {
        next.goals = next.goals.filter(goal => goal.id !== TUTORIAL_NEW_GOAL_ID)
        next.goals.push({
          id: TUTORIAL_NEW_GOAL_ID,
          title: tutorialGoalDefaults.title,
          description: tutorialGoalDefaults.description,
          priority: tutorialGoalDefaults.priority,
          desiredDate: tutorialGoalDefaults.desiredDate,
          latestDate: tutorialGoalDefaults.latestDate,
          status: 'active',
          completionConditions: [],
          linkedTaskGroupIds: [],
          linkedAssignmentIds: [],
          createdAt: now,
          updatedAt: now,
        })
      }, { tutorialAction: 'tutorial-goal-create', tutorialTargetId: TUTORIAL_NEW_GOAL_ID })
      setEditing(undefined)
      onTutorialGoalCreated?.()
      return
    }
    const existing = goalId ? state.goals.find(goal => goal.id === goalId) : undefined""")
replace_once(P,
"  const toggleArchive = (goal: Goal) => commit(draft => {",
"""  const confirmTutorialLinks = () => {
    if (!tutorialBatch || tutorialLinkIds.length !== tutorialItems.length || !tutorialItems.length) return
    const selected = new Set(tutorialLinkIds)
    const now = new Date().toISOString()
    commit(next => {
      const batch = next.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)
      if (!batch) return
      batch.taskGroups = batch.taskGroups.map(item => selected.has(item.id) ? { ...item, goalIds: Array.from(new Set([...item.goalIds, TUTORIAL_NEW_GOAL_ID])), updatedAt: now } : item)
      batch.updatedAt = now
    }, { tutorialAction: 'tutorial-goal-link', tutorialTargetId: TUTORIAL_INTAKE_BATCH_ID })
    setTutorialLinkOpen(false)
    setTutorialLinkIds([])
    onTutorialGoalLinked?.()
  }
  const toggleArchive = (goal: Goal) => commit(draft => {""")
replace_once(P,
"<button className={`primary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => tutorialMode ? onTutorialBlocked?.('教程中先查看现有目标') : setEditing(null)}><Plus size={17}/>创建目标</button>",
"<button data-tutorial-target={tutorialCanCreate ? 'tutorial-goal-create' : undefined} className={`primary-button ${tutorialMode && !tutorialCanCreate ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode && !tutorialCanCreate || undefined} onClick={() => tutorialMode && !tutorialCanCreate ? onTutorialBlocked?.('教程中先完成当前这一步') : setEditing(null)}><Plus size={17}/>新建目标</button>")
replace_once(P,
"        {shared.length > 0 && <details><summary>共享任务组的其他目标（{shared.length}）</summary><ul>{shared.map(item => <li key={item.id}>{item.title} · 最晚 {fmtDate(item.latestDate)}</li>)}</ul></details>}\n      </article>",
"        {shared.length > 0 && <details><summary>共享任务组的其他目标（{shared.length}）</summary><ul>{shared.map(item => <li key={item.id}>{item.title} · 最晚 {fmtDate(item.latestDate)}</li>)}</ul></details>}\n        {tutorialMode && tutorialStep === 'goal-link' && goal.id === TUTORIAL_NEW_GOAL_ID && <div className=\"button-wrap\"><button className=\"primary-button\" data-tutorial-target=\"tutorial-goal-link\" onClick={() => { setTutorialLinkIds([]); setTutorialLinkOpen(true) }}>关联任务</button></div>}\n      </article>")
replace_once(P,
"    <GoalDialog open={editing !== undefined} state={state} initial={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={save}/>",
"    <GoalDialog open={editing !== undefined} state={state} initial={editing ?? undefined} tutorialDefaults={tutorialCanCreate && editing === null ? tutorialGoalDefaults : undefined} readOnly={tutorialCanCreate && editing === null} onClose={() => setEditing(undefined)} onSave={save}/>")
replace_once(P,
"    </Modal>\n  </div>\n}\n\nfunction GoalDialog",
"""    </Modal>
    <Modal open={tutorialLinkOpen} title="关联任务到目标" onClose={() => setTutorialLinkOpen(false)} wide mobileFullscreen>
      <div className="form-stack"><p className="muted-text">只选择刚才录入、仍处于待排期状态的内容。确认后，目标会成为这些任务排期与风险判断的约束。</p>
        <div className="goal-condition-list">{tutorialItems.map(item => <label className="checkbox-field" key={item.id}><input type="checkbox" checked={tutorialLinkIds.includes(item.id)} onChange={event => setTutorialLinkIds(current => event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))}/><span><strong>{item.title}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</strong><small>{item.subject} · 每项 {item.unitMinutes} 分钟 · 待排期</small></span></label>)}</div>
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={() => setTutorialLinkOpen(false)}>取消</button><button className="primary-button" data-tutorial-target="tutorial-goal-link-confirm" disabled={!tutorialItems.length || tutorialLinkIds.length !== tutorialItems.length} onClick={confirmTutorialLinks}>确认关联</button></div>
    </Modal>
  </div>
}

function GoalDialog""")

# ---- IntakePage ----
P = 'src/components/IntakePage.tsx'
replace_once(P,
": <button className=\"primary-button\" data-tutorial-target={tutorialStep === 'intake-parse' ? 'tutorial-import-confirm' : undefined} disabled={!importResult.drafts.length || !active} onClick={() => importDrafts(importResult, importSource)}>加入当前批次</button>}",
": <button className=\"primary-button\" data-tutorial-target={tutorialStep === 'intake-parse' ? 'tutorial-import-confirm' : undefined} disabled={!importResult.drafts.length || !active} onClick={() => importDrafts(importResult, importSource)}>{tutorialMode && tutorialStep === 'intake-parse' ? '确认录入' : '加入当前批次'}</button>}")

# ---- ProposalDialog ----
P = 'src/components/ProposalDialog.tsx'
replace_once(P, "'⚠ 目标风险得到缓解'", "'⚠ 目标延期风险得到缓解'")

# ---- tests/tutorial.test.ts ----
P = 'tests/tutorial.test.ts'
replace_once(P, "  TUTORIAL_INTAKE_BATCH_ID,\n  TUTORIAL_PARTIAL_ASSIGNMENT_ID,", "  TUTORIAL_INTAKE_BATCH_ID,\n  TUTORIAL_NEW_GOAL_ID,\n  TUTORIAL_NEW_GOAL_TITLE,\n  TUTORIAL_PARTIAL_ASSIGNMENT_ID,")
replace_once(P,
"  'repair-entry', 'repair-calendar', 'goal-existing', 'intake-entry',\n  'intake-schedule', 'intake-calendar', 'execute-complete', 'execute-partial', 'review-entry', 'review-calendar',\n  'stats', 'stats-detail', 'future-entry', 'future-calendar', 'complete', 'free',",
"  'repair-entry', 'repair-calendar', 'goal-existing', 'intake-entry', 'tasks-intake', 'goal-create', 'goal-link',\n  'intake-schedule', 'intake-calendar', 'execute-complete', 'execute-partial', 'review-entry', 'review-calendar',\n  'stats', 'stats-detail', 'future-entry', 'future-calendar', 'stats-final', 'complete', 'free',")
replace_once(P, "describe('tutorial v2 flow and checkpoints'", "describe('tutorial v4 flow and checkpoints'")
replace_once(P,
"      'intake-entry','intake-source','intake-parse','intake-schedule','intake-preview','intake-calendar',\n      'execute-complete','execute-partial','review-entry','review-carry','review-preview','review-calendar',\n      'stats','stats-detail','future-entry','future-action','future-preview','future-calendar','complete','free',",
"      'intake-entry','intake-source','intake-parse','tasks-intake','goal-create','goal-link','intake-schedule','intake-preview','intake-calendar',\n      'execute-complete','execute-partial','review-entry','review-carry','review-preview','review-calendar',\n      'stats','stats-detail','future-entry','future-action','future-preview','future-calendar','stats-final','complete','free',")
replace_once(P,
"    expect(tutorialPageForStep('intake-entry')).toBe('intake')\n    expect(tutorialPageForStep('stats')).toBe('stats')",
"    expect(tutorialPageForStep('intake-entry')).toBe('intake')\n    expect(tutorialPageForStep('tasks-intake')).toBe('tasks')\n    expect(tutorialPageForStep('goal-create')).toBe('goals')\n    expect(tutorialPageForStep('stats-final')).toBe('stats')")
sub_once(P,
r"  it\('keeps parsed intake, formal scheduling, execution, review and stats checkpoints distinct', \(\) => \{.*?\n  \}\)\n\n  it\('always leaves a legal review carry target",
"""  it('keeps intake, task view, goal creation/linking, scheduling, execution, review and stats checkpoints distinct', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const tasks = buildTutorialCheckpoint('tasks-intake', anchor)
    const batch = tasks.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)!
    expect(batch.taskGroups).toHaveLength(4)
    expect(batch.taskGroups.every(item => !item.appliedAt && item.goalIds.length === 0)).toBe(true)
    expect(tasks.goals.some(item => item.id === TUTORIAL_NEW_GOAL_ID)).toBe(false)

    const goalLink = buildTutorialCheckpoint('goal-link', anchor)
    expect(goalLink.goals.find(item => item.id === TUTORIAL_NEW_GOAL_ID)).toMatchObject({ title: TUTORIAL_NEW_GOAL_TITLE, status: 'active' })
    expect(goalLink.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)?.taskGroups.every(item => item.goalIds.length === 0)).toBe(true)

    const linked = buildTutorialCheckpoint('intake-schedule', anchor)
    expect(linked.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)?.taskGroups.every(item => item.goalIds.includes(TUTORIAL_NEW_GOAL_ID))).toBe(true)

    const scheduled = buildTutorialCheckpoint('intake-calendar', anchor)
    expect(scheduled.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)?.status).toBe('applied')
    expect(scheduled.assignments.filter(item => item.groupId.startsWith('tutorial-added-'))).toHaveLength(7)
    expect(scheduled.goals.some(item => item.title === '读书报告完成目标')).toBe(true)
    const commonGoal = scheduled.goals.find(item => item.id === TUTORIAL_NEW_GOAL_ID)!
    expect(commonGoal.linkedTaskGroupIds).toHaveLength(4)
    expect(commonGoal.completionConditions).toHaveLength(4)

    const complete = buildTutorialCheckpoint('execute-partial', anchor)
    expect(complete.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)).toMatchObject({ status: 'done', actualMinutes: 52 })

    const reviewed = buildTutorialCheckpoint('review-entry', anchor)
    expect(reviewed.assignments.find(item => item.id === TUTORIAL_PARTIAL_ASSIGNMENT_ID)).toMatchObject({ status: 'partial', progress: 50, actualMinutes: 12 })
    expect(reviewed.assignments.find(item => item.id === TUTORIAL_UNFINISHED_ASSIGNMENT_ID)?.status).toBe('todo')
    expect(reviewed.reviewRecords).toHaveLength(0)

    const stats = buildTutorialCheckpoint('stats', anchor)
    expect(stats.reviewRecords.some(item => item.date === anchor)).toBe(true)
    expect(stats.assignments.some(item => item.scheduledDate === anchor && item.status !== 'done' && !item.locked)).toBe(false)
    expect(buildTutorialCheckpoint('stats-final', anchor).reviewRecords.some(item => item.date === anchor)).toBe(true)
    resetNowProvider()
  })

  it('always leaves a legal review carry target""")
replace_once(P, "describe('tutorial v2 recovery and action gates'", "describe('tutorial v4 recovery and action gates'")
replace_once(P,
"    expect(tutorialAllowsCommit(session('goal-create'), 'goal-create')).toBe(false)\n    expect(tutorialAllowsCommit(session('goal-link'), 'goal-link')).toBe(false)",
"    expect(tutorialAllowsCommit(session('goal-create'), 'tutorial-goal-create', TUTORIAL_NEW_GOAL_ID)).toBe(true)\n    expect(tutorialAllowsCommit(session('goal-link'), 'tutorial-goal-link', TUTORIAL_INTAKE_BATCH_ID)).toBe(true)\n    expect(tutorialAllowsCommit(session('goal-create'), 'tutorial-goal-link', TUTORIAL_INTAKE_BATCH_ID)).toBe(false)")

# ---- docs audit ----
P = 'docs/TUTORIAL_FLOW_AUDIT.md'
text = read(P).replace('交互式演示教程 v2', '交互式演示教程 v4').replace('`tutorial:v2`', '`tutorial:v4`')
text = text.replace("| 20 | 查看未来重排后的月历 | 高亮未来变化日期，明确“主动规划 ≠ 救火” | `future-calendar` |", "| 20 | 查看未来重排后的月历并回到统计 | 高亮未来变化日期，明确“主动规划 ≠ 救火”；随后进入统计页查看变化与执行记录 | `future-calendar` → `stats-final` |")
write(P, text)

# ---- rewrite static tutorial audit to enforce the requested route ----
audit = r'''import fs from 'node:fs'
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
'''
write('scripts/tutorial-flow-audit.mjs', audit)

print('tutorial flow v4 updater applied successfully')

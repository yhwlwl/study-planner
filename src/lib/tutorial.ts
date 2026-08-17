import type { AppState, Assignment, Goal, IntakeBatch, IntakeTaskGroupDraft, PlanChangeEvent, TaskGroup, TaskGroupDraft } from '../types'
import { SCHEMA_VERSION } from '../types'
import { dateRange, resetNowProvider, setNowProvider, shiftDate, todayISO } from './date'
import { defaultSettings } from './seed'
import { updateGoalAndGroupLifecycle } from './goals'
import { analyzePlan, suggestMoveDates } from './planner'
import { parsePastedText } from './intake'

export const TUTORIAL_VERSION = 2
export const TUTORIAL_NAMESPACE = `tutorial:v${TUTORIAL_VERSION}`
export const TUTORIAL_GOAL_ID = 'tutorial-goal-math'
export const TUTORIAL_NEW_GOAL_ID = 'tutorial-goal-new-work'
export const TUTORIAL_NEW_GOAL_TITLE = '完成本周新增作业'
export const TUTORIAL_EXECUTE_ASSIGNMENT_ID = 'tutorial-task-math-today'
export const TUTORIAL_PARTIAL_ASSIGNMENT_ID = 'tutorial-task-review-partial'
export const TUTORIAL_UNFINISHED_ASSIGNMENT_ID = 'tutorial-task-review-unfinished'
export const TUTORIAL_INTAKE_BATCH_ID = 'tutorial-intake-batch'
export const TUTORIAL_SESSION_KEY = `study-planner:tutorial-session-v${TUTORIAL_VERSION}`
export const TUTORIAL_COMPLETED_KEY = `study-planner:tutorial-completed-v${TUTORIAL_VERSION}`

export type TutorialStep =
  | 'repair-entry'
  | 'repair-action'
  | 'repair-preview'
  | 'repair-calendar'
  | 'goal-existing'
  | 'intake-entry'
  | 'intake-source'
  | 'intake-parse'
  | 'tasks-intake'
  | 'goal-create'
  | 'goal-link'
  | 'intake-schedule'
  | 'intake-preview'
  | 'intake-calendar'
  | 'execute-complete'
  | 'execute-partial'
  | 'review-entry'
  | 'review-carry'
  | 'review-preview'
  | 'review-calendar'
  | 'stats'
  | 'stats-detail'
  | 'future-entry'
  | 'future-action'
  | 'future-preview'
  | 'future-calendar'
  | 'complete'
  | 'free'

export const TUTORIAL_STEPS: TutorialStep[] = [
  'repair-entry', 'repair-action', 'repair-preview', 'repair-calendar', 'goal-existing',
  'intake-entry', 'intake-source', 'intake-parse', 'tasks-intake', 'goal-create', 'goal-link', 'intake-schedule', 'intake-preview', 'intake-calendar',
  'execute-complete', 'execute-partial', 'review-entry', 'review-carry', 'review-preview', 'review-calendar',
  'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'complete', 'free',
]

function isTutorialStep(value: unknown): value is TutorialStep {
  return typeof value === 'string' && TUTORIAL_STEPS.includes(value as TutorialStep)
}
function isISODate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`))
}

export interface TutorialSession {
  version: number
  anchorDate: string
  step: TutorialStep
  returnNamespace: string
  returnHadData: boolean
  returnPage: 'today' | 'calendar' | 'tasks' | 'intake' | 'goals' | 'stats' | 'export' | 'guide' | 'settings'
  highlightDates?: string[]
  lastChangeLabel?: string
  startedAt: string
  updatedAt: string
}

let volatileSession: TutorialSession | undefined

const transientRecovery: Partial<Record<TutorialStep, TutorialStep>> = {
  'repair-action': 'repair-entry',
  'repair-preview': 'repair-entry',
  'intake-source': 'intake-entry',
  'intake-parse': 'intake-entry',
  'intake-preview': 'intake-schedule',
  'review-carry': 'review-entry',
  'review-preview': 'review-entry',
  'future-action': 'future-entry',
  'future-preview': 'future-entry',
}

function storage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function applyTutorialClock(anchorDate: string) {
  setNowProvider(() => new Date(`${anchorDate}T12:00:00`))
}

export function isTutorialNamespace(namespace: string) {
  return namespace === TUTORIAL_NAMESPACE
}

export function readTutorialSession(): TutorialSession | undefined {
  try {
    const raw = storage()?.getItem(TUTORIAL_SESSION_KEY)
    if (!raw) return volatileSession
    const parsed = JSON.parse(raw) as Partial<TutorialSession>
    if (parsed.version !== TUTORIAL_VERSION || !isISODate(parsed.anchorDate) || !isTutorialStep(parsed.step) || typeof parsed.returnNamespace !== 'string' || !parsed.returnNamespace.trim()) {
      storage()?.removeItem(TUTORIAL_SESSION_KEY)
      volatileSession = undefined
      resetNowProvider()
      return undefined
    }
    applyTutorialClock(parsed.anchorDate)
    const allowedPages: TutorialSession['returnPage'][] = ['today', 'calendar', 'tasks', 'intake', 'goals', 'stats', 'export', 'guide', 'settings']
    const returnPage = allowedPages.includes(parsed.returnPage as TutorialSession['returnPage']) ? parsed.returnPage as TutorialSession['returnPage'] : 'intake'
    volatileSession = {
      ...parsed,
      returnHadData: Boolean(parsed.returnHadData),
      returnPage,
      highlightDates: Array.isArray(parsed.highlightDates) ? parsed.highlightDates.filter(isISODate) : undefined,
    } as TutorialSession
    return volatileSession
  } catch {
    try { storage()?.removeItem(TUTORIAL_SESSION_KEY) } catch { /* storage unavailable */ }
    if (volatileSession) { applyTutorialClock(volatileSession.anchorDate); return volatileSession }
    resetNowProvider()
    return undefined
  }
}

export function writeTutorialSession(session: TutorialSession) {
  volatileSession = session
  try {
    storage()?.setItem(TUTORIAL_SESSION_KEY, JSON.stringify({ ...session, version: TUTORIAL_VERSION, updatedAt: new Date().toISOString() }))
  } catch {
    // Private / restricted contexts can still run the current-tab tutorial.
  }
}

export function createTutorialSession(returnNamespace: string, returnHadData: boolean, anchorDate = todayISO(), returnPage: TutorialSession['returnPage'] = 'intake'): TutorialSession {
  const now = new Date().toISOString()
  const session: TutorialSession = {
    version: TUTORIAL_VERSION,
    anchorDate,
    step: 'repair-entry',
    returnNamespace,
    returnHadData,
    returnPage,
    startedAt: now,
    updatedAt: now,
  }
  applyTutorialClock(anchorDate)
  writeTutorialSession(session)
  return session
}

export function advanceTutorialSession(session: TutorialSession, expected: TutorialStep | TutorialStep[], next: TutorialStep): TutorialSession {
  const allowed = Array.isArray(expected) ? expected : [expected]
  if (!allowed.includes(session.step)) return session
  const updated = { ...session, step: next, highlightDates: undefined, lastChangeLabel: undefined, updatedAt: new Date().toISOString() }
  writeTutorialSession(updated)
  return updated
}

export function clearTutorialSession(markCompleted = false) {
  volatileSession = undefined
  try {
    storage()?.removeItem(TUTORIAL_SESSION_KEY)
    if (markCompleted) storage()?.setItem(TUTORIAL_COMPLETED_KEY, String(TUTORIAL_VERSION))
  } catch {
    // Exit remains safe even if storage is unavailable.
  }
  resetNowProvider()
}

export function markTutorialOfferDismissed() {
  try { storage()?.setItem(TUTORIAL_COMPLETED_KEY, String(TUTORIAL_VERSION)) } catch { /* best effort */ }
}

export function tutorialCompleted() {
  try { return storage()?.getItem(TUTORIAL_COMPLETED_KEY) === String(TUTORIAL_VERSION) } catch { return false }
}

export function recoverTutorialSession(session: TutorialSession): TutorialSession {
  applyTutorialClock(session.anchorDate)
  const safeStep = transientRecovery[session.step] ?? session.step
  if (safeStep === session.step) return session
  const recovered = { ...session, step: safeStep, highlightDates: undefined, lastChangeLabel: undefined, updatedAt: new Date().toISOString() }
  writeTutorialSession(recovered)
  return recovered
}

export function tutorialRecoveryStep(step: TutorialStep): TutorialStep {
  return transientRecovery[step] ?? step
}

export type TutorialPage = 'today' | 'calendar' | 'tasks' | 'intake' | 'goals' | 'stats'

export function tutorialPageForStep(step: TutorialStep): TutorialPage {
  if (['repair-calendar', 'intake-calendar', 'review-calendar', 'future-calendar'].includes(step)) return 'calendar'
  if (['goal-existing', 'goal-create', 'goal-link'].includes(step)) return 'goals'
  if (['intake-entry', 'intake-source', 'intake-parse', 'intake-schedule', 'intake-preview'].includes(step)) return 'intake'
  if (step === 'tasks-intake') return 'tasks'
  if (['stats', 'stats-detail'].includes(step)) return 'stats'
  return 'today'
}

export function tutorialAllowsPage(step: TutorialStep, page: string): boolean {
  if (step === 'free') return ['today', 'calendar', 'tasks', 'intake', 'goals', 'stats', 'export', 'guide', 'timer', 'settings'].includes(page)
  return tutorialPageForStep(step) === page
}

export function tutorialAcceptsEvent(session: TutorialSession, event: PlanChangeEvent): boolean {
  if (session.step === 'repair-action') return event.type === 'execution-difference' && event.metadata?.requestedOutcome === 'fix-current'
  if (session.step === 'intake-schedule') return event.type === 'new-task-insertion' && event.metadata?.intakeBatchId === TUTORIAL_INTAKE_BATCH_ID
  if (session.step === 'review-carry') return event.type === 'execution-difference' && event.metadata?.reviewDate === session.anchorDate
  if (session.step === 'future-action') return event.type === 'future-replanning'
  return false
}

export function tutorialAllowsCommit(session: TutorialSession | undefined, action?: string, targetId?: string): boolean {
  if (!session) return false
  if (session.step === 'free') return true
  if (session.step === 'intake-parse' && action === 'intake-import') return true
  if (session.step === 'goal-create' && action === 'goal-create') return true
  if (session.step === 'goal-link' && action === 'goal-link') return true
  if (session.step === 'execute-complete' && action === 'execute-task' && targetId === TUTORIAL_EXECUTE_ASSIGNMENT_ID) return true
  if (session.step === 'execute-partial' && action === 'execute-task' && targetId === TUTORIAL_PARTIAL_ASSIGNMENT_ID) return true
  return false
}

function stamp(anchorDate: string, hour = '08') {
  return `${anchorDate}T${hour}:00:00.000Z`
}

function group(input: Partial<TaskGroup> & Pick<TaskGroup, 'id' | 'subject' | 'title' | 'priority' | 'quantity' | 'unitMinutes'>, anchorDate: string): TaskGroup {
  const now = stamp(anchorDate)
  return {
    targetDate: shiftDate(anchorDate, 7),
    dueDate: shiftDate(anchorDate, 14),
    countInStats: true,
    activityType: 'normal',
    highIntensity: false,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...input,
  }
}

function assignment(input: Partial<Assignment> & Pick<Assignment, 'id' | 'groupId' | 'index' | 'title' | 'estimatedMinutes'>, anchorDate: string): Assignment {
  const now = stamp(anchorDate)
  return {
    actualMinutes: 0,
    progress: 0,
    status: 'todo',
    locked: false,
    timeEntries: [],
    scheduleSource: 'system',
    intentStrength: 'normal',
    titleCustomized: false,
    durationCustomized: false,
    standalone: false,
    createdAt: now,
    updatedAt: now,
    createdBy: 'template',
    ...input,
  }
}

function baseTutorialState(anchorDate: string): AppState {
  const start = shiftDate(anchorDate, -2)
  const end = shiftDate(anchorDate, 14)
  const goalLatest = shiftDate(anchorDate, 5)
  const now = stamp(anchorDate)
  const groups: TaskGroup[] = [
    group({ id: 'tutorial-group-math', subject: '数学', title: '暑假数学复习', priority: 5, quantity: 4, unitMinutes: 60, targetDate: goalLatest, dueDate: goalLatest, activityType: 'math-paper', highIntensity: true }, anchorDate),
    group({ id: 'tutorial-group-english', subject: '英语', title: '英语阅读训练', priority: 3, quantity: 2, unitMinutes: 55 }, anchorDate),
    group({ id: 'tutorial-group-locked', subject: '物理', title: '老师指定复习', priority: 5, quantity: 1, unitMinutes: 45 }, anchorDate),
    group({ id: 'tutorial-group-notes', subject: '语文', title: '课堂笔记整理', priority: 2, quantity: 2, unitMinutes: 25 }, anchorDate),
  ]
  const assignments: Assignment[] = [
    assignment({ id: 'tutorial-task-done', groupId: 'tutorial-group-math', index: 1, title: '暑假数学复习 01', scheduledDate: shiftDate(anchorDate, -2), estimatedMinutes: 60, status: 'done', progress: 100, actualMinutes: 58, completedAt: stamp(shiftDate(anchorDate, -2), '19'), timeEntries: [{ id: 'tutorial-time-done', minutes: 58, createdAt: stamp(shiftDate(anchorDate, -2), '19'), source: 'manual', countInStatistics: true }] }, anchorDate),
    assignment({ id: 'tutorial-task-overdue', groupId: 'tutorial-group-math', index: 2, title: '暑假数学复习 02', scheduledDate: shiftDate(anchorDate, -1), estimatedMinutes: 60 }, anchorDate),
    assignment({ id: TUTORIAL_EXECUTE_ASSIGNMENT_ID, groupId: 'tutorial-group-math', index: 3, title: '暑假数学复习 03', scheduledDate: anchorDate, estimatedMinutes: 60, intentStrength: 'manual', scheduleSource: 'manual' }, anchorDate),
    assignment({ id: 'tutorial-task-goal-risk', groupId: 'tutorial-group-math', index: 4, title: '暑假数学复习 04', scheduledDate: shiftDate(anchorDate, 8), estimatedMinutes: 60 }, anchorDate),
    assignment({ id: 'tutorial-task-english-today', groupId: 'tutorial-group-english', index: 1, title: '英语阅读训练 01', scheduledDate: anchorDate, estimatedMinutes: 55 }, anchorDate),
    assignment({ id: 'tutorial-task-english-future', groupId: 'tutorial-group-english', index: 2, title: '英语阅读训练 02', scheduledDate: shiftDate(anchorDate, 3), estimatedMinutes: 55 }, anchorDate),
    assignment({ id: 'tutorial-task-locked', groupId: 'tutorial-group-locked', index: 1, title: '老师指定复习', scheduledDate: anchorDate, estimatedMinutes: 45, status: 'done', progress: 100, actualMinutes: 45, completedAt: stamp(anchorDate, '09'), timeEntries: [{ id: 'tutorial-time-locked', minutes: 45, createdAt: stamp(anchorDate, '09'), source: 'manual', countInStatistics: true }], locked: true, intentStrength: 'locked', scheduleSource: 'manual' }, anchorDate),
    assignment({ id: TUTORIAL_PARTIAL_ASSIGNMENT_ID, groupId: 'tutorial-group-notes', index: 1, title: '整理课堂笔记', scheduledDate: anchorDate, estimatedMinutes: 25, intentStrength: 'manual', scheduleSource: 'manual' }, anchorDate),
    assignment({ id: TUTORIAL_UNFINISHED_ASSIGNMENT_ID, groupId: 'tutorial-group-notes', index: 2, title: '整理错题索引', scheduledDate: anchorDate, estimatedMinutes: 30, intentStrength: 'manual', scheduleSource: 'manual' }, anchorDate),
  ]
  const goals: Goal[] = [{
    id: TUTORIAL_GOAL_ID,
    title: '暑假数学 · 5 天内完成',
    description: '教程示例目标：让你看到目标日期会真正参与排期与风险判断。',
    priority: 5,
    desiredDate: shiftDate(anchorDate, 4),
    latestDate: goalLatest,
    status: 'active',
    completionConditions: [{ id: 'tutorial-condition-math', groupId: 'tutorial-group-math', mode: 'all' }],
    linkedTaskGroupIds: ['tutorial-group-math'],
    linkedAssignmentIds: [],
    createdAt: now,
    updatedAt: now,
  }]
  const settings = defaultSettings({
    planName: '教程体验 · 被现实打乱的计划',
    startDate: start,
    endDate: end,
    regularMinutes: 160,
    studyMinutes: 210,
    travelMinutes: 0,
    freezeDays: 0,
    regularMaxTasks: 7,
    studyMaxTasks: 9,
    coreTargetDate: goalLatest,
    chemistryTargetDate: shiftDate(anchorDate, 10),
    planningMode: 'balanced',
    showWarnings: true,
    optionalReview: false,
  })
  return updateGoalAndGroupLifecycle({
    schemaVersion: SCHEMA_VERSION,
    version: SCHEMA_VERSION,
    updatedAt: now,
    settings,
    dayConfigs: Object.fromEntries(dateRange(start, end).map(date => [date, { date, type: 'regular' as const, userSet: false }])),
    taskGroups: groups,
    assignments,
    goals,
    calendarConstraints: [],
    acceptedConstraintExceptions: [],
    timer: { accumulatedSeconds: 0, running: false },
    reviewRecords: [],
    changeEvents: [],
    intakeBatches: [],
    dailyPlanBaselines: [],
    guestModified: false,
    templateKind: 'tutorial',
    replanHistory: [],
    planVersions: [],
    conflictBackups: [],
  })
}

function shortDate(date: string) {
  const [, month, day] = date.split('-').map(Number)
  return `${month}月${day}日`
}

export function tutorialNaturalLanguageText(anchorDate: string) {
  return [
    '数学卷子 2 张，每张 60 分钟',
    '英语阅读 3 篇，每篇 30 分钟',
    `读书报告 1 份，每份 90 分钟，${shortDate(shiftDate(anchorDate, 7))}前完成`,
    '整理物理错题 1 次，每次 45 分钟',
  ].join('\n')
}

function tutorialParsedDrafts(anchorDate: string): TaskGroupDraft[] {
  const result = parsePastedText(tutorialNaturalLanguageText(anchorDate))
  return result.drafts.map((draft, index) => ({
    ...draft,
    latestDate: index === 2 ? shiftDate(anchorDate, 7) : draft.latestDate,
    goalIds: [],
  }))
}

function intakeItemFromDraft(draft: TaskGroupDraft, index: number, anchorDate: string, goalIds: string[] = []): IntakeTaskGroupDraft {
  const now = stamp(anchorDate, '12')
  return {
    ...structuredClone(draft),
    id: `tutorial-intake-item-${index + 1}`,
    kind: 'group',
    goalIds,
    source: 'paste',
    createdAt: now,
    updatedAt: now,
  }
}

export function buildTutorialIntakeBatch(anchorDate: string, parsed = false, goalId?: string): IntakeBatch {
  const now = stamp(anchorDate, '12')
  const items = parsed ? tutorialParsedDrafts(anchorDate).map((draft, index) => intakeItemFromDraft(draft, index, anchorDate, goalId ? [goalId] : [])) : []
  return { id: TUTORIAL_INTAKE_BATCH_ID, name: '刚收到的新作业', status: 'editing', source: parsed ? 'paste' : 'manual', taskGroups: items, createdAt: now, updatedAt: now }
}

export function ensureTutorialIntakeBatch(state: AppState, anchorDate: string): AppState {
  if (state.intakeBatches.some(batch => batch.id === TUTORIAL_INTAKE_BATCH_ID)) return state
  const next = structuredClone(state) as AppState
  next.intakeBatches = [...next.intakeBatches, buildTutorialIntakeBatch(anchorDate, false)]
  next.updatedAt = new Date().toISOString()
  return next
}

function ensureParsedTutorialBatch(state: AppState, anchorDate: string, goalId?: string) {
  const batch = buildTutorialIntakeBatch(anchorDate, true, goalId)
  state.intakeBatches = [...state.intakeBatches.filter(item => item.id !== TUTORIAL_INTAKE_BATCH_ID), batch]
}

function ensureNewTutorialGoal(state: AppState, anchorDate: string) {
  const existing = state.goals.find(goal => goal.title === TUTORIAL_NEW_GOAL_TITLE)
  if (existing) return existing.id
  const now = stamp(anchorDate, '13')
  state.goals.push({
    id: TUTORIAL_NEW_GOAL_ID,
    title: TUTORIAL_NEW_GOAL_TITLE,
    description: '教程中亲手创建的目标，用来约束刚录入的新任务。',
    priority: 3,
    desiredDate: shiftDate(anchorDate, 5),
    latestDate: shiftDate(anchorDate, 7),
    status: 'active',
    completionConditions: [],
    linkedTaskGroupIds: [],
    linkedAssignmentIds: [],
    createdAt: now,
    updatedAt: now,
  })
  return TUTORIAL_NEW_GOAL_ID
}

function applyRepairedShape(state: AppState, anchorDate: string): AppState {
  const byId = new Map(state.assignments.map(item => [item.id, item]))
  const overdue = byId.get('tutorial-task-overdue')
  if (overdue) { overdue.previousDate = overdue.scheduledDate; overdue.scheduledDate = shiftDate(anchorDate, 1); overdue.scheduleSource = 'replan' }
  const risk = byId.get('tutorial-task-goal-risk')
  if (risk) { risk.previousDate = risk.scheduledDate; risk.scheduledDate = shiftDate(anchorDate, 4); risk.scheduleSource = 'replan' }
  const english = byId.get('tutorial-task-english-today')
  if (english) { english.previousDate = english.scheduledDate; english.scheduledDate = shiftDate(anchorDate, 2); english.scheduleSource = 'replan' }
  state.updatedAt = stamp(anchorDate, '13')
  return updateGoalAndGroupLifecycle(state)
}

function buildRepairedCheckpoint(anchorDate: string): AppState {
  return applyRepairedShape(baseTutorialState(anchorDate), anchorDate)
}

export function buildTutorialRepairedFrom(source: AppState, anchorDate: string): AppState {
  return applyRepairedShape(structuredClone(source) as AppState, anchorDate)
}

function addCanonicalIntakeAssignments(state: AppState, anchorDate: string) {
  const now = stamp(anchorDate, '14')
  const goalId = ensureNewTutorialGoal(state, anchorDate)
  const canonicalGroupIds = new Set(['tutorial-added-math', 'tutorial-added-english', 'tutorial-added-report', 'tutorial-added-physics'])
  state.taskGroups = state.taskGroups.filter(item => !canonicalGroupIds.has(item.id))
  state.assignments = state.assignments.filter(item => !canonicalGroupIds.has(item.groupId))

  const definitions: Array<{ group: TaskGroup; tasks: Assignment[] }> = [
    {
      group: group({ id: 'tutorial-added-math', subject: '数学', title: '数学卷子', priority: 3, quantity: 2, unitMinutes: 60 }, anchorDate),
      tasks: [1, 2].map(index => assignment({ id: `tutorial-added-math-${index}`, groupId: 'tutorial-added-math', index, title: `数学卷子 ${String(index).padStart(2, '0')}`, estimatedMinutes: 60, scheduledDate: shiftDate(anchorDate, index) }, anchorDate)),
    },
    {
      group: group({ id: 'tutorial-added-english', subject: '英语', title: '英语阅读', priority: 3, quantity: 3, unitMinutes: 30 }, anchorDate),
      tasks: [1, 2, 3].map(index => assignment({ id: `tutorial-added-english-${index}`, groupId: 'tutorial-added-english', index, title: `英语阅读 ${String(index).padStart(2, '0')}`, estimatedMinutes: 30, scheduledDate: shiftDate(anchorDate, index + 2) }, anchorDate)),
    },
    {
      group: group({ id: 'tutorial-added-report', subject: '语文', title: '读书报告', priority: 3, quantity: 1, unitMinutes: 90, hidden: true, hiddenStandalone: true }, anchorDate),
      tasks: [assignment({ id: 'tutorial-added-report-1', groupId: 'tutorial-added-report', index: 1, title: '读书报告', estimatedMinutes: 90, scheduledDate: shiftDate(anchorDate, 5), standalone: true }, anchorDate)],
    },
    {
      group: group({ id: 'tutorial-added-physics', subject: '物理', title: '整理物理错题', priority: 3, quantity: 1, unitMinutes: 45, hidden: true, hiddenStandalone: true }, anchorDate),
      tasks: [assignment({ id: 'tutorial-added-physics-1', groupId: 'tutorial-added-physics', index: 1, title: '整理物理错题', estimatedMinutes: 45, scheduledDate: shiftDate(anchorDate, 4), standalone: true }, anchorDate)],
    },
  ]
  state.taskGroups.push(...definitions.map(item => item.group))
  state.assignments.push(...definitions.flatMap(item => item.tasks))
  const linkedGroupIds = definitions.map(item => item.group.id)
  const goal = state.goals.find(item => item.id === goalId)!
  goal.linkedTaskGroupIds = linkedGroupIds
  goal.completionConditions = linkedGroupIds.map((groupId, index) => ({ id: `tutorial-new-condition-${index + 1}`, groupId, mode: 'all' as const }))
  goal.updatedAt = now

  const batch = buildTutorialIntakeBatch(anchorDate, true, goalId)
  batch.status = 'applied'
  batch.updatedAt = now
  batch.taskGroups = batch.taskGroups.map((item, index) => ({
    ...item,
    appliedAt: now,
    appliedGroupId: definitions[index]?.group.id,
    appliedAssignmentId: definitions[index]?.tasks.length === 1 ? definitions[index].tasks[0].id : undefined,
  }))
  state.intakeBatches = [batch]
  state.updatedAt = now
}

function buildScheduledCheckpoint(anchorDate: string): AppState {
  const state = buildRepairedCheckpoint(anchorDate)
  addCanonicalIntakeAssignments(state, anchorDate)
  return updateGoalAndGroupLifecycle(state)
}

export function buildTutorialScheduledFrom(source: AppState, anchorDate: string): AppState {
  const state = structuredClone(source) as AppState
  addCanonicalIntakeAssignments(state, anchorDate)
  return updateGoalAndGroupLifecycle(state)
}

function buildCompleteCheckpoint(anchorDate: string): AppState {
  const state = buildScheduledCheckpoint(anchorDate)
  const complete = state.assignments.find(task => task.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)!
  complete.status = 'done'
  complete.progress = 100
  complete.actualMinutes = 52
  complete.completedAt = stamp(anchorDate, '18')
  complete.timeEntries = [{ id: 'tutorial-time-execute', minutes: 52, createdAt: stamp(anchorDate, '18'), source: 'manual', countInStatistics: true }]
  return updateGoalAndGroupLifecycle(state)
}

function buildExecutedCheckpoint(anchorDate: string): AppState {
  const state = buildCompleteCheckpoint(anchorDate)
  const partial = state.assignments.find(task => task.id === TUTORIAL_PARTIAL_ASSIGNMENT_ID)!
  partial.status = 'partial'
  partial.progress = 50
  partial.actualMinutes = 12
  partial.timeEntries = [{ id: 'tutorial-time-partial', minutes: 12, createdAt: stamp(anchorDate, '18'), source: 'manual', countInStatistics: true }]
  return updateGoalAndGroupLifecycle(state)
}

function buildReviewedCheckpoint(anchorDate: string): AppState {
  const state = buildExecutedCheckpoint(anchorDate)
  const plannedAssignmentIds = state.assignments.filter(task => task.scheduledDate === anchorDate).map(task => task.id)
  const completedAssignmentIds = state.assignments.filter(task => plannedAssignmentIds.includes(task.id) && task.status === 'done').map(task => task.id)
  const unfinishedAssignmentIds = state.assignments.filter(task => plannedAssignmentIds.includes(task.id) && task.status !== 'done').map(task => task.id)
  const plannedMinutes = state.assignments.filter(task => plannedAssignmentIds.includes(task.id)).reduce((sum, task) => sum + task.estimatedMinutes, 0)
  const actualMinutes = state.assignments.filter(task => plannedAssignmentIds.includes(task.id)).reduce((sum, task) => sum + task.actualMinutes, 0)
  state.reviewRecords = [{
    id: 'tutorial-review', date: anchorDate, createdAt: stamp(anchorDate, '20'),
    completedCount: completedAssignmentIds.length, totalCount: plannedAssignmentIds.length, plannedMinutes, actualMinutes, inferredMinutes: 0,
    plannedAssignmentIds, executedAssignmentIds: state.assignments.filter(task => plannedAssignmentIds.includes(task.id) && task.actualMinutes > 0).map(task => task.id), completedAssignmentIds, unfinishedAssignmentIds, durationSuggestionGroupIds: [],
  }]
  let offset = 1
  for (const item of state.assignments.filter(task => task.scheduledDate === anchorDate && task.status !== 'done' && !task.locked)) {
    item.previousDate = anchorDate
    item.scheduledDate = shiftDate(anchorDate, offset)
    item.scheduleSource = 'carryover'
    item.intentStrength = 'manual'
    offset += 1
  }
  return updateGoalAndGroupLifecycle(state)
}

export function buildTutorialFutureFrom(source: AppState, anchorDate: string): AppState {
  const state = structuredClone(source) as AppState
  const candidates = state.assignments.filter(item => item.status !== 'done' && !item.locked && item.scheduledDate && item.scheduledDate > anchorDate)
  const movedAt = stamp(anchorDate, '21')
  for (const [index, item] of candidates.slice(0, 2).entries()) {
    item.previousDate = item.scheduledDate
    item.scheduledDate = shiftDate(item.scheduledDate!, index === 0 ? 1 : -1)
    item.scheduleSource = 'replan'
    item.updatedAt = movedAt
  }
  state.updatedAt = movedAt
  return updateGoalAndGroupLifecycle(state)
}

export function buildTutorialState(anchorDate = todayISO()): AppState {
  return baseTutorialState(anchorDate)
}

export function buildTutorialCheckpoint(step: TutorialStep, anchorDate: string): AppState {
  if (['repair-entry', 'repair-action', 'repair-preview'].includes(step)) return baseTutorialState(anchorDate)
  if (['repair-calendar', 'goal-existing'].includes(step)) return buildRepairedCheckpoint(anchorDate)
  if (['intake-entry', 'intake-source', 'intake-parse'].includes(step)) return ensureTutorialIntakeBatch(buildRepairedCheckpoint(anchorDate), anchorDate)
  if (['tasks-intake', 'goal-create'].includes(step)) {
    const state = buildRepairedCheckpoint(anchorDate)
    ensureParsedTutorialBatch(state, anchorDate)
    return state
  }
  if (step === 'goal-link') {
    const state = buildRepairedCheckpoint(anchorDate)
    ensureParsedTutorialBatch(state, anchorDate)
    ensureNewTutorialGoal(state, anchorDate)
    return state
  }
  if (['intake-schedule', 'intake-preview'].includes(step)) {
    const state = buildRepairedCheckpoint(anchorDate)
    const goalId = ensureNewTutorialGoal(state, anchorDate)
    ensureParsedTutorialBatch(state, anchorDate, goalId)
    return state
  }
  if (['intake-calendar', 'execute-complete'].includes(step)) return buildScheduledCheckpoint(anchorDate)
  if (step === 'execute-partial') return buildCompleteCheckpoint(anchorDate)
  if (['review-entry', 'review-carry', 'review-preview'].includes(step)) return buildExecutedCheckpoint(anchorDate)
  if (['review-calendar', 'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview'].includes(step)) return buildReviewedCheckpoint(anchorDate)
  if (['future-calendar', 'complete', 'free'].includes(step)) return buildTutorialFutureFrom(buildReviewedCheckpoint(anchorDate), anchorDate)
  return baseTutorialState(anchorDate)
}

export function tutorialIssueCount(state: AppState, anchorDate: string) {
  const overdue = state.assignments.some(item => item.status !== 'done' && item.scheduledDate && item.scheduledDate < anchorDate)
  const capacityDanger = analyzePlan(state, anchorDate).some(issue => issue.level === 'danger' && (issue.message.includes('容量') || issue.message.includes('超过') || issue.message.includes('超载')))
  const goal = state.goals.find(item => item.id === TUTORIAL_GOAL_ID)
  const riskTask = state.assignments.find(item => item.id === 'tutorial-task-goal-risk')
  const goalRisk = Boolean(goal && riskTask?.scheduledDate && riskTask.scheduledDate > goal.latestDate)
  return Number(overdue) + Number(capacityDanger) + Number(goalRisk)
}

export function tutorialEventForTarget(baseline: AppState, target: AppState, event: PlanChangeEvent): PlanChangeEvent {
  const beforeAssignments = new Map(baseline.assignments.map(item => [item.id, item]))
  const affectedAssignmentIds = new Set(event.affectedAssignmentIds)
  const affectedGroupIds = new Set(event.affectedGroupIds)
  const affectedDates = new Set(event.affectedDates)
  for (const item of target.assignments) {
    const before = beforeAssignments.get(item.id)
    const changed = !before || before.scheduledDate !== item.scheduledDate || before.status !== item.status || before.progress !== item.progress || before.actualMinutes !== item.actualMinutes
    if (!changed) continue
    affectedAssignmentIds.add(item.id)
    affectedGroupIds.add(item.groupId)
    if (before?.scheduledDate) affectedDates.add(before.scheduledDate)
    if (item.scheduledDate) affectedDates.add(item.scheduledDate)
  }
  const affectedGoalIds = new Set(event.affectedGoalIds)
  for (const goal of target.goals) {
    if (goal.linkedAssignmentIds.some(id => affectedAssignmentIds.has(id)) || goal.linkedTaskGroupIds.some(id => affectedGroupIds.has(id)) || goal.completionConditions.some(condition => affectedGroupIds.has(condition.groupId))) affectedGoalIds.add(goal.id)
  }
  return { ...event, affectedAssignmentIds: [...affectedAssignmentIds], affectedGroupIds: [...affectedGroupIds], affectedGoalIds: [...affectedGoalIds], affectedDates: [...affectedDates].sort() }
}

function tutorialBatch(state: AppState) {
  return state.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)
}

function hasParsedTutorialIntake(state: AppState) {
  const batch = tutorialBatch(state)
  if (!batch || batch.taskGroups.length !== 4) return false
  const signatures = batch.taskGroups.map(item => `${item.subject}:${item.title}:${item.quantity}:${item.unitMinutes}`)
  return signatures.some(item => item.startsWith('数学:数学卷子:2:60'))
    && signatures.some(item => item.startsWith('英语:英语阅读:3:30'))
    && signatures.some(item => item.includes('读书报告:1:90'))
    && signatures.some(item => item.includes('物理:整理物理错题:1:45'))
}

function hasLinkedTutorialIntake(state: AppState) {
  const goal = state.goals.find(item => item.title === TUTORIAL_NEW_GOAL_TITLE)
  const batch = tutorialBatch(state)
  return Boolean(goal && batch?.taskGroups.length === 4 && batch.taskGroups.every(item => item.goalIds.includes(goal.id)))
}

function hasAppliedTutorialIntake(state: AppState) {
  const batch = tutorialBatch(state)
  if (!batch || batch.status !== 'applied' || batch.taskGroups.some(item => !item.appliedAt)) return false
  return batch.taskGroups.every(item => {
    if (item.kind === 'single') return Boolean(item.appliedAssignmentId && state.assignments.some(task => task.id === item.appliedAssignmentId))
    return Boolean(item.appliedGroupId && state.taskGroups.some(group => group.id === item.appliedGroupId) && state.assignments.some(task => task.groupId === item.appliedGroupId))
  })
}

function hasReviewCarryCandidate(state: AppState, anchorDate: string) {
  return state.assignments
    .filter(item => item.scheduledDate === anchorDate && item.status !== 'done' && !item.locked && state.timer.assignmentId !== item.id)
    .some(item => suggestMoveDates(state, item.id, 8).some(date => date > anchorDate))
}

export function tutorialStateHealth(state: AppState, session: TutorialSession) {
  if (state.templateKind !== 'tutorial') return { ok: false as const, reason: '当前不是教程数据空间' }
  if (todayISO() !== session.anchorDate) return { ok: false as const, reason: '教程时钟没有保持在进入时的日期' }

  const requiredIds = [TUTORIAL_GOAL_ID, TUTORIAL_EXECUTE_ASSIGNMENT_ID, TUTORIAL_PARTIAL_ASSIGNMENT_ID, TUTORIAL_UNFINISHED_ASSIGNMENT_ID, 'tutorial-task-locked', 'tutorial-task-done', 'tutorial-task-overdue', 'tutorial-task-goal-risk']
  const ids = new Set([...state.goals.map(item => item.id), ...state.assignments.map(item => item.id)])
  const missing = requiredIds.filter(id => !ids.has(id))
  if (missing.length) return { ok: false as const, reason: `教程关键数据缺失：${missing.join(', ')}` }

  const anchor = session.anchorDate
  const locked = state.assignments.find(item => item.id === 'tutorial-task-locked')
  const historical = state.assignments.find(item => item.id === 'tutorial-task-done')
  if (!locked?.locked || locked.status !== 'done' || locked.scheduledDate !== anchor) return { ok: false as const, reason: '教程锁定完成任务状态异常' }
  if (historical?.status !== 'done' || historical.scheduledDate !== shiftDate(anchor, -2)) return { ok: false as const, reason: '教程历史完成记录异常' }

  const initial = ['repair-entry', 'repair-action', 'repair-preview'].includes(session.step)
  if (initial) {
    const overdue = state.assignments.find(item => item.id === 'tutorial-task-overdue')
    const risk = state.assignments.find(item => item.id === 'tutorial-task-goal-risk')
    if (overdue?.scheduledDate !== shiftDate(anchor, -1)) return { ok: false as const, reason: '教程逾期问题被意外改变' }
    if (!risk?.scheduledDate || risk.scheduledDate <= shiftDate(anchor, 5)) return { ok: false as const, reason: '教程目标风险被意外改变' }
  } else {
    const overdue = state.assignments.find(item => item.id === 'tutorial-task-overdue')
    if (!overdue?.scheduledDate || overdue.scheduledDate < anchor) return { ok: false as const, reason: '教程修复后的逾期任务仍在过去' }
  }

  if (['intake-entry', 'intake-source', 'intake-parse'].includes(session.step) && !tutorialBatch(state)) return { ok: false as const, reason: '教程录入批次缺失' }
  if (['tasks-intake', 'goal-create', 'goal-link', 'intake-schedule', 'intake-preview'].includes(session.step) && !hasParsedTutorialIntake(state)) return { ok: false as const, reason: '教程自然语言录入结果缺失' }
  if (['goal-link', 'intake-schedule', 'intake-preview'].includes(session.step) && !state.goals.some(goal => goal.title === TUTORIAL_NEW_GOAL_TITLE)) return { ok: false as const, reason: '教程新目标缺失' }
  if (['intake-schedule', 'intake-preview'].includes(session.step) && !hasLinkedTutorialIntake(state)) return { ok: false as const, reason: '教程新任务尚未关联新目标' }

  if (['intake-calendar', 'execute-complete', 'execute-partial', 'review-entry', 'review-carry', 'review-preview', 'review-calendar', 'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'complete', 'free'].includes(session.step)) {
    if (!hasAppliedTutorialIntake(state)) return { ok: false as const, reason: '教程新增任务 checkpoint 缺失或未应用' }
  }

  if (['execute-partial', 'review-entry', 'review-carry', 'review-preview', 'review-calendar', 'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'complete', 'free'].includes(session.step)) {
    const executed = state.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)
    if (executed?.status !== 'done' || executed.actualMinutes < 1 || executed.actualMinutes > 65 || executed.timeEntries.length === 0) return { ok: false as const, reason: '教程完整完成任务 checkpoint 异常' }
  }

  if (['review-entry', 'review-carry', 'review-preview', 'review-calendar', 'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'complete', 'free'].includes(session.step)) {
    const partial = state.assignments.find(item => item.id === TUTORIAL_PARTIAL_ASSIGNMENT_ID)
    if (partial?.status !== 'partial' || partial.progress <= 0 || partial.progress >= 100 || partial.actualMinutes <= 0) return { ok: false as const, reason: '教程部分完成任务 checkpoint 异常' }
  }

  if (['review-entry', 'review-carry', 'review-preview'].includes(session.step) && !hasReviewCarryCandidate(state, anchor)) return { ok: false as const, reason: '教程复盘没有可顺延的未完成任务' }

  if (['review-calendar', 'stats', 'stats-detail', 'future-entry', 'future-action', 'future-preview', 'future-calendar', 'complete', 'free'].includes(session.step)) {
    if (!state.reviewRecords.some(item => item.date === anchor)) return { ok: false as const, reason: '教程复盘 checkpoint 缺失' }
    if (state.assignments.some(item => item.scheduledDate === anchor && item.status !== 'done' && !item.locked)) return { ok: false as const, reason: '教程复盘后的未完成任务仍留在当天' }
  }

  return { ok: true as const }
}

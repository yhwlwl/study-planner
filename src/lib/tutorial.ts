import type { AppState, Assignment, Goal, IntakeBatch, IntakeTaskGroupDraft, PlanChangeEvent, TaskGroup } from '../types'
import { SCHEMA_VERSION } from '../types'
import { dateRange, resetNowProvider, setNowProvider, shiftDate, todayISO } from './date'
import { defaultSettings } from './seed'
import { updateGoalAndGroupLifecycle } from './goals'
import { analyzePlan, suggestMoveDates } from './planner'

export const TUTORIAL_VERSION = 1
export const TUTORIAL_NAMESPACE = `tutorial:v${TUTORIAL_VERSION}`
export const TUTORIAL_GOAL_ID = 'tutorial-goal-math'
export const TUTORIAL_EXECUTE_ASSIGNMENT_ID = 'tutorial-task-math-today'
export const TUTORIAL_SESSION_KEY = `study-planner:tutorial-session-v${TUTORIAL_VERSION}`
export const TUTORIAL_COMPLETED_KEY = `study-planner:tutorial-completed-v${TUTORIAL_VERSION}`

export type TutorialStep =
  | 'repair-entry'
  | 'repair-action'
  | 'repair-preview'
  | 'goal'
  | 'intake'
  | 'intake-preview'
  | 'execute'
  | 'review-entry'
  | 'review-carry'
  | 'review-preview'
  | 'future-entry'
  | 'future-action'
  | 'future-preview'
  | 'complete'
  | 'free'

export const TUTORIAL_STEPS: TutorialStep[] = [
  'repair-entry', 'repair-action', 'repair-preview', 'goal', 'intake', 'intake-preview', 'execute',
  'review-entry', 'review-carry', 'review-preview', 'future-entry', 'future-action', 'future-preview', 'complete', 'free',
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
  startedAt: string
  updatedAt: string
}

let volatileSession: TutorialSession | undefined

const transientRecovery: Partial<Record<TutorialStep, TutorialStep>> = {
  'repair-action': 'repair-entry',
  'repair-preview': 'repair-entry',
  'intake-preview': 'intake',
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
    volatileSession = { ...parsed, returnHadData: Boolean(parsed.returnHadData), returnPage } as TutorialSession
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
    // Storage may be unavailable in private/restricted browser contexts.
    // The in-memory session still works for the current tab; refresh recovery simply degrades gracefully.
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
  const updated = { ...session, step: next, updatedAt: new Date().toISOString() }
  writeTutorialSession(updated)
  return updated
}

export function clearTutorialSession(markCompleted = false) {
  volatileSession = undefined
  try {
    storage()?.removeItem(TUTORIAL_SESSION_KEY)
    if (markCompleted) storage()?.setItem(TUTORIAL_COMPLETED_KEY, String(TUTORIAL_VERSION))
  } catch {
    // Keep exit safe even when browser storage is unavailable.
  }
  resetNowProvider()
}

export function tutorialCompleted() {
  try { return storage()?.getItem(TUTORIAL_COMPLETED_KEY) === String(TUTORIAL_VERSION) } catch { return false }
}

export function recoverTutorialSession(session: TutorialSession): TutorialSession {
  applyTutorialClock(session.anchorDate)
  const safeStep = transientRecovery[session.step] ?? session.step
  if (safeStep === session.step) return session
  const recovered = { ...session, step: safeStep, updatedAt: new Date().toISOString() }
  writeTutorialSession(recovered)
  return recovered
}

export function tutorialRecoveryStep(step: TutorialStep): TutorialStep {
  return transientRecovery[step] ?? step
}

export function tutorialPageForStep(step: TutorialStep): 'today' | 'intake' | 'goals' {
  if (step === 'goal') return 'goals'
  if (step === 'intake' || step === 'intake-preview') return 'intake'
  return 'today'
}

export function tutorialAllowsPage(step: TutorialStep, page: string): boolean {
  if (step === 'free') return ['today', 'calendar', 'tasks', 'intake', 'goals', 'stats', 'export', 'guide', 'timer'].includes(page)
  return tutorialPageForStep(step) === page
}

export function tutorialAcceptsEvent(session: TutorialSession, event: PlanChangeEvent): boolean {
  if (session.step === 'repair-action') return event.type === 'execution-difference' && event.metadata?.requestedOutcome === 'fix-current'
  if (session.step === 'intake') return event.type === 'new-task-insertion' && event.metadata?.intakeBatchId === 'tutorial-intake-batch'
  if (session.step === 'review-carry') return event.type === 'execution-difference' && event.metadata?.reviewDate === session.anchorDate
  if (session.step === 'future-action') return event.type === 'future-replanning'
  return false
}

export function tutorialAllowsCommit(session: TutorialSession | undefined, action?: string, targetId?: string): boolean {
  if (!session) return false
  if (session.step === 'free') return true
  return session.step === 'execute' && action === 'execute-task' && targetId === TUTORIAL_EXECUTE_ASSIGNMENT_ID
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
    group({ id: 'tutorial-group-notes', subject: '语文', title: '课堂笔记整理', priority: 2, quantity: 1, unitMinutes: 20 }, anchorDate),
  ]
  const assignments: Assignment[] = [
    assignment({ id: 'tutorial-task-done', groupId: 'tutorial-group-math', index: 1, title: '暑假数学复习 01', scheduledDate: shiftDate(anchorDate, -2), estimatedMinutes: 60, status: 'done', progress: 100, actualMinutes: 58, completedAt: stamp(shiftDate(anchorDate, -2), '19'), timeEntries: [{ id: 'tutorial-time-done', minutes: 58, createdAt: stamp(shiftDate(anchorDate, -2), '19'), source: 'manual', countInStatistics: true }] }, anchorDate),
    assignment({ id: 'tutorial-task-overdue', groupId: 'tutorial-group-math', index: 2, title: '暑假数学复习 02', scheduledDate: shiftDate(anchorDate, -1), estimatedMinutes: 60 }, anchorDate),
    assignment({ id: TUTORIAL_EXECUTE_ASSIGNMENT_ID, groupId: 'tutorial-group-math', index: 3, title: '暑假数学复习 03', scheduledDate: anchorDate, estimatedMinutes: 60, intentStrength: 'manual', scheduleSource: 'manual' }, anchorDate),
    assignment({ id: 'tutorial-task-goal-risk', groupId: 'tutorial-group-math', index: 4, title: '暑假数学复习 04', scheduledDate: shiftDate(anchorDate, 8), estimatedMinutes: 60 }, anchorDate),
    assignment({ id: 'tutorial-task-english-today', groupId: 'tutorial-group-english', index: 1, title: '英语阅读训练 01', scheduledDate: anchorDate, estimatedMinutes: 55 }, anchorDate),
    assignment({ id: 'tutorial-task-english-future', groupId: 'tutorial-group-english', index: 2, title: '英语阅读训练 02', scheduledDate: shiftDate(anchorDate, 3), estimatedMinutes: 55 }, anchorDate),
    assignment({ id: 'tutorial-task-locked', groupId: 'tutorial-group-locked', index: 1, title: '老师指定复习', scheduledDate: anchorDate, estimatedMinutes: 45, status: 'done', progress: 100, actualMinutes: 45, completedAt: stamp(anchorDate, '09'), timeEntries: [{ id: 'tutorial-time-locked', minutes: 45, createdAt: stamp(anchorDate, '09'), source: 'manual', countInStatistics: true }], locked: true, intentStrength: 'locked', scheduleSource: 'manual' }, anchorDate),
    assignment({ id: 'tutorial-task-review-leftover', groupId: 'tutorial-group-notes', index: 1, title: '整理课堂笔记', scheduledDate: anchorDate, estimatedMinutes: 20, intentStrength: 'manual', scheduleSource: 'manual' }, anchorDate),
  ]
  const goals: Goal[] = [{
    id: TUTORIAL_GOAL_ID,
    title: '5 天内完成暑假数学复习',
    description: '教程目标：让你看到目标日期会真正参与排期与风险判断。',
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
    regularMinutes: 130,
    studyMinutes: 180,
    travelMinutes: 0,
    freezeDays: 0,
    regularMaxTasks: 6,
    studyMaxTasks: 8,
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

export function buildTutorialIntakeBatch(anchorDate: string): IntakeBatch {
  const now = stamp(anchorDate, '12')
  const latest = shiftDate(anchorDate, 10)
  const items: IntakeTaskGroupDraft[] = [
    {
      id: 'tutorial-intake-physics', kind: 'group', title: '物理错题整理', subject: '物理', priority: 3,
      unitMinutes: 35, activityType: 'normal', highIntensity: false, countInStats: true, quantity: 2,
      goalIds: [], latestDate: latest, source: 'manual', createdAt: now, updatedAt: now,
    },
    {
      id: 'tutorial-intake-reading', kind: 'single', title: '完成读书报告提纲', subject: '语文', priority: 2,
      unitMinutes: 45, activityType: 'normal', highIntensity: false, countInStats: true, quantity: 1,
      goalIds: [], latestDate: shiftDate(anchorDate, 8), source: 'manual', createdAt: now, updatedAt: now,
    },
    {
      id: 'tutorial-intake-english', kind: 'group', title: '英语新作业', subject: '英语', priority: 3,
      unitMinutes: 30, activityType: 'normal', highIntensity: false, countInStats: true, quantity: 2,
      dailyMax: 1, goalIds: [], latestDate: latest, source: 'manual', createdAt: now, updatedAt: now,
    },
  ]
  return { id: 'tutorial-intake-batch', name: '刚收到的新作业', status: 'editing', source: 'manual', taskGroups: items, createdAt: now, updatedAt: now }
}

export function ensureTutorialIntakeBatch(state: AppState, anchorDate: string): AppState {
  if (state.intakeBatches.some(batch => batch.id === 'tutorial-intake-batch')) return state
  const next = structuredClone(state) as AppState
  next.intakeBatches = [...next.intakeBatches, buildTutorialIntakeBatch(anchorDate)]
  next.updatedAt = new Date().toISOString()
  return next
}

function applyRepairedShape(state: AppState, anchorDate: string): AppState {
  const byId = new Map(state.assignments.map(item => [item.id, item]))
  const overdue = byId.get('tutorial-task-overdue')!
  overdue.previousDate = overdue.scheduledDate
  overdue.scheduledDate = shiftDate(anchorDate, 1)
  overdue.scheduleSource = 'replan'
  const risk = byId.get('tutorial-task-goal-risk')!
  risk.previousDate = risk.scheduledDate
  risk.scheduledDate = shiftDate(anchorDate, 4)
  risk.scheduleSource = 'replan'
  const english = byId.get('tutorial-task-english-today')!
  english.previousDate = english.scheduledDate
  english.scheduledDate = shiftDate(anchorDate, 2)
  english.scheduleSource = 'replan'
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
  const now = stamp(anchorDate, '13')
  const canonicalGroupIds = new Set(['tutorial-added-physics', 'tutorial-added-reading', 'tutorial-added-english'])
  state.taskGroups = state.taskGroups.filter(item => !canonicalGroupIds.has(item.id))
  state.assignments = state.assignments.filter(item => !canonicalGroupIds.has(item.groupId))
  const groupInputs: Array<{ group: TaskGroup; tasks: Assignment[] }> = [
    {
      group: group({ id: 'tutorial-added-physics', subject: '物理', title: '物理错题整理', priority: 3, quantity: 2, unitMinutes: 35 }, anchorDate),
      tasks: [1, 2].map(index => assignment({ id: `tutorial-added-physics-${index}`, groupId: 'tutorial-added-physics', index, title: `物理错题整理 ${String(index).padStart(2, '0')}`, estimatedMinutes: 35, scheduledDate: shiftDate(anchorDate, 6 + index) }, anchorDate)),
    },
    {
      group: group({ id: 'tutorial-added-reading', subject: '语文', title: '完成读书报告提纲', priority: 2, quantity: 1, unitMinutes: 45, hidden: true, hiddenStandalone: true }, anchorDate),
      tasks: [assignment({ id: 'tutorial-added-reading-1', groupId: 'tutorial-added-reading', index: 1, title: '完成读书报告提纲', estimatedMinutes: 45, scheduledDate: shiftDate(anchorDate, 6), standalone: true }, anchorDate)],
    },
    {
      group: group({ id: 'tutorial-added-english', subject: '英语', title: '英语新作业', priority: 3, quantity: 2, unitMinutes: 30, dailyMax: 1 }, anchorDate),
      tasks: [1, 2].map(index => assignment({ id: `tutorial-added-english-${index}`, groupId: 'tutorial-added-english', index, title: `英语新作业 ${String(index).padStart(2, '0')}`, estimatedMinutes: 30, scheduledDate: shiftDate(anchorDate, 5 + index) }, anchorDate)),
    },
  ]
  state.taskGroups.push(...groupInputs.map(item => item.group))
  state.assignments.push(...groupInputs.flatMap(item => item.tasks))
  const batch = buildTutorialIntakeBatch(anchorDate)
  batch.status = 'applied'
  batch.updatedAt = now
  batch.taskGroups = batch.taskGroups.map((item, index) => ({ ...item, appliedAt: now, appliedGroupId: groupInputs[index].group.id, appliedAssignmentId: item.kind === 'single' ? groupInputs[index].tasks[0].id : undefined }))
  state.intakeBatches = [batch]
}

function buildScheduledCheckpoint(anchorDate: string): AppState {
  const state = buildRepairedCheckpoint(anchorDate)
  addCanonicalIntakeAssignments(state, anchorDate)
  return updateGoalAndGroupLifecycle(state)
}

export function buildTutorialScheduledFrom(source: AppState, anchorDate: string): AppState {
  const state = structuredClone(source) as AppState
  addCanonicalIntakeAssignments(state, anchorDate)
  state.updatedAt = stamp(anchorDate, '14')
  return updateGoalAndGroupLifecycle(state)
}

function buildExecutedCheckpoint(anchorDate: string): AppState {
  const state = buildScheduledCheckpoint(anchorDate)
  const item = state.assignments.find(task => task.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)!
  item.status = 'done'
  item.progress = 100
  item.actualMinutes = 52
  item.completedAt = stamp(anchorDate, '18')
  item.timeEntries = [{ id: 'tutorial-time-execute', minutes: 52, createdAt: stamp(anchorDate, '18'), source: 'manual', countInStatistics: true }]
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
    plannedAssignmentIds, executedAssignmentIds: completedAssignmentIds, completedAssignmentIds, unfinishedAssignmentIds, durationSuggestionGroupIds: [],
  }]
  for (const item of state.assignments.filter(task => task.scheduledDate === anchorDate && task.status !== 'done' && !task.locked)) {
    item.previousDate = anchorDate
    item.scheduledDate = shiftDate(anchorDate, 1)
    item.scheduleSource = 'carryover'
    item.intentStrength = 'manual'
  }
  return updateGoalAndGroupLifecycle(state)
}

export function buildTutorialFutureFrom(source: AppState, anchorDate: string): AppState {
  const state = structuredClone(source) as AppState
  const english = state.assignments.find(item => item.id === 'tutorial-task-english-future')
  const reading = state.assignments.find(item => item.id === 'tutorial-added-reading-1')
  const movedAt = stamp(anchorDate, '21')
  if (english && english.status !== 'done' && !english.locked) {
    english.previousDate = english.scheduledDate
    english.scheduledDate = shiftDate(anchorDate, 5)
    english.scheduleSource = 'replan'
    english.updatedAt = movedAt
  }
  if (reading && reading.status !== 'done' && !reading.locked) {
    reading.previousDate = reading.scheduledDate
    reading.scheduledDate = shiftDate(anchorDate, 3)
    reading.scheduleSource = 'replan'
    reading.updatedAt = movedAt
  }
  state.updatedAt = movedAt
  return updateGoalAndGroupLifecycle(state)
}

export function buildTutorialState(anchorDate = todayISO()): AppState {
  return baseTutorialState(anchorDate)
}

export function buildTutorialCheckpoint(step: TutorialStep, anchorDate: string): AppState {
  if (['repair-entry', 'repair-action', 'repair-preview'].includes(step)) return baseTutorialState(anchorDate)
  if (['goal', 'intake', 'intake-preview'].includes(step)) {
    const state = buildRepairedCheckpoint(anchorDate)
    return step === 'goal' ? state : ensureTutorialIntakeBatch(state, anchorDate)
  }
  if (step === 'execute') return buildScheduledCheckpoint(anchorDate)
  if (['review-entry', 'review-carry', 'review-preview'].includes(step)) return buildExecutedCheckpoint(anchorDate)
  if (['future-entry', 'future-action', 'future-preview'].includes(step)) return buildReviewedCheckpoint(anchorDate)
  if (['complete', 'free'].includes(step)) return buildTutorialFutureFrom(buildReviewedCheckpoint(anchorDate), anchorDate)
  return baseTutorialState(anchorDate)
}

export function tutorialIssueCount(state: AppState, anchorDate: string) {
  const hard = analyzePlan(state, anchorDate).filter(issue => issue.level === 'danger').length
  const overdue = state.assignments.filter(item => item.status !== 'done' && item.scheduledDate && item.scheduledDate < anchorDate).length
  return hard + overdue
}

/**
 * Keep the tutorial event scope aligned with the deterministic before/after target.
 *
 * The generic direct-preview validator intentionally freezes past dates unless the
 * event explicitly names the unfinished assignment being carried out of history.
 * Tutorial repair uses a canonical target rather than the generic search result,
 * so deriving this scope prevents an otherwise-valid overdue repair from being
 * mistaken for an unauthorized historical rewrite. It also makes proposal counts
 * and affected-date explanations match what the tutorial actually changes.
 */
export function tutorialEventForTarget(baseline: AppState, target: AppState, event: PlanChangeEvent): PlanChangeEvent {
  const beforeAssignments = new Map(baseline.assignments.map(item => [item.id, item]))
  const affectedAssignmentIds = new Set(event.affectedAssignmentIds)
  const affectedGroupIds = new Set(event.affectedGroupIds)
  const affectedDates = new Set(event.affectedDates)

  for (const item of target.assignments) {
    const before = beforeAssignments.get(item.id)
    const changed = !before
      || before.scheduledDate !== item.scheduledDate
      || before.status !== item.status
      || before.progress !== item.progress
      || before.actualMinutes !== item.actualMinutes
    if (!changed) continue
    affectedAssignmentIds.add(item.id)
    affectedGroupIds.add(item.groupId)
    if (before?.scheduledDate) affectedDates.add(before.scheduledDate)
    if (item.scheduledDate) affectedDates.add(item.scheduledDate)
  }

  const affectedGoalIds = new Set(event.affectedGoalIds)
  for (const goal of target.goals) {
    if (goal.linkedAssignmentIds.some(id => affectedAssignmentIds.has(id))
      || goal.linkedTaskGroupIds.some(id => affectedGroupIds.has(id))
      || goal.completionConditions.some(condition => affectedGroupIds.has(condition.groupId))) {
      affectedGoalIds.add(goal.id)
    }
  }

  return {
    ...event,
    affectedAssignmentIds: [...affectedAssignmentIds],
    affectedGroupIds: [...affectedGroupIds],
    affectedGoalIds: [...affectedGoalIds],
    affectedDates: [...affectedDates].sort(),
  }
}

function hasAppliedTutorialIntake(state: AppState) {
  const batch = state.intakeBatches.find(item => item.id === 'tutorial-intake-batch')
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
  // Health checks validate durable tutorial invariants at checkpoints. They must not
  // turn harmless algorithm/UI variation into a surprise backwards jump.
  if (state.templateKind !== 'tutorial') return { ok: false as const, reason: '当前不是教程数据空间' }
  if (todayISO() !== session.anchorDate) return { ok: false as const, reason: '教程时钟没有保持在进入时的日期' }

  const requiredIds = [TUTORIAL_GOAL_ID, TUTORIAL_EXECUTE_ASSIGNMENT_ID, 'tutorial-task-locked', 'tutorial-task-done', 'tutorial-task-overdue', 'tutorial-task-goal-risk', 'tutorial-task-review-leftover']
  const ids = new Set([...state.goals.map(item => item.id), ...state.assignments.map(item => item.id)])
  const missing = requiredIds.filter(id => !ids.has(id))
  if (missing.length) return { ok: false as const, reason: `教程关键数据缺失：${missing.join(', ')}` }

  const anchor = session.anchorDate
  const locked = state.assignments.find(item => item.id === 'tutorial-task-locked')
  const historical = state.assignments.find(item => item.id === 'tutorial-task-done')
  const overdue = state.assignments.find(item => item.id === 'tutorial-task-overdue')
  const leftover = state.assignments.find(item => item.id === 'tutorial-task-review-leftover')

  // These two records demonstrate that repair/replan respects completed and locked work.
  if (!locked?.locked || locked.status !== 'done' || locked.scheduledDate !== anchor) return { ok: false as const, reason: '教程锁定完成任务状态异常' }
  if (historical?.status !== 'done' || historical.scheduledDate !== shiftDate(anchor, -2)) return { ok: false as const, reason: '教程历史完成记录异常' }

  const initial = ['repair-entry', 'repair-action', 'repair-preview'].includes(session.step)
  if (initial) {
    // Do not pin the tutorial to an exact analyzer issue count. The fixture still
    // carries the three teaching scenarios, while the analyzer may legitimately
    // merge/split issue cards as scheduling rules evolve.
    if (overdue?.scheduledDate !== shiftDate(anchor, -1)) return { ok: false as const, reason: '教程逾期问题被意外改变' }
    const risk = state.assignments.find(item => item.id === 'tutorial-task-goal-risk')
    if (!risk?.scheduledDate || risk.scheduledDate <= shiftDate(anchor, 5)) return { ok: false as const, reason: '教程目标风险被意外改变' }
    if (leftover?.scheduledDate !== anchor) return { ok: false as const, reason: '教程复盘预留任务被意外改变' }
  } else {
    // After applying repair we only require the teaching problems to be resolved,
    // not specific target dates chosen by one exact engine revision.
    if (!overdue?.scheduledDate || overdue.scheduledDate < anchor) return { ok: false as const, reason: '教程修复后的逾期任务仍在过去' }
    if (analyzePlan(state, anchor).some(issue => issue.level === 'danger')) return { ok: false as const, reason: '教程修复 checkpoint 仍有硬冲突' }
    if (leftover?.scheduledDate !== anchor && ['goal', 'intake', 'intake-preview', 'execute', 'review-entry', 'review-carry', 'review-preview'].includes(session.step)) {
      return { ok: false as const, reason: '教程复盘预留任务提前被移动' }
    }
  }

  if (['intake', 'intake-preview'].includes(session.step) && !state.intakeBatches.some(batch => batch.id === 'tutorial-intake-batch')) {
    return { ok: false as const, reason: '教程录入批次缺失' }
  }

  if (['execute', 'review-entry', 'review-carry', 'review-preview', 'future-entry', 'future-action', 'future-preview', 'complete', 'free'].includes(session.step)) {
    if (!hasAppliedTutorialIntake(state)) return { ok: false as const, reason: '教程新增任务 checkpoint 缺失或未应用' }
  }

  if (['review-entry', 'review-carry', 'review-preview', 'future-entry', 'future-action', 'future-preview', 'complete', 'free'].includes(session.step)) {
    const executed = state.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)
    if (executed?.status !== 'done' || executed.actualMinutes < 1 || executed.actualMinutes > 65 || executed.timeEntries.length === 0) {
      return { ok: false as const, reason: '教程执行 checkpoint 异常' }
    }
  }

  if (['review-entry', 'review-carry', 'review-preview'].includes(session.step) && !hasReviewCarryCandidate(state, anchor)) {
    return { ok: false as const, reason: '教程复盘没有可顺延的未完成任务' }
  }

  if (['future-entry', 'future-action', 'future-preview', 'complete', 'free'].includes(session.step)) {
    if (!state.reviewRecords.some(item => item.date === anchor)) return { ok: false as const, reason: '教程复盘 checkpoint 缺失' }
    if (state.assignments.some(item => item.scheduledDate === anchor && item.status !== 'done' && !item.locked)) {
      return { ok: false as const, reason: '教程复盘后的未完成任务仍留在当天' }
    }
    if (analyzePlan(state, anchor).some(issue => issue.level === 'danger')) return { ok: false as const, reason: '教程复盘后出现新的硬冲突' }
  }

  return { ok: true as const }
}


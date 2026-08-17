import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AppSettings, AppState, Assignment, CalendarConstraint, CreateResult, DayConfig, DurationSuggestion, Goal, GoalDraft,
  IntakeBatch, IntakeBatchSource, IntakeTaskGroupDraft, NewTaskDraft, PlanChangeEvent, PlanVersion, ReplanHistoryEntry,
  ReviewRecord, SchedulingProposal, SequenceRenumberSuggestion, TaskGroup, TaskGroupDraft, ConstraintException,
} from './types'
import {
  buildBlankState, buildGuestDemoState, buildInitialState, createAssignmentsForGroup, normalizeState,
} from './lib/seed'
import { clearLocalState, loadLocalState, saveLocalState } from './lib/db'
import { allDurationSuggestions, generateSchedulingProposals, reviewDaySnapshot } from './lib/planner'
import { uid } from './lib/id'
import { findSequenceRenumberGroups, renumberTaskGroupsByDate } from './lib/sequence'
import { goalProgress, updateGoalAndGroupLifecycle } from './lib/goals'
import { cloneActiveState, hydratePortableState } from './lib/state'
import { createPlanVersion, createVersionFromProposal, previewVersionDiff, restoreSnapshotState, restoreVersionState, type VersionDiffSummary } from './lib/versions'
import { dateRange, getCapacity, timestampForDate, todayISO } from './lib/date'
import { appendIntakeDraft, createIntakeBatchRecord } from './lib/intake-batches'
import { splitSessionCount } from './lib/intake'
import { TUTORIAL_NAMESPACE, readTutorialSession, tutorialAllowsCommit } from './lib/tutorial'
import { dependencyCycleLabels } from './lib/dependencies'
import { addInferredCompletionEntry, appendStatusEvent, isInferredTimeEntry, timeEntryDate } from './lib/execution'

type Recipe = (draft: AppState) => void

type PrepareStateResult = { state: AppState; event: PlanChangeEvent }

interface AppContextValue {
  state: AppState
  namespace: string
  ready: boolean
  loadedFromStorage: boolean
  canUndo: boolean
  commit: (recipe: Recipe, options?: { history?: boolean; markGuestModified?: boolean; tutorialAction?: string; tutorialTargetId?: string }) => void
  replaceState: (state: AppState, history?: boolean) => void
  loadDataSpace: (namespace: string, fallback?: AppState) => Promise<AppState>
  setDataSpace: (namespace: string, state: AppState, history?: boolean) => Promise<void>
  clearDataSpace: (namespace: string) => Promise<void>
  undo: () => void
  updateSettings: (patch: Partial<AppSettings>) => void
  updateDayConfig: (date: string, patch: Partial<DayConfig>) => void
  updateAssignment: (id: string, patch: Partial<Assignment>) => void
  moveAssignments: (ids: string[], date: string, source?: 'manual' | 'carryover') => void
  finishAssignment: (id: string, actualMinutes?: number, source?: 'timer' | 'manual' | 'finish') => void
  reopenAssignment: (id: string) => void
  addTime: (id: string, minutes: number, source?: 'timer' | 'manual' | 'finish') => void
  updateTimeEntry: (assignmentId: string, entryId: string, patch: { minutes?: number; date?: string }) => void
  deleteTimeEntry: (assignmentId: string, entryId: string) => void
  captureDailyPlanBaseline: (date: string) => void
  addTaskGroup: (group: TaskGroup) => void
  editTaskGroup: (group: TaskGroup) => void
  deleteTaskGroup: (id: string) => void
  removeAssignment: (id: string) => void
  prepareTaskGroupDelete: (id: string) => PrepareStateResult
  prepareAssignmentDelete: (id: string) => PrepareStateResult
  prepareAssignmentGroupChange: (id: string, groupId: string, options: { adoptDefaultDuration: boolean; numberingChoice: 'preserve' | 'number-all' }) => PrepareStateResult
  prepareSingleAssignment: (draft: NewTaskDraft) => CreateResult
  prepareTaskGroup: (draft: TaskGroupDraft) => CreateResult
  createIntakeBatch: (name?: string) => string
  duplicateIntakeBatch: (batchId: string) => string
  updateIntakeBatch: (id: string, patch: Partial<Pick<IntakeBatch, 'name' | 'status' | 'lastEditedItemId' | 'formDraft'>>) => void
  addIntakeSingleTask: (batchId: string, draft: NewTaskDraft) => string
  addIntakeTaskGroup: (batchId: string, draft: TaskGroupDraft, source?: Exclude<IntakeBatchSource, 'mixed'>) => string
  updateIntakeSingleTask: (batchId: string, itemId: string, draft: NewTaskDraft) => void
  updateIntakeTaskGroup: (batchId: string, itemId: string, draft: TaskGroupDraft) => void
  removeIntakeTaskGroup: (batchId: string, itemId: string) => void
  deleteIntakeBatch: (batchId: string) => void
  prepareIntakeBatch: (batchId: string, itemIds?: string[]) => CreateResult
  prepareTaskGroupEdit: (group: TaskGroup, numberingChoice?: 'preserve' | 'number-all') => PrepareStateResult
  prepareGoalChange: (draft: GoalDraft, goalId?: string) => PrepareStateResult
  prepareGoalDelete: (goalId: string) => PrepareStateResult
  updateGoalMetadata: (goalId: string, patch: { title?: string; description?: string }) => void
  prepareCalendarConstraintChange: (constraint?: CalendarConstraint, removeId?: string) => PrepareStateResult
  updateCalendarConstraintMetadata: (id: string, reason: string) => void
  prepareDurationChange: (suggestion: DurationSuggestion, estimate?: number, reviewDate?: string) => PrepareStateResult
  prepareReviewCompletion: (date: string, carryDates: Record<string, string>) => PrepareStateResult
  generateProposals: (preparedState: AppState, event: PlanChangeEvent, baseline?: AppState, signal?: AbortSignal, expansionLevel?: number, resolutionOptions?: { acceptedExceptions?: ConstraintException[]; disableAutomaticExceptions?: boolean }) => SchedulingProposal[]
  applySchedulingProposal: (proposal: SchedulingProposal, event: PlanChangeEvent) => void
  applyPreparedWithoutScheduling: (preparedState: AppState, event: PlanChangeEvent, reason?: string) => void
  restoreReplanHistory: (id: string) => void
  recordReview: (date: string) => ReviewRecord
  completeReview: (date: string) => ReviewRecord
  previewPlanVersion: (id: string, side?: 'before' | 'after') => VersionDiffSummary | undefined
  restorePlanVersion: (id: string, side?: 'before' | 'after') => void
  startTimer: (assignmentId: string) => void
  pauseTimer: () => void
  stopTimer: () => number
  resetAll: (kind?: 'demo' | 'blank') => Promise<void>
  sequenceRenumberSuggestion?: SequenceRenumberSuggestion
  dismissSequenceRenumberSuggestion: () => void
  applySequenceRenumber: (groupIds?: string[]) => void
}

const AppContext = createContext<AppContextValue | undefined>(undefined)


function cloneForMutation(state: AppState): AppState {
  const next = structuredClone({ ...state, replanHistory: [], conflictBackups: [], planVersions: [] }) as AppState
  next.replanHistory = state.replanHistory
  next.conflictBackups = state.conflictBackups
  next.planVersions = state.planVersions
  return next
}

function templateState(kind: 'demo' | 'blank') {
  return kind === 'blank' ? buildBlankState() : buildGuestDemoState()
}

function nowISO() { return new Date().toISOString() }

function guidedTutorialMutationBlocked(namespace: string) {
  if (namespace !== TUTORIAL_NAMESPACE) return false
  const session = readTutorialSession()
  return !session || session.step !== 'free'
}

function planEvent(input: Omit<PlanChangeEvent, 'id' | 'createdAt'>): PlanChangeEvent {
  return { id: uid('event'), createdAt: nowISO(), ...input }
}

function reviewRecordFor(state: AppState, date: string): ReviewRecord {
  const snapshot = reviewDaySnapshot(state, date)
  const involvedGroups = new Set(snapshot.assignmentIds.flatMap(id => {
    const assignment = state.assignments.find(item => item.id === id)
    return assignment ? [assignment.groupId] : []
  }))
  const suggestions = allDurationSuggestions(state).filter(item => involvedGroups.has(item.groupId))
  return {
    id: uid('review'), date, createdAt: nowISO(), completedCount: snapshot.completedAssignmentIds.length,
    totalCount: snapshot.plannedAssignmentIds.length, plannedMinutes: snapshot.plannedMinutes,
    actualMinutes: snapshot.actualMinutes, inferredMinutes: snapshot.inferredMinutes,
    plannedAssignmentIds: snapshot.plannedAssignmentIds,
    executedAssignmentIds: snapshot.executedAssignmentIds,
    completedAssignmentIds: snapshot.completedAssignmentIds,
    unfinishedAssignmentIds: snapshot.unfinishedAssignmentIds,
    durationSuggestionGroupIds: suggestions.map(item => item.groupId),
  }
}

function putReviewRecord(state: AppState, date: string) {
  const record = reviewRecordFor(state, date)
  state.reviewRecords = [...state.reviewRecords.filter(item => item.date !== date), record].slice(-120)
  return record
}

function automaticTitle(group: TaskGroup, index: number) {
  return group.quantity > 1 ? `${group.title} ${String(index).padStart(2, '0')}` : group.title
}

function taskGroupFromDraft(draft: TaskGroupDraft, state: AppState, now: string): TaskGroup {
  const recurring = Boolean(draft.recurring)
  const recurrenceStart = recurring ? (draft.recurrenceStart ?? state.settings.startDate) : undefined
  const recurrenceEnd = recurring ? (draft.recurrenceEnd ?? state.settings.endDate) : undefined
  return {
    id: uid('group'), subject: draft.subject, title: draft.title.trim() || '未命名任务组', priority: draft.priority,
    quantity: splitSessionCount(draft), sourceQuantity: Math.max(1, Math.round(draft.quantity)), unitMinutes: Math.max(1, Math.round(draft.unitMinutes)),
    targetDate: state.settings.endDate, dueDate: state.settings.endDate, dailyMax: draft.dailyMax,
    recurring, recurrenceStart, recurrenceEnd,
    recurrenceWeekdays: recurring ? Array.from(new Set(draft.recurrenceWeekdays ?? [])).sort() : undefined,
    countInStats: draft.countInStats, activityType: recurring ? 'recurring' : draft.activityType,
    highIntensity: draft.highIntensity, allowSplit: !recurring && Boolean(draft.allowSplit),
    splitSessionMinutes: !recurring && draft.allowSplit ? draft.splitSessionMinutes : undefined,
    prerequisiteGroupIds: !recurring ? Array.from(new Set(draft.prerequisiteGroupIds ?? [])) : [],
    notes: draft.notes, status: 'active', createdAt: now, updatedAt: now,
  }
}

function taskGroupDraftFromSingleTask(draft: NewTaskDraft): TaskGroupDraft {
  return {
    title: draft.title.trim(),
    subject: draft.subject?.trim() || '其他',
    priority: draft.priority ?? 3,
    unitMinutes: Math.max(1, Math.round(draft.estimatedMinutes)),
    activityType: 'normal',
    highIntensity: false,
    countInStats: true,
    quantity: 1,
    notes: draft.notes,
    goalIds: [],
    recurring: false,
    allowSplit: false,
    prerequisiteGroupIds: [],
  }
}

function taskGroupFromIntakeDraft(draft: IntakeTaskGroupDraft, state: AppState, now: string): TaskGroup {
  const group = taskGroupFromDraft(draft, state, now)
  if (draft.kind !== 'single') return group
  return {
    ...group,
    quantity: 1,
    sourceQuantity: 1,
    dailyMax: undefined,
    recurring: false,
    recurrenceStart: undefined,
    recurrenceEnd: undefined,
    recurrenceWeekdays: undefined,
    hidden: true,
    hiddenStandalone: true,
    activityType: 'normal',
    highIntensity: false,
    allowSplit: false,
    splitSessionMinutes: undefined,
    prerequisiteGroupIds: [],
  }
}

function classifyGoalChange(before: AppState, after: AppState, existing: Goal | undefined, nextGoal: Goal): PlanChangeEvent['type'] {
  if (!existing) return 'goal-tightening'
  let tighter = false
  let looser = false
  if (nextGoal.latestDate < existing.latestDate) tighter = true
  if (nextGoal.latestDate > existing.latestDate) looser = true
  const oldDesired = existing.desiredDate
  const newDesired = nextGoal.desiredDate
  if (newDesired && (!oldDesired || newDesired < oldDesired)) tighter = true
  if (oldDesired && (!newDesired || newDesired > oldDesired)) looser = true
  if (nextGoal.priority > existing.priority) tighter = true
  if (nextGoal.priority < existing.priority) looser = true
  const oldProgress = goalProgress(before, existing)
  const newProgress = goalProgress(after, nextGoal)
  if (newProgress.requiredCount > oldProgress.requiredCount) tighter = true
  if (newProgress.requiredCount < oldProgress.requiredCount) looser = true
  const oldCounted = new Set(oldProgress.countedAssignmentIds)
  const newCounted = new Set(newProgress.countedAssignmentIds)
  if ([...newCounted].some(id => !oldCounted.has(id))) tighter = true
  if ([...oldCounted].some(id => !newCounted.has(id))) looser = true
  if (tighter && looser) return 'rule-change'
  if (tighter) return 'goal-tightening'
  if (looser) return 'goal-relaxation'
  return 'rule-change'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(buildInitialState)
  const [namespace, setNamespace] = useState('guest')
  const [ready, setReady] = useState(false)
  const [loadedFromStorage, setLoadedFromStorage] = useState(false)
  const [sequenceRenumberSuggestion, setSequenceRenumberSuggestion] = useState<SequenceRenumberSuggestion>()
  const history = useRef<AppState[]>([])
  const stateRef = useRef(state)
  const namespaceRef = useRef(namespace)
  const previousScheduleRef = useRef<{ namespace: string; assignments: Map<string, { groupId: string; scheduledDate?: string }> }>()
  stateRef.current = state
  namespaceRef.current = namespace

  useEffect(() => {
    let mounted = true
    loadLocalState('guest').then(saved => {
      if (mounted && saved?.version) {
        setState(normalizeState(saved))
        setLoadedFromStorage(true)
      }
    }).finally(() => mounted && setReady(true))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const currentAssignments = new Map(state.assignments.map(item => [item.id, { groupId: item.groupId, scheduledDate: item.scheduledDate }]))
    const previous = previousScheduleRef.current
    previousScheduleRef.current = { namespace, assignments: currentAssignments }
    if (namespace === TUTORIAL_NAMESPACE) { setSequenceRenumberSuggestion(undefined); return }
    if (!ready || !previous || previous.namespace !== namespace) return
    const changedGroupIds = new Set<string>()
    const changedSources = new Set<'manual' | 'automatic'>()
    for (const assignment of state.assignments) {
      const before = previous.assignments.get(assignment.id)
      if (!before || before.scheduledDate === assignment.scheduledDate) continue
      changedGroupIds.add(assignment.groupId)
      changedSources.add(assignment.scheduleSource === 'replan' ? 'automatic' : 'manual')
    }
    // Deleting one child also changes the chronological sequence of the surviving children.
    // Detect removed assignment ids so the same renumber preview is offered after deletion or
    // a safe quantity reduction, rather than leaving a visible 01/03 gap forever.
    for (const [assignmentId, before] of previous.assignments) {
      if (currentAssignments.has(assignmentId)) continue
      changedGroupIds.add(before.groupId)
      changedSources.add('manual')
    }
    if (!changedGroupIds.size) return
    const groups = findSequenceRenumberGroups(state, changedGroupIds)
    if (!groups.length) return
    const source = changedSources.size > 1 ? 'mixed' : changedSources.has('automatic') ? 'automatic' : 'manual'
    setSequenceRenumberSuggestion({ source, groups })
  }, [state.assignments, namespace, ready])

  useEffect(() => {
    if (!ready) return
    const handle = window.setTimeout(() => { void saveLocalState(namespace, state).catch(() => undefined) }, 180)
    return () => window.clearTimeout(handle)
  }, [state, namespace, ready])

  const replaceState = useCallback((nextInput: AppState, pushHistory = true) => {
    setState(previous => {
      if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
      if (pushHistory) history.current = [...history.current.slice(-29), previous]
      const next = normalizeState(nextInput)
      next.dataRevision = Math.max(previous.dataRevision ?? 1, next.dataRevision ?? 1) + 1
      next.updatedAt = nowISO()
      if (namespaceRef.current === 'guest') next.guestModified = true
      return next
    })
  }, [])

  const commit = useCallback((recipe: Recipe, options?: { history?: boolean; markGuestModified?: boolean; tutorialAction?: string; tutorialTargetId?: string }) => {
    setState(previous => {
      if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession(), options?.tutorialAction, options?.tutorialTargetId)) return previous
      if (options?.history !== false) history.current = [...history.current.slice(-29), previous]
      let next = cloneForMutation(previous)
      recipe(next)
      next.dataRevision = (previous.dataRevision ?? 1) + 1
      next.updatedAt = nowISO()
      if ((options?.markGuestModified ?? true) && namespaceRef.current === 'guest') next.guestModified = true
      next = updateGoalAndGroupLifecycle(next)
      return next
    })
  }, [])

  const loadDataSpace = useCallback(async (nextNamespace: string, fallback?: AppState) => {
    const saved = await loadLocalState(nextNamespace)
    const next = normalizeState(saved ?? fallback ?? (nextNamespace === 'guest' ? buildGuestDemoState() : buildBlankState()))
    history.current = []
    setNamespace(nextNamespace)
    setLoadedFromStorage(Boolean(saved))
    setState(next)
    return next
  }, [])

  const setDataSpace = useCallback(async (nextNamespace: string, nextInput: AppState, pushHistory = false) => {
    const next = normalizeState(nextInput)
    if (pushHistory) history.current = [...history.current.slice(-29), stateRef.current]
    else history.current = []
    setNamespace(nextNamespace)
    setLoadedFromStorage(true)
    setState(next)
    await saveLocalState(nextNamespace, next)
  }, [])

  const clearDataSpace = useCallback(async (targetNamespace: string) => clearLocalState(targetNamespace), [])

  const undo = useCallback(() => {
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return
    const previous = history.current.pop()
    if (previous) setState(previous)
  }, [])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => commit(draft => {
    draft.settings = {
      ...draft.settings,
      ...patch,
      duration: { ...draft.settings.duration, ...(patch.duration ?? {}) },
      customSubjects: patch.customSubjects ?? draft.settings.customSubjects,
    }
  }), [commit])

  const updateDayConfig = useCallback((date: string, patch: Partial<DayConfig>) => commit(draft => {
    draft.dayConfigs[date] = { ...(draft.dayConfigs[date] ?? { date, type: 'regular' }), ...patch, date, userSet: patch.userSet ?? true }
  }), [commit])

  const updateAssignment = useCallback((id: string, patch: Partial<Assignment>) => commit(draft => {
    const item = draft.assignments.find(candidate => candidate.id === id)
    if (!item) return
    const previousStatus = item.status
    const previousProgress = item.progress
    const oldDate = item.scheduledDate
    const moving = Object.prototype.hasOwnProperty.call(patch, 'scheduledDate') && patch.scheduledDate !== oldDate
    Object.assign(item, patch)
    item.updatedAt = nowISO()
    if (item.status !== previousStatus || item.progress !== previousProgress) {
      const date = item.status === 'done' ? todayISO() : todayISO()
      appendStatusEvent(item, item.status, item.progress, date, item.status === 'done' ? 'completion' : item.status === 'partial' ? 'partial' : 'reopen', item.updatedAt)
      if (item.status === 'done' && item.actualMinutes <= 0) addInferredCompletionEntry(item, date, item.updatedAt)
    }
    if (moving) {
      item.previousDate = oldDate
      item.lastManualMoveAt = nowISO()
      item.scheduleSource = 'manual'
      item.intentStrength = item.locked ? 'locked' : 'manual'
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) item.titleCustomized = true
    if (Object.prototype.hasOwnProperty.call(patch, 'estimatedMinutes')) {
      item.manuallyEstimated = true
      item.durationCustomized = true
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'locked')) item.intentStrength = item.locked ? 'locked' : item.scheduleSource === 'manual' ? 'manual' : 'normal'
  }), [commit])

  const moveAssignments = useCallback((ids: string[], date: string, source: 'manual' | 'carryover' = 'manual') => commit(draft => {
    const now = nowISO()
    for (const item of draft.assignments) {
      if (!ids.includes(item.id) || item.locked || item.scheduledDate === date || draft.timer.assignmentId === item.id) continue
      item.previousDate = item.scheduledDate
      item.scheduledDate = date
      item.lastManualMoveAt = now
      item.scheduleSource = source
      item.intentStrength = 'manual'
      item.updatedAt = now
    }
  }), [commit])

  const addTime = useCallback((id: string, minutes: number, source: 'timer' | 'manual' | 'finish' = 'manual') => commit(draft => {
    const item = draft.assignments.find(candidate => candidate.id === id)
    if (!item || minutes <= 0) return
    item.actualMinutes += minutes
    const date = todayISO()
    item.timeEntries.push({ id: uid('time'), minutes, date, createdAt: nowISO(), source })
    item.updatedAt = nowISO()
  }), [commit])

  const updateTimeEntry = useCallback((assignmentId: string, entryId: string, patch: { minutes?: number; date?: string }) => commit(draft => {
    const assignment = draft.assignments.find(item => item.id === assignmentId)
    const entry = assignment?.timeEntries.find(item => item.id === entryId)
    if (!assignment || !entry) return
    const previousMinutes = Math.max(0, Number(entry.minutes) || 0)
    const previousDate = timeEntryDate(entry) ?? todayISO()
    const wasInferred = isInferredTimeEntry(entry)
    if (patch.minutes !== undefined) {
      const nextMinutes = Math.max(0, Math.round(patch.minutes))
      entry.minutes = nextMinutes
      assignment.actualMinutes = Math.max(0, assignment.actualMinutes + nextMinutes - (wasInferred ? 0 : previousMinutes))
      if (wasInferred) {
        entry.source = 'manual'
        entry.countInStatistics = true
      }
    }
    if (patch.date) {
      entry.originalCreatedAt = entry.originalCreatedAt ?? entry.createdAt
      entry.date = patch.date
    }
    const changedAt = nowISO()
    entry.updatedAt = changedAt
    assignment.updatedAt = changedAt
    const nextDate = timeEntryDate(entry) ?? previousDate
    const auditEvent: PlanChangeEvent = {
      id: uid('event'), type: 'time-entry-change', action: 'repair', title: `修改“${assignment.title}”的时间记录`,
      description: `时间流水由 ${previousDate} 的 ${previousMinutes} 分钟修改为 ${nextDate} 的 ${entry.minutes} 分钟。`,
      affectedGoalIds: [], affectedGroupIds: [assignment.groupId], affectedAssignmentIds: [assignment.id],
      affectedDates: Array.from(new Set([previousDate, nextDate])), createdAt: changedAt,
      metadata: { operation: 'edit', entryId, previousMinutes, nextMinutes: entry.minutes, previousDate, nextDate },
    }
    draft.changeEvents = [...draft.changeEvents, auditEvent].slice(-100)
  }), [commit])

  const deleteTimeEntry = useCallback((assignmentId: string, entryId: string) => commit(draft => {
    const assignment = draft.assignments.find(item => item.id === assignmentId)
    const entry = assignment?.timeEntries.find(item => item.id === entryId)
    if (!assignment || !entry) return
    const deletedAt = nowISO()
    const entryDate = timeEntryDate(entry) ?? todayISO()
    assignment.timeEntries = assignment.timeEntries.filter(item => item.id !== entryId)
    if (!isInferredTimeEntry(entry)) assignment.actualMinutes = Math.max(0, assignment.actualMinutes - Math.max(0, Number(entry.minutes) || 0))
    assignment.updatedAt = deletedAt
    const auditEvent: PlanChangeEvent = {
      id: uid('event'), type: 'time-entry-change', action: 'repair', title: `删除“${assignment.title}”的时间记录`,
      description: `删除 ${entryDate} 的 ${entry.minutes} 分钟时间流水；任务累计实际同步扣减。`,
      affectedGoalIds: [], affectedGroupIds: [assignment.groupId], affectedAssignmentIds: [assignment.id],
      affectedDates: [entryDate], createdAt: deletedAt,
      metadata: { operation: 'delete', entryId, deletedEntry: { ...entry } },
    }
    draft.changeEvents = [...draft.changeEvents, auditEvent].slice(-100)
  }), [commit])

  const captureDailyPlanBaseline = useCallback((date: string) => commit(draft => {
    if (draft.dailyPlanBaselines.some(item => item.date === date)) return
    const assignments = draft.assignments
      .filter(item => item.scheduledDate === date)
      .map(item => ({ assignmentId: item.id, groupId: item.groupId, title: item.title, estimatedMinutes: item.estimatedMinutes, statusAtCapture: item.status, progressAtCapture: item.progress }))
    draft.dailyPlanBaselines = [...draft.dailyPlanBaselines, { id: uid('baseline'), date, capturedAt: nowISO(), assignments }].slice(-400)
  }, { history: false, markGuestModified: false }), [commit])

  const finishAssignment = useCallback((id: string, actualMinutes?: number, source: 'timer' | 'manual' | 'finish' = 'finish') => commit(draft => {
    const item = draft.assignments.find(candidate => candidate.id === id)
    if (!item) return
    const date = todayISO()
    const changedAt = nowISO()
    if (actualMinutes && actualMinutes > 0) {
      item.actualMinutes += actualMinutes
      item.timeEntries.push({ id: uid('time'), minutes: actualMinutes, date, createdAt: changedAt, source })
    } else if (item.actualMinutes <= 0) addInferredCompletionEntry(item, date, changedAt)
    item.progress = 100
    item.remainingMinutes = 0
    item.status = 'done'
    item.completedAt = timestampForDate(date)
    item.updatedAt = changedAt
    appendStatusEvent(item, 'done', 100, date, 'completion', changedAt)
    if (draft.timer.assignmentId === id) draft.timer = { accumulatedSeconds: 0, running: false }
  }), [commit])

  const reopenAssignment = useCallback((id: string) => commit(draft => {
    const item = draft.assignments.find(candidate => candidate.id === id)
    if (!item || item.status !== 'done') return
    item.status = item.progress > 0 && item.progress < 100 ? 'partial' : 'todo'
    item.progress = Math.min(99, item.progress === 100 ? 0 : item.progress)
    item.completedAt = undefined
    item.remainingMinutes = Math.max(1, item.estimatedMinutes - item.actualMinutes)
    item.updatedAt = nowISO()
    appendStatusEvent(item, item.status, item.progress, todayISO(), 'reopen', item.updatedAt)
  }), [commit])

  /** 旧调用兼容；新版界面改用 prepareTaskGroup + 方案预览。 */
  const addTaskGroup = useCallback((group: TaskGroup) => commit(draft => {
    draft.taskGroups.push(group)
    draft.assignments.push(...createAssignmentsForGroup(group))
  }), [commit])

  const editTaskGroup = useCallback((group: TaskGroup) => commit(draft => {
    const index = draft.taskGroups.findIndex(item => item.id === group.id)
    if (index < 0) return
    const old = draft.taskGroups[index]
    const existing = draft.assignments.filter(item => item.groupId === group.id).sort((a, b) => a.index - b.index)
    draft.taskGroups[index] = { ...group, updatedAt: nowISO() }
    for (const assignment of existing) {
      if (!assignment.durationCustomized && !assignment.manuallyEstimated && assignment.status === 'todo') assignment.estimatedMinutes = group.unitMinutes
      if (!assignment.titleCustomized) assignment.title = group.quantity > 1 ? `${group.title} ${String(assignment.index).padStart(2, '0')}` : group.title
      assignment.updatedAt = nowISO()
    }
    if (!old.recurring && !group.recurring && group.quantity > existing.length) {
      const generated = createAssignmentsForGroup({ ...group, quantity: group.quantity }).slice(existing.length)
      draft.assignments.push(...generated)
    }
    if (!old.recurring && !group.recurring && group.quantity < existing.length) {
      const candidates = existing.slice(group.quantity)
      const removable = candidates.filter(item => item.status === 'todo' && item.actualMinutes === 0 && !item.locked && draft.timer.assignmentId !== item.id)
      const ids = new Set(removable.map(item => item.id))
      draft.assignments = draft.assignments.filter(item => !ids.has(item.id))
      group.quantity = draft.assignments.filter(item => item.groupId === group.id).length
    }
  }), [commit])

  const prepareTaskGroupDelete = useCallback((id: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const group = next.taskGroups.find(item => item.id === id)
    if (!group) throw new Error('任务组不存在，无法生成删除预览。')
    const affected = next.assignments.filter(item => item.groupId === id)
    const affectedGoalIds = next.goals
      .filter(goal => goal.linkedTaskGroupIds.includes(id) || goal.completionConditions.some(condition => condition.groupId === id))
      .map(goal => goal.id)
    next.taskGroups = next.taskGroups.filter(item => item.id !== id)
    next.assignments = next.assignments.filter(item => item.groupId !== id)
    next.goals = next.goals.map(goal => ({
      ...goal,
      linkedTaskGroupIds: goal.linkedTaskGroupIds.filter(groupId => groupId !== id),
      completionConditions: goal.completionConditions.filter(condition => condition.groupId !== id),
      linkedAssignmentIds: goal.linkedAssignmentIds.filter(assignmentId => !affected.some(item => item.id === assignmentId)),
      updatedAt: nowISO(),
    }))
    const event = planEvent({
      type: 'group-deletion', action: 'repair', title: `删除任务组：${group.title}`,
      description: `第一方案只删除该任务组及其 ${affected.length} 项任务，并同步移除相关目标引用；不会移动其他任务，也不会顺便修复计划原有问题。`,
      affectedGoalIds, affectedGroupIds: [id], affectedAssignmentIds: affected.map(item => item.id),
      affectedDates: [...new Set(affected.map(item => item.scheduledDate).filter((date): date is string => Boolean(date)))],
      metadata: {
        explicitLocalOperation: true,
        operationScope: 'requested-change-only',
        requestedChangeLabel: `仅删除任务组“${group.title}”`,
        requestedChangeKind: 'group-deletion',
      },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = nowISO()
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const deleteTaskGroup = useCallback((id: string) => setState(previous => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
    const group = previous.taskGroups.find(item => item.id === id)
    if (!group) return previous
    history.current = [...history.current.slice(-29), previous]
    const next = cloneForMutation(previous)
    const affected = next.assignments.filter(item => item.groupId === id)
    const event = planEvent({ type: 'group-deletion', action: 'repair', title: `删除任务组：${group.title}`, description: `删除 ${affected.length} 项任务并更新关联目标。`, affectedGoalIds: next.goals.filter(goal => goal.linkedTaskGroupIds.includes(id) || goal.completionConditions.some(condition => condition.groupId === id)).map(goal => goal.id), affectedGroupIds: [id], affectedAssignmentIds: affected.map(item => item.id), affectedDates: affected.map(item => item.scheduledDate).filter((date): date is string => Boolean(date)) })
    next.taskGroups = next.taskGroups.filter(item => item.id !== id)
    next.assignments = next.assignments.filter(item => item.groupId !== id)
    next.goals = next.goals.map(goal => ({ ...goal, linkedTaskGroupIds: goal.linkedTaskGroupIds.filter(groupId => groupId !== id), completionConditions: goal.completionConditions.filter(condition => condition.groupId !== id) }))
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.planVersions = [...previous.planVersions, createPlanVersion(previous, next, event, event.title)].slice(-10)
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])

  const prepareAssignmentDelete = useCallback((id: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const target = next.assignments.find(item => item.id === id)
    if (!target) throw new Error('任务不存在，无法生成删除预览。')
    const affectedGoalIds = next.goals
      .filter(goal => goal.linkedAssignmentIds.includes(id) || goal.linkedTaskGroupIds.includes(target.groupId) || goal.completionConditions.some(condition => condition.groupId === target.groupId))
      .map(goal => goal.id)
    next.assignments = next.assignments.filter(item => item.id !== id)
    next.goals = next.goals.map(goal => ({ ...goal, linkedAssignmentIds: goal.linkedAssignmentIds.filter(assignmentId => assignmentId !== id), updatedAt: nowISO() }))
    const group = next.taskGroups.find(item => item.id === target.groupId)
    if (group) {
      group.quantity = next.assignments.filter(item => item.groupId === group.id).length
      group.updatedAt = nowISO()
    }
    if (group?.hiddenStandalone && !next.assignments.some(item => item.groupId === group.id) && !next.goals.some(goal => goal.linkedTaskGroupIds.includes(group.id) || goal.completionConditions.some(condition => condition.groupId === group.id))) {
      next.taskGroups = next.taskGroups.filter(item => item.id !== group.id)
    }
    const event = planEvent({
      type: 'assignment-deletion', action: 'repair', title: `移除任务：${target.title}`,
      description: '第一方案只移除这一个任务并更新直接关联的数据；其他任务日期保持不变，计划原有冲突不会被自动扩大为重排。',
      affectedGoalIds, affectedGroupIds: [target.groupId], affectedAssignmentIds: [id],
      affectedDates: target.scheduledDate ? [target.scheduledDate] : [],
      metadata: {
        explicitLocalOperation: true,
        operationScope: 'requested-change-only',
        requestedChangeLabel: `仅移除“${target.title}”`,
        requestedChangeKind: 'assignment-deletion',
        taskHadExecutionRecord: target.actualMinutes > 0 || target.progress > 0 || target.timeEntries.length > 0,
      },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = nowISO()
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const removeAssignment = useCallback((id: string) => setState(previous => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
    const target = previous.assignments.find(item => item.id === id)
    if (!target) return previous
    history.current = [...history.current.slice(-29), previous]
    const next = cloneForMutation(previous)
    const event = planEvent({
      type: 'rule-change', action: 'repair', title: `移除任务：${target.title}`,
      description: target.actualMinutes > 0 || target.progress > 0 ? '此任务已有执行记录；移除前已创建可恢复计划版本。' : '移除任务并重新校准任务组数量。',
      affectedGoalIds: next.goals.filter(goal => goal.linkedAssignmentIds.includes(id) || goal.linkedTaskGroupIds.includes(target.groupId) || goal.completionConditions.some(condition => condition.groupId === target.groupId)).map(goal => goal.id),
      affectedGroupIds: [target.groupId], affectedAssignmentIds: [id], affectedDates: target.scheduledDate ? [target.scheduledDate] : [],
    })
    next.assignments = next.assignments.filter(item => item.id !== id)
    next.goals = next.goals.map(goal => ({ ...goal, linkedAssignmentIds: goal.linkedAssignmentIds.filter(assignmentId => assignmentId !== id) }))
    const group = next.taskGroups.find(item => item.id === target.groupId)
    if (group?.hiddenStandalone && !next.assignments.some(item => item.groupId === group.id) && !next.goals.some(goal => goal.linkedTaskGroupIds.includes(group.id) || goal.completionConditions.some(condition => condition.groupId === group.id))) {
      next.taskGroups = next.taskGroups.filter(item => item.id !== group.id)
    }
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.planVersions = [...previous.planVersions, createPlanVersion(previous, next, event, event.title)].slice(-10)
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])

  const prepareAssignmentGroupChange = useCallback((id: string, groupId: string, options: { adoptDefaultDuration: boolean; numberingChoice: 'preserve' | 'number-all' }): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const assignment = next.assignments.find(item => item.id === id)
    const newGroup = next.taskGroups.find(item => item.id === groupId)
    if (!assignment || !newGroup || assignment.groupId === groupId) throw new Error('任务或目标任务组不存在。')
    if (newGroup.recurring) throw new Error('每日重复任务组不接收临时单项任务。')
    const oldGroupId = assignment.groupId
    const oldGroup = next.taskGroups.find(item => item.id === oldGroupId)
    const now = nowISO()
    const oldGoalIds = next.goals.filter(goal => goal.linkedAssignmentIds.includes(id) || goal.linkedTaskGroupIds.includes(oldGroupId) || goal.completionConditions.some(condition => condition.groupId === oldGroupId)).map(goal => goal.id)
    const newGoalIds = next.goals.filter(goal => goal.linkedAssignmentIds.includes(id) || goal.linkedTaskGroupIds.includes(groupId) || goal.completionConditions.some(condition => condition.groupId === groupId)).map(goal => goal.id)

    assignment.groupId = groupId
    assignment.standalone = Boolean(newGroup.hiddenStandalone)
    const canAdopt = assignment.status === 'todo' && assignment.progress === 0 && assignment.actualMinutes === 0 && (assignment.timeEntries?.length ?? 0) === 0 && next.timer.assignmentId !== assignment.id
    if (options.adoptDefaultDuration && canAdopt) {
      assignment.estimatedMinutes = newGroup.unitMinutes
      assignment.durationCustomized = false
      assignment.manuallyEstimated = false
    } else if (assignment.estimatedMinutes !== newGroup.unitMinutes) {
      assignment.durationCustomized = true
      assignment.manuallyEstimated = true
    }
    assignment.updatedAt = now

    const normalizeGroupSequence = (targetId: string, preserveFirstName = false) => {
      const group = next.taskGroups.find(item => item.id === targetId)
      if (!group) return
      const items = next.assignments.filter(item => item.groupId === targetId).sort((a, b) => a.index - b.index || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      items.forEach((item, index) => {
        item.index = index + 1
        if (preserveFirstName && index === 0) {
          item.titleCustomized = true
        } else if (!item.titleCustomized) {
          item.title = items.length > 1 ? `${group.title} ${String(index + 1).padStart(2, '0')}` : group.title
        }
        item.updatedAt = now
      })
      group.quantity = items.length
      group.updatedAt = now
    }

    normalizeGroupSequence(oldGroupId)
    const targetBeforeCount = before.assignments.filter(item => item.groupId === groupId && item.id !== id).length
    normalizeGroupSequence(groupId, targetBeforeCount === 1 && options.numberingChoice === 'preserve')

    if (oldGroup?.hiddenStandalone && !next.assignments.some(item => item.groupId === oldGroupId)
      && !next.goals.some(goal => goal.linkedTaskGroupIds.includes(oldGroupId) || goal.completionConditions.some(condition => condition.groupId === oldGroupId))) {
      next.taskGroups = next.taskGroups.filter(item => item.id !== oldGroupId)
    }

    const event = planEvent({
      type: 'rule-change', action: 'repair', title: `更换任务组：${assignment.title}`,
      description: `任务将从“${oldGroup?.title ?? oldGroupId}”转入“${newGroup.title}”。进度、实际用时、计时记录和备注保持不变；当前日期会按新组规则与目标重新校验。`,
      affectedGoalIds: Array.from(new Set([...oldGoalIds, ...newGoalIds])), affectedGroupIds: [oldGroupId, groupId], affectedAssignmentIds: [id],
      affectedDates: assignment.scheduledDate ? [assignment.scheduledDate] : [],
      metadata: { oldGroupId, newGroupId: groupId, adoptDefaultDuration: options.adoptDefaultDuration && canAdopt, numberingChoice: options.numberingChoice, explicitLocalOperation: true, operationScope: 'requested-change-only', requestedChangeLabel: `仅将“${assignment.title}”移入“${newGroup.title}”` },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const prepareSingleAssignment = useCallback((draft: NewTaskDraft): CreateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    let group = draft.groupId ? next.taskGroups.find(item => item.id === draft.groupId) : undefined
    const createdGroupIds: string[] = []
    if (!group || draft.standalone) {
      group = {
        id: uid('group'), subject: draft.subject?.trim() || '其他', title: draft.title.trim() || '未命名任务', priority: draft.priority ?? 3, quantity: 0,
        unitMinutes: Math.max(1, Math.round(draft.estimatedMinutes)), targetDate: next.settings.endDate, dueDate: next.settings.endDate,
        countInStats: true, hidden: true, hiddenStandalone: true, activityType: 'normal', highIntensity: false,
        status: 'active', createdAt: now, updatedAt: now,
      }
      next.taskGroups.push(group)
      createdGroupIds.push(group.id)
    }
    const existing = next.assignments.filter(item => item.groupId === group!.id).sort((a, b) => a.index - b.index)
    const index = existing.length + 1
    const numberAll = existing.length === 1 && draft.numberingChoice === 'number-all'
    if (numberAll && !existing[0].titleCustomized) {
      existing[0].index = 1
      existing[0].title = `${group.title} 01`
      existing[0].titleCustomized = false
      existing[0].updatedAt = now
    }
    const defaultTitle = existing.length > 0 ? `${group.title} ${String(index).padStart(2, '0')}` : group.title
    const requestedTitle = numberAll ? defaultTitle : (draft.title.trim() || defaultTitle)
    const lockDate = draft.schedulingIntent === 'lock-date'
    const preferDate = draft.schedulingIntent === 'prefer-date' || lockDate
    const assignment: Assignment = {
      id: uid('task'), groupId: group.id, index, title: requestedTitle,
      titleCustomized: requestedTitle !== defaultTitle, scheduledDate: preferDate ? draft.date : undefined,
      estimatedMinutes: Math.max(1, Math.round(draft.estimatedMinutes || group.unitMinutes)),
      durationCustomized: Math.round(draft.estimatedMinutes) !== group.unitMinutes,
      actualMinutes: 0, progress: 0, status: 'todo', locked: lockDate || draft.locked,
      notes: draft.notes, timeEntries: [], scheduleSource: preferDate ? 'manual' : 'system',
      intentStrength: lockDate || draft.locked ? 'locked' : preferDate ? 'manual' : 'normal',
      standalone: Boolean(group.hiddenStandalone), createdAt: now, updatedAt: now, createdBy: 'user',
    }
    next.assignments.push(assignment)
    group.quantity = next.assignments.filter(item => item.groupId === group!.id).length
    group.updatedAt = now
    const inheritedGoalIds = next.goals.filter(goal => goal.linkedTaskGroupIds.includes(group!.id) || goal.completionConditions.some(condition => condition.groupId === group!.id)).map(goal => goal.id)
    const event = planEvent({
      type: 'new-task-insertion', action: 'insert', title: `添加任务：${assignment.title}`,
      description: '先创建任务草稿，再尝试以最小扰动安排；应用方案前不会改写当前计划。',
      affectedGoalIds: inheritedGoalIds, affectedGroupIds: [group.id], affectedAssignmentIds: [assignment.id],
      affectedDates: assignment.scheduledDate ? [assignment.scheduledDate] : [], metadata: { schedulingIntent: draft.schedulingIntent, numberingChoice: draft.numberingChoice },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event, createdAssignmentIds: [assignment.id], createdGroupIds }
  }, [])

  const prepareTaskGroup = useCallback((draft: TaskGroupDraft): CreateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    const group = taskGroupFromDraft(draft, next, now)
    const assignments = createAssignmentsForGroup(group).map(item => ({
      ...item, createdAt: now, updatedAt: now, createdBy: 'user' as const,
      scheduledDate: draft.fixedDate ?? draft.preferredDate ?? item.scheduledDate,
      locked: Boolean(draft.fixedDate) || item.locked,
      intentStrength: draft.fixedDate ? 'locked' as const : draft.preferredDate ? 'manual' as const : item.intentStrength,
      scheduleSource: draft.fixedDate || draft.preferredDate ? 'manual' as const : item.scheduleSource,
    }))
    next.taskGroups.push(group)
    next.assignments.push(...assignments)
    next.goals = next.goals.map(goal => {
      if (!draft.goalIds.includes(goal.id)) return goal
      const hasCondition = goal.completionConditions.some(condition => condition.groupId === group.id)
      return {
        ...goal,
        linkedTaskGroupIds: Array.from(new Set([...goal.linkedTaskGroupIds, group.id])),
        completionConditions: hasCondition ? goal.completionConditions : [...goal.completionConditions, { id: uid('condition'), groupId: group.id, mode: 'all' as const }],
        updatedAt: now,
      }
    })
    const event = planEvent({
      type: 'new-task-insertion', action: 'insert', title: `创建任务组：${group.title}`,
      description: `已生成 ${assignments.length} 项任务草稿；将先尝试零扰动插入，再按需扩大范围。`,
      affectedGoalIds: draft.goalIds, affectedGroupIds: [group.id], affectedAssignmentIds: assignments.map(item => item.id), affectedDates: [],
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event, createdAssignmentIds: assignments.map(item => item.id), createdGroupIds: [group.id] }
  }, [])

  const createIntakeBatch = useCallback((name?: string) => {
    const resumableEmpty = stateRef.current.intakeBatches.find(item => item.status !== 'archived' && item.taskGroups.length === 0)
    if (resumableEmpty) return resumableEmpty.id
    const id = uid('intake')
    const now = nowISO()
    commit(draft => {
      draft.intakeBatches.push(createIntakeBatchRecord(name, now, id))
    }, { history: false })
    return id
  }, [commit])

  const duplicateIntakeBatch = useCallback((batchId: string) => {
    const id = uid('intake')
    const now = nowISO()
    commit(draft => {
      const source = draft.intakeBatches.find(item => item.id === batchId)
      if (!source) return
      const taskGroups = source.taskGroups.map(item => ({
        ...structuredClone(item),
        id: uid('intake-item'),
        createdAt: now,
        updatedAt: now,
        appliedAt: undefined,
        appliedGroupId: undefined,
        appliedAssignmentId: undefined,
      }))
      draft.intakeBatches.push({
        id,
        name: `${source.name}（副本）`,
        status: 'editing',
        source: source.source,
        taskGroups,
        createdAt: now,
        updatedAt: now,
        lastEditedItemId: taskGroups.at(-1)?.id,
      })
    }, { history: false })
    return id
  }, [commit])

  const updateIntakeBatch = useCallback((id: string, patch: Partial<Pick<IntakeBatch, 'name' | 'status' | 'lastEditedItemId' | 'formDraft'>>) => commit(draft => {
    const batch = draft.intakeBatches.find(item => item.id === id)
    if (!batch) return
    if (patch.name !== undefined) batch.name = patch.name.trim() || batch.name
    if (patch.status !== undefined) {
      batch.status = patch.status
      batch.archivedAt = patch.status === 'archived' ? nowISO() : undefined
    }
    if (patch.lastEditedItemId !== undefined) batch.lastEditedItemId = patch.lastEditedItemId
    if ('formDraft' in patch) batch.formDraft = patch.formDraft ? structuredClone(patch.formDraft) : undefined
    batch.updatedAt = nowISO()
  }, { history: false }), [commit])

  const addIntakeTaskGroup = useCallback((batchId: string, draft: TaskGroupDraft, source: Exclude<IntakeBatchSource, 'mixed'> = 'manual') => {
    const id = uid('intake-item')
    const now = nowISO()
    commit(stateDraft => {
      const batch = stateDraft.intakeBatches.find(item => item.id === batchId)
      if (!batch) return
      appendIntakeDraft(batch, draft, source, now, id)
    }, { history: false, tutorialAction: 'intake-import' })
    return id
  }, [commit])

  const addIntakeSingleTask = useCallback((batchId: string, draft: NewTaskDraft) => {
    const id = uid('intake-item')
    const now = nowISO()
    commit(stateDraft => {
      const batch = stateDraft.intakeBatches.find(item => item.id === batchId)
      if (!batch) return
      appendIntakeDraft(batch, taskGroupDraftFromSingleTask(draft), 'manual', now, id, 'single')
    }, { history: false, tutorialAction: 'intake-import' })
    return id
  }, [commit])

  const updateIntakeSingleTask = useCallback((batchId: string, itemId: string, draft: NewTaskDraft) => commit(stateDraft => {
    const batch = stateDraft.intakeBatches.find(item => item.id === batchId)
    const item = batch?.taskGroups.find(candidate => candidate.id === itemId)
    if (!batch || !item || item.appliedAt) return
    const normalized = taskGroupDraftFromSingleTask(draft)
    Object.assign(item, structuredClone(normalized), {
      kind: 'single' as const,
      id: item.id,
      source: item.source,
      createdAt: item.createdAt,
      updatedAt: nowISO(),
    })
    batch.status = 'editing'
    batch.lastEditedItemId = itemId
    batch.updatedAt = nowISO()
  }, { history: false }), [commit])

  const updateIntakeTaskGroup = useCallback((batchId: string, itemId: string, draft: TaskGroupDraft) => commit(stateDraft => {
    const batch = stateDraft.intakeBatches.find(item => item.id === batchId)
    const item = batch?.taskGroups.find(candidate => candidate.id === itemId)
    if (!batch || !item || item.appliedAt) return
    Object.assign(item, structuredClone(draft), {
      kind: 'group' as const,
      id: item.id,
      source: item.source,
      createdAt: item.createdAt,
      updatedAt: nowISO(),
      title: draft.title.trim(),
      quantity: Math.max(1, Math.round(draft.quantity)),
      unitMinutes: Math.max(1, Math.round(draft.unitMinutes)),
      goalIds: Array.from(new Set(draft.goalIds)),
      recurrenceWeekdays: draft.recurrenceWeekdays ? Array.from(new Set(draft.recurrenceWeekdays)).sort() : undefined,
      prerequisiteGroupIds: draft.prerequisiteGroupIds ? Array.from(new Set(draft.prerequisiteGroupIds)) : undefined,
    })
    batch.status = 'editing'
    batch.lastEditedItemId = itemId
    batch.updatedAt = nowISO()
  }, { history: false, tutorialAction: 'tutorial-goal-link', tutorialTargetId: batchId }), [commit])

  const removeIntakeTaskGroup = useCallback((batchId: string, itemId: string) => commit(draft => {
    const batch = draft.intakeBatches.find(item => item.id === batchId)
    if (!batch) return
    batch.taskGroups = batch.taskGroups.filter(item => item.id !== itemId || Boolean(item.appliedAt))
    if (batch.lastEditedItemId === itemId) batch.lastEditedItemId = undefined
    batch.updatedAt = nowISO()
  }, { history: false }), [commit])

  const deleteIntakeBatch = useCallback((batchId: string) => commit(draft => {
    draft.intakeBatches = draft.intakeBatches.filter(item => item.id !== batchId)
  }), [commit])

  const prepareIntakeBatch = useCallback((batchId: string, itemIds?: string[]): CreateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const batch = next.intakeBatches.find(item => item.id === batchId)
    if (!batch) throw new Error('录入批次不存在，无法生成计划。')
    const selectedIds = itemIds?.length ? new Set(itemIds) : undefined
    const selected = batch.taskGroups.filter(item => !item.appliedAt && (!selectedIds || selectedIds.has(item.id)))
    if (!selected.length) throw new Error('这个录入批次中没有可安排的任务。')

    const now = nowISO()
    const createdAssignmentIds: string[] = []
    const createdGroupIds: string[] = []
    const affectedGoalIds = new Set<string>()
    const affectedDates = new Set<string>()
    const preparedGroups = selected.map(item => ({ item, group: taskGroupFromIntakeDraft(item, next, now) }))
    const titleLookup = new Map<string, string>()
    for (const group of [...next.taskGroups, ...preparedGroups.map(entry => entry.group)]) if (!titleLookup.has(group.title.trim().toLowerCase())) titleLookup.set(group.title.trim().toLowerCase(), group.id)
    for (const entry of preparedGroups) {
      const requestedTitles = (entry.item.prerequisiteGroupTitles ?? []).map(title => title.trim()).filter(Boolean)
      const unknownTitles = requestedTitles.filter(title => !titleLookup.has(title.toLowerCase()))
      if (unknownTitles.length) throw new Error(`任务组“${entry.group.title}”引用了不存在的前置任务组：${unknownTitles.join('、')}。请先修正名称或先录入对应任务组。`)
      const namedDependencies = requestedTitles.map(title => titleLookup.get(title.toLowerCase())).filter((id): id is string => Boolean(id))
      entry.group.prerequisiteGroupIds = Array.from(new Set([...(entry.group.prerequisiteGroupIds ?? []), ...namedDependencies])).filter(id => id !== entry.group.id)
    }
    const dependencyCycles = dependencyCycleLabels([...next.taskGroups, ...preparedGroups.map(entry => entry.group)])
    if (dependencyCycles.length) throw new Error(`检测到循环依赖：${dependencyCycles[0]}。请先修改前置任务组。`)
    for (const { item, group } of preparedGroups) {
      const assignments = createAssignmentsForGroup(group).map(assignment => ({
        ...assignment,
        createdAt: now,
        updatedAt: now,
        createdBy: item.source === 'manual' ? 'user' as const : 'import' as const,
        scheduledDate: item.fixedDate ?? item.preferredDate ?? assignment.scheduledDate,
        locked: Boolean(item.fixedDate) || assignment.locked,
        intentStrength: item.fixedDate ? 'locked' as const : item.preferredDate ? 'manual' as const : assignment.intentStrength,
        scheduleSource: group.recurring ? 'recurring' as const : item.fixedDate || item.preferredDate ? 'import' as const : item.source === 'manual' ? 'system' as const : 'import' as const,
      }))
      next.taskGroups.push(group)
      next.assignments.push(...assignments)
      createdGroupIds.push(group.id)
      createdAssignmentIds.push(...assignments.map(assignment => assignment.id))
      assignments.forEach(assignment => { if (assignment.scheduledDate) affectedDates.add(assignment.scheduledDate) })
      item.goalIds.forEach(goalId => affectedGoalIds.add(goalId))
      next.goals = next.goals.map(goal => {
        if (!item.goalIds.includes(goal.id)) return goal
        const hasCondition = goal.completionConditions.some(condition => condition.groupId === group.id)
        return {
          ...goal,
          linkedTaskGroupIds: Array.from(new Set([...goal.linkedTaskGroupIds, group.id])),
          completionConditions: hasCondition ? goal.completionConditions : [...goal.completionConditions, { id: uid('condition'), groupId: group.id, mode: 'all' as const }],
          updatedAt: now,
        }
      })
      const declaredLatest = item.latestDate ?? item.desiredDate
      if (declaredLatest) {
        const desiredDate = item.desiredDate && item.desiredDate <= declaredLatest ? item.desiredDate : undefined
        const goalTitle = item.goalTitle?.trim() || `${item.title}完成目标`
        const existingGoal = next.goals.find(goal => goal.status !== 'archived' && goal.title === goalTitle && goal.latestDate === declaredLatest)
        if (existingGoal) {
          existingGoal.linkedTaskGroupIds = Array.from(new Set([...existingGoal.linkedTaskGroupIds, group.id]))
          if (!existingGoal.completionConditions.some(condition => condition.groupId === group.id)) {
            existingGoal.completionConditions.push({ id: uid('condition'), groupId: group.id, mode: 'all' })
          }
          existingGoal.updatedAt = now
          affectedGoalIds.add(existingGoal.id)
        } else {
          const goalId = uid('goal')
          next.goals.push({
            id: goalId,
            title: goalTitle,
            description: `由录入批次“${batch.name}”创建。`,
            priority: item.priority,
            desiredDate,
            latestDate: declaredLatest,
            status: 'active',
            completionConditions: [{ id: uid('condition'), groupId: group.id, mode: 'all' }],
            linkedTaskGroupIds: [group.id],
            linkedAssignmentIds: [],
            createdAt: now,
            updatedAt: now,
          })
          affectedGoalIds.add(goalId)
        }
        affectedDates.add(declaredLatest)
        if (desiredDate) affectedDates.add(desiredDate)
      }
      item.appliedAt = now
      item.appliedGroupId = group.id
      item.appliedAssignmentId = item.kind === 'single' ? assignments[0]?.id : undefined
      item.updatedAt = now
    }
    batch.status = batch.taskGroups.every(item => Boolean(item.appliedAt)) ? 'applied' : 'editing'
    batch.updatedAt = now
    const event = planEvent({
      type: 'new-task-insertion',
      action: 'insert',
      title: `安排录入批次：${batch.name}`,
      description: `本次统一加入 ${selected.length} 项录入内容，共生成 ${createdAssignmentIds.length} 项任务；确认方案前不会改变正式计划。`,
      affectedGoalIds: [...affectedGoalIds],
      affectedGroupIds: createdGroupIds,
      affectedAssignmentIds: createdAssignmentIds,
      affectedDates: [...affectedDates].sort(),
      metadata: { intakeBatchId: batch.id, intakeItemIds: selected.map(item => item.id), preferredPreferences: ['preserve', 'balanced'] },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event, createdAssignmentIds, createdGroupIds }
  }, [])

  const prepareTaskGroupEdit = useCallback((group: TaskGroup, numberingChoice: 'preserve' | 'number-all' = 'preserve'): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const index = next.taskGroups.findIndex(item => item.id === group.id)
    if (index < 0) throw new Error('任务组不存在，无法生成调整预览。')
    const old = next.taskGroups[index]
    const existing = next.assignments.filter(item => item.groupId === group.id).sort((a, b) => a.index - b.index)
    const now = nowISO()
    const createdIds: string[] = []
    const removedIds: string[] = []
    const protectedIds: string[] = []
    const requestedQuantity = Math.max(1, Math.round(group.quantity))
    const updatedGroup: TaskGroup = { ...group, quantity: requestedQuantity, updatedAt: now }
    next.taskGroups[index] = updatedGroup

    const firstExpansion = !old.recurring && !updatedGroup.recurring && existing.length === 1 && requestedQuantity > 1
    for (const assignment of existing) {
      const canInheritNewDuration = !assignment.durationCustomized
        && !assignment.manuallyEstimated
        && assignment.status === 'todo'
        && assignment.progress === 0
        && assignment.actualMinutes === 0
        && assignment.timeEntries.length === 0
        && next.timer.assignmentId !== assignment.id
      if (canInheritNewDuration) assignment.estimatedMinutes = updatedGroup.unitMinutes
      if (firstExpansion && numberingChoice === 'preserve') {
        assignment.titleCustomized = true
      } else if (!assignment.titleCustomized) {
        assignment.title = requestedQuantity > 1 ? `${updatedGroup.title} ${String(assignment.index).padStart(2, '0')}` : updatedGroup.title
      }
      assignment.updatedAt = now
    }

    if (!old.recurring && !updatedGroup.recurring && requestedQuantity > existing.length) {
      const generated = createAssignmentsForGroup({ ...updatedGroup, quantity: requestedQuantity })
        .slice(existing.length)
        .map(item => ({ ...item, createdAt: now, updatedAt: now, createdBy: 'user' as const }))
      next.assignments.push(...generated)
      createdIds.push(...generated.map(item => item.id))
    }

    if (!old.recurring && !updatedGroup.recurring && requestedQuantity < existing.length) {
      const removeNeeded = existing.length - requestedQuantity
      const descending = [...existing].sort((a, b) => b.index - a.index)
      const removing: Assignment[] = []
      // Quantity reduction may only trim a safe contiguous suffix. If the latest child has
      // execution history/lock/timer protection, do not skip it and delete an earlier child;
      // that would silently change the meaning of the sequence.
      for (const item of descending) {
        if (removing.length >= removeNeeded) break
        const safe = item.status === 'todo'
          && item.progress === 0
          && item.actualMinutes === 0
          && item.timeEntries.length === 0
          && !item.locked
          && next.timer.assignmentId !== item.id
        if (!safe) {
          protectedIds.push(item.id)
          break
        }
        removing.push(item)
      }
      const removeSet = new Set(removing.map(item => item.id))
      removedIds.push(...removeSet)
      next.assignments = next.assignments.filter(item => !removeSet.has(item.id))
      updatedGroup.quantity = next.assignments.filter(item => item.groupId === updatedGroup.id).length
    }

    const changedRules = old.unitMinutes !== updatedGroup.unitMinutes || old.subject !== updatedGroup.subject || old.priority !== updatedGroup.priority
      || old.dailyMax !== updatedGroup.dailyMax || old.activityType !== updatedGroup.activityType || old.highIntensity !== updatedGroup.highIntensity
      || old.countInStats !== updatedGroup.countInStats
    const type: PlanChangeEvent['type'] = createdIds.length ? 'task-group-size-increase' : 'rule-change'
    const action: PlanChangeEvent['action'] = createdIds.length ? 'insert' : 'repair'
    const descriptionParts = [
      createdIds.length ? `仅新增 ${createdIds.length} 项缺失任务，已有任务保持原位优先。` : '',
      removedIds.length ? `预览移除 ${removedIds.length} 项尚未开始且无记录的任务。` : '',
      protectedIds.length ? `${protectedIds.length} 项因已完成、已开始、有实际用时、锁定或正在计时而保留。` : '',
      changedRules ? '共享规则发生变化，先重新评估风险，不会静默改写排期。' : '任务组信息发生变化。',
    ].filter(Boolean)
    const affectedIds = createdIds.length ? createdIds : next.assignments.filter(item => item.groupId === group.id && item.status !== 'done').map(item => item.id)
    const event = planEvent({
      type, action, title: `调整任务组：${updatedGroup.title}`, description: descriptionParts.join(''),
      affectedGoalIds: next.goals.filter(goal => goal.linkedTaskGroupIds.includes(group.id) || goal.completionConditions.some(condition => condition.groupId === group.id)).map(goal => goal.id),
      affectedGroupIds: [group.id], affectedAssignmentIds: affectedIds,
      affectedDates: [...new Set(next.assignments.filter(item => affectedIds.includes(item.id)).map(item => item.scheduledDate).filter((date): date is string => Boolean(date)))],
      metadata: { createdIds, removedIds, protectedIds, previousQuantity: existing.length, requestedQuantity, numberingChoice: firstExpansion ? numberingChoice : undefined, explicitLocalOperation: true, operationScope: 'requested-change-only', requestedChangeLabel: createdIds.length ? `仅保存任务组调整并新增 ${createdIds.length} 项任务` : '仅保存任务组调整' },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const prepareGoalChange = useCallback((draft: GoalDraft, goalId?: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    const existing = goalId ? next.goals.find(item => item.id === goalId) : undefined
    const latestDate = draft.latestDate
    const goal: Goal = {
      id: existing?.id ?? uid('goal'), title: draft.title.trim() || '未命名目标', description: draft.description, priority: draft.priority,
      desiredDate: draft.desiredDate ? (draft.desiredDate <= latestDate ? draft.desiredDate : latestDate) : undefined,
      latestDate, status: existing?.status === 'archived' ? 'archived' : 'active',
      completionConditions: draft.completionConditions,
      linkedTaskGroupIds: Array.from(new Set([...draft.linkedTaskGroupIds, ...draft.completionConditions.map(item => item.groupId)])),
      linkedAssignmentIds: Array.from(new Set(draft.linkedAssignmentIds)),
      createdAt: existing?.createdAt ?? now, updatedAt: now, completedAt: existing?.completedAt,
    }
    if (existing) next.goals = next.goals.map(item => item.id === existing.id ? goal : item)
    else next.goals.push(goal)
    const type = classifyGoalChange(before, next, existing, goal)
    // A partial Goal (for example, "complete 50% of Chemistry by 8/15") must only
    // nominate the assignments that actually satisfy that condition. Include both the
    // old and new counted sets so a relaxation can also consider work that has just
    // been released from the former, stricter requirement.
    const previousCountedIds = existing ? goalProgress(before, existing).countedAssignmentIds : []
    const nextCountedIds = goalProgress(next, goal).countedAssignmentIds
    const affectedAssignmentIds = Array.from(new Set([...previousCountedIds, ...nextCountedIds]))
    const event = planEvent({
      type, action: type === 'goal-relaxation' ? 'optimize' : 'repair', title: `${existing ? '调整' : '创建'}目标：${goal.title}`,
      description: '目标本身先进入草稿状态；日历日期只有在用户应用候选方案后才会改变。',
      affectedGoalIds: [goal.id], affectedGroupIds: goal.linkedTaskGroupIds,
      affectedAssignmentIds,
      affectedDates: [existing?.desiredDate, existing?.latestDate, goal.desiredDate, goal.latestDate].filter((date): date is string => Boolean(date)),
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const prepareGoalDelete = useCallback((goalId: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const goal = next.goals.find(item => item.id === goalId)
    if (!goal) return { state: next, event: planEvent({ type: 'goal-deletion', action: 'repair', title: '删除目标', description: '未找到目标。', affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [], affectedDates: [] }) }
    next.goals = next.goals.filter(item => item.id !== goalId)
    const event = planEvent({
      type: 'goal-deletion', action: 'optimize', title: `删除目标：${goal.title}`,
      description: '删除目标不会自动把任务推迟；可选择保持当前排期或利用释放的空间减负。',
      affectedGoalIds: [goal.id], affectedGroupIds: goal.linkedTaskGroupIds,
      affectedAssignmentIds: goalProgress(before, goal).countedAssignmentIds,
      affectedDates: [goal.desiredDate, goal.latestDate].filter((date): date is string => Boolean(date)),
      metadata: { explicitLocalOperation: true, operationScope: 'requested-change-only', requestedChangeLabel: `仅删除目标“${goal.title}”` },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = nowISO()
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  /** 仅修改目标名称/描述等纯展示字段：直接保存，不生成事件、方案或计划版本。 */
  const updateGoalMetadata = useCallback((goalId: string, patch: { title?: string; description?: string }) => commit(draft => {
    const goal = draft.goals.find(item => item.id === goalId)
    if (!goal) return
    if (patch.title !== undefined) goal.title = patch.title.trim() || goal.title
    if (patch.description !== undefined) goal.description = patch.description.trim() || undefined
    goal.updatedAt = nowISO()
  }), [commit])

  const prepareCalendarConstraintChange = useCallback((constraint?: CalendarConstraint, removeId?: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    let title = '调整日期可用性'
    let previousConstraint: CalendarConstraint | undefined
    let nextConstraint: CalendarConstraint | undefined

    if (removeId) {
      previousConstraint = next.calendarConstraints.find(item => item.id === removeId)
      if (previousConstraint) title = `移除日期约束：${previousConstraint.reason ?? previousConstraint.startDate}`
      next.calendarConstraints = next.calendarConstraints.filter(item => item.id !== removeId)
    } else if (constraint) {
      nextConstraint = { ...constraint, endDate: constraint.endDate || constraint.startDate, updatedAt: now, createdAt: constraint.createdAt || now }
      const index = next.calendarConstraints.findIndex(item => item.id === nextConstraint!.id)
      if (index >= 0) {
        previousConstraint = next.calendarConstraints[index]
        next.calendarConstraints[index] = nextConstraint
      } else next.calendarConstraints.push(nextConstraint)
      title = `${index >= 0 ? '修改' : '添加'}日期约束：${nextConstraint.reason ?? nextConstraint.startDate}`
    }

    // Editing a range must re-evaluate both the dates released by the old range and the dates
    // newly covered by the replacement range. Looking only at the new range loses half the event.
    const dateSet = new Set<string>()
    if (previousConstraint) for (const date of dateRange(previousConstraint.startDate, previousConstraint.endDate)) dateSet.add(date)
    if (nextConstraint) for (const date of dateRange(nextConstraint.startDate, nextConstraint.endDate)) dateSet.add(date)
    const affectedDates = [...dateSet].sort()
    const capacityDeltas = affectedDates.map(date => ({ date, before: getCapacity(before, date), after: getCapacity(next, date) }))
    const hasDecrease = capacityDeltas.some(item => item.after < item.before)
    const hasIncrease = capacityDeltas.some(item => item.after > item.before)
    const pureRelaxation = hasIncrease && !hasDecrease
    const start = affectedDates[0]
    const end = affectedDates.at(-1)

    // A restriction affects tasks currently inside the range. A pure relaxation is an optional
    // optimization opportunity: include future unfinished work so proposals may keep the current
    // schedule or use the newly released capacity to reduce pressure/pull work forward.
    const affectedAssignments = pureRelaxation
      ? next.assignments.filter(item => item.status !== 'done' && (!start || !item.scheduledDate || item.scheduledDate >= start))
      : next.assignments.filter(item => item.scheduledDate && start && end && item.scheduledDate >= start && item.scheduledDate <= end)
    const affectedGroups = Array.from(new Set(affectedAssignments.map(item => item.groupId)))
    const affectedGoals = next.goals.filter(goal => affectedAssignments.some(item =>
      goal.linkedAssignmentIds.includes(item.id)
      || goal.linkedTaskGroupIds.includes(item.groupId)
      || goal.completionConditions.some(condition => condition.groupId === item.groupId)
    )).map(goal => goal.id)
    const changeText = pureRelaxation
      ? '可用容量增加；不会自动把任务提前，可保持当前排期或预览如何利用新增空间减负。'
      : hasDecrease
        ? '可用容量减少或日期受到保护；受影响任务将先做完整校验，不会删除或直接改写日历。'
        : '日期规则发生变化；系统会重新检查相关任务，但不直接改写日历。'
    const event = planEvent({
      type: 'availability-change', action: pureRelaxation ? 'optimize' : 'repair', title,
      description: `${changeText} 当前识别 ${affectedAssignments.length} 项相关未完成/已安排任务。`,
      affectedGoalIds: affectedGoals,
      affectedGroupIds: affectedGroups,
      affectedAssignmentIds: affectedAssignments.map(item => item.id),
      affectedDates,
      metadata: { capacityDeltas, pureRelaxation, hasIncrease, hasDecrease, preferredPreferences: pureRelaxation ? ['preserve', 'balanced', 'goal', 'rest'] : ['preserve', 'balanced', 'goal', 'rest'] },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: next, event }
  }, [])

  /** 仅修改日期约束的备注名称：直接保存，不生成事件、方案或计划版本。 */
  const updateCalendarConstraintMetadata = useCallback((id: string, reason: string) => commit(draft => {
    const item = draft.calendarConstraints.find(candidate => candidate.id === id)
    if (!item) return
    item.reason = reason.trim() || item.reason
    item.updatedAt = nowISO()
  }), [commit])

  const prepareDurationChange = useCallback((suggestion: DurationSuggestion, estimate = suggestion.suggestedEstimate, reviewDate?: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    if (reviewDate) putReviewRecord(next, reviewDate)
    const group = next.taskGroups.find(item => item.id === suggestion.groupId)
    if (group) {
      group.unitMinutes = Math.max(1, Math.round(estimate))
      group.updatedAt = now
    }
    const eligible = new Set(suggestion.eligibleAssignmentIds)
    for (const item of next.assignments) {
      if (!eligible.has(item.id) || item.status !== 'todo' || item.durationCustomized || item.actualMinutes > 0) continue
      item.estimatedMinutes = Math.max(1, Math.round(estimate))
      item.updatedAt = now
    }
    const event = planEvent({
      type: 'rule-change', action: 'optimize', title: `调整预计时长：${group?.title ?? suggestion.groupId}`,
      description: `当前默认 ${suggestion.currentEstimate} 分钟，最近 ${suggestion.sampleCount} 个有效样本平均 ${Math.round(suggestion.recentAverage)} 分钟。预计时长先进入草稿，不会自动移动日历。`,
      affectedGoalIds: next.goals.filter(goal => goal.linkedTaskGroupIds.includes(suggestion.groupId) || goal.completionConditions.some(condition => condition.groupId === suggestion.groupId)).map(goal => goal.id),
      affectedGroupIds: [suggestion.groupId], affectedAssignmentIds: suggestion.eligibleAssignmentIds,
      affectedDates: next.assignments.filter(item => eligible.has(item.id) && item.scheduledDate).map(item => item.scheduledDate!).filter((value, index, values) => values.indexOf(value) === index),
      metadata: { currentEstimate: suggestion.currentEstimate, suggestedEstimate: estimate, sampleCount: suggestion.sampleCount, deviationRatio: suggestion.deviationRatio, reviewDate, containsReviewRecord: Boolean(reviewDate) },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const prepareReviewCompletion = useCallback((date: string, carryDates: Record<string, string>): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const record = putReviewRecord(next, date)
    const movedAt = nowISO()
    const movedIds: string[] = []
    const affectedDates = new Set<string>([date])
    for (const [assignmentId, targetDate] of Object.entries(carryDates)) {
      if (!targetDate || targetDate <= date) continue
      const assignment = next.assignments.find(item => item.id === assignmentId)
      if (!assignment || assignment.status === 'done' || assignment.locked || next.timer.assignmentId === assignment.id || assignment.scheduledDate === targetDate) continue
      if (assignment.scheduledDate) affectedDates.add(assignment.scheduledDate)
      affectedDates.add(targetDate)
      assignment.previousDate = assignment.scheduledDate
      assignment.scheduledDate = targetDate
      assignment.lastManualMoveAt = movedAt
      assignment.scheduleSource = 'carryover'
      assignment.intentStrength = 'manual'
      assignment.updatedAt = movedAt
      movedIds.push(assignment.id)
    }
    const groupIds = Array.from(new Set(next.assignments.filter(item => movedIds.includes(item.id)).map(item => item.groupId)))
    const goalIds = next.goals.filter(goal => goal.linkedAssignmentIds.some(id => movedIds.includes(id)) || goal.linkedTaskGroupIds.some(id => groupIds.includes(id)) || goal.completionConditions.some(condition => groupIds.includes(condition.groupId))).map(goal => goal.id)
    const event = planEvent({
      type: 'execution-difference', action: 'repair', title: `完成 ${date} 复盘并处理未完成任务`,
      description: movedIds.length
        ? `复盘记录已进入草稿；用户选择顺延 ${movedIds.length} 项任务。系统会把组合后的容量、每日上限、目标期限与日期保护一起校验，应用前不会修改正式计划。`
        : '复盘记录已进入草稿，没有选择顺延任务。',
      affectedGoalIds: goalIds, affectedGroupIds: groupIds, affectedAssignmentIds: movedIds, affectedDates: [...affectedDates].sort(),
      metadata: { reviewDate: date, reviewRecordId: record.id, containsReviewRecord: true, reviewCarryover: movedIds.length > 0, requestedCarryDates: carryDates, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = movedAt
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const generateProposals = useCallback((preparedState: AppState, event: PlanChangeEvent, baseline?: AppState, signal?: AbortSignal, expansionLevel = 0, resolutionOptions?: { acceptedExceptions?: ConstraintException[]; disableAutomaticExceptions?: boolean }) => {
    return generateSchedulingProposals(preparedState, event, {
      baseline: baseline ?? stateRef.current,
      signal,
      expansionLevel,
      acceptedExceptions: resolutionOptions?.acceptedExceptions,
      disableAutomaticExceptions: resolutionOptions?.disableAutomaticExceptions,
    })
  }, [])

  const applySchedulingProposal = useCallback((proposal: SchedulingProposal, event: PlanChangeEvent) => setState(previous => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
    history.current = [...history.current.slice(-29), previous]
    let next = hydratePortableState(proposal.stateAfter, { replanHistory: previous.replanHistory, conflictBackups: previous.conflictBackups, planVersions: previous.planVersions })
    next = normalizeState(next)
    if (proposal.exceptions.length) {
      const acceptedAt = nowISO()
      next.acceptedConstraintExceptions = [
        ...(previous.acceptedConstraintExceptions ?? []),
        ...proposal.exceptions.map(item => ({ ...item, id: uid('exception'), eventId: event.id, accepted: true as const, createdAt: acceptedAt })),
      ].slice(-100)
    } else next.acceptedConstraintExceptions = previous.acceptedConstraintExceptions ?? []
    next.changeEvents = Array.from(new Map([...previous.changeEvents, event].map(item => [item.id, item])).values()).slice(-100)
    next.planVersions = [...previous.planVersions, createVersionFromProposal(previous, next, event, proposal)].slice(-10)
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])

  const applyPreparedWithoutScheduling = useCallback((preparedState: AppState, event: PlanChangeEvent, reason = '保留为未安排任务') => setState(previous => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
    history.current = [...history.current.slice(-29), previous]
    const draft = cloneActiveState(preparedState)
    // “保留为未安排”必须真正清空本次新增任务的草稿日期；不能把一个已经
    // 被判定为冲突的偏好日期或锁定日期带入正式计划。
    if (event.type === 'new-task-insertion' || event.type === 'task-group-size-increase') {
      const affected = new Set(event.affectedAssignmentIds)
      for (const item of draft.assignments) {
        if (!affected.has(item.id)) continue
        item.previousDate = item.scheduledDate
        item.scheduledDate = undefined
        item.locked = false
        item.intentStrength = 'normal'
        item.scheduleSource = 'system'
        item.updatedAt = nowISO()
      }
    }
    const next = normalizeState(draft)
    next.changeEvents = Array.from(new Map([...previous.changeEvents, event].map(item => [item.id, item])).values()).slice(-100)
    next.planVersions = [...previous.planVersions, createPlanVersion(previous, next, event, `${event.title} · ${reason}`)].slice(-10)
    next.replanHistory = previous.replanHistory
    next.conflictBackups = previous.conflictBackups
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])



  const restoreReplanHistory = useCallback((id: string) => setState(previous => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
    const entry = previous.replanHistory.find(item => item.id === id)
    if (!entry) return previous
    history.current = [...history.current.slice(-29), previous]
    try {
      const restored = restoreSnapshotState(previous, entry.snapshot)
      const event = planEvent({ type: 'restore', action: 'repair', title: `恢复旧调整记录：${entry.label}`, description: '恢复前已保存当前计划，所有实际执行记录和后来已执行的任务都会保留。', affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [], affectedDates: [] })
      restored.replanHistory = previous.replanHistory
      restored.planVersions = [...previous.planVersions, createPlanVersion(previous, restored, event, event.title)].slice(-10)
      restored.updatedAt = nowISO()
      return restored
    } catch {
      return previous
    }
  }), [])

  const recordReview = useCallback((date: string): ReviewRecord => {
    const record = reviewRecordFor(stateRef.current, date)
    commit(draft => { draft.reviewRecords = [...draft.reviewRecords.filter(item => item.date !== date), record].slice(-120) })
    return record
  }, [commit])

  const completeReview = useCallback((date: string): ReviewRecord => {
    const record = reviewRecordFor(stateRef.current, date)
    setState(previous => {
      if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
      if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
      history.current = [...history.current.slice(-29), previous]
      const next = cloneForMutation(previous)
      next.reviewRecords = [...next.reviewRecords.filter(item => item.date !== date), record].slice(-120)
      next.updatedAt = nowISO()
      if (namespaceRef.current === 'guest') next.guestModified = true
      return updateGoalAndGroupLifecycle(next)
    })
    return record
  }, [])

  const previewPlanVersion = useCallback((id: string, side: 'before' | 'after' = 'after') => {
    const version = stateRef.current.planVersions.find(item => item.id === id)
    return version ? previewVersionDiff(stateRef.current, version, side) : undefined
  }, [])

  const restorePlanVersion = useCallback((id: string, side: 'before' | 'after' = 'after') => setState(previous => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return previous
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return previous
    const version = previous.planVersions.find(item => item.id === id)
    if (!version) return previous
    history.current = [...history.current.slice(-29), previous]
    try {
      const restored = restoreVersionState(previous, version, side)
      const event = planEvent({ type: 'restore', action: 'repair', title: `恢复计划版本：${version.reason}`, description: '恢复前已保存当前计划；实际学习记录不会被旧快照覆盖。', affectedGoalIds: version.affectedGoalIds, affectedGroupIds: version.affectedGroupIds, affectedAssignmentIds: version.affectedAssignmentIds, affectedDates: version.affectedDates })
      const beforeRestoreVersion: PlanVersion = createPlanVersion(previous, previous, event, `恢复前自动保存 · ${version.reason}`)
      restored.planVersions = [...previous.planVersions, beforeRestoreVersion].slice(-10)
      restored.changeEvents = [...previous.changeEvents, event].slice(-100)
      restored.updatedAt = nowISO()
      if (namespaceRef.current === 'guest') restored.guestModified = true
      return updateGoalAndGroupLifecycle(restored)
    } catch {
      return previous
    }
  }), [])

  const startTimer = useCallback((assignmentId: string) => commit(draft => {
    const now = Date.now()
    if (draft.timer.running && draft.timer.startedAt) draft.timer.accumulatedSeconds += Math.floor((now - draft.timer.startedAt) / 1000)
    draft.timer = { assignmentId, startedAt: now, accumulatedSeconds: draft.timer.assignmentId === assignmentId ? draft.timer.accumulatedSeconds : 0, running: true }
  }, { history: false }), [commit])

  const pauseTimer = useCallback(() => commit(draft => {
    if (!draft.timer.running || !draft.timer.startedAt) return
    draft.timer.accumulatedSeconds += Math.floor((Date.now() - draft.timer.startedAt) / 1000)
    draft.timer.startedAt = undefined
    draft.timer.running = false
  }, { history: false }), [commit])

  const stopTimer = useCallback(() => {
    const timer = stateRef.current.timer
    let seconds = timer.accumulatedSeconds
    if (timer.running && timer.startedAt) seconds += Math.floor((Date.now() - timer.startedAt) / 1000)
    commit(draft => { draft.timer = { accumulatedSeconds: 0, running: false } }, { history: false })
    return Math.max(1, Math.round(seconds / 60))
  }, [commit])

  const dismissSequenceRenumberSuggestion = useCallback(() => setSequenceRenumberSuggestion(undefined), [])

  const applySequenceRenumber = useCallback((groupIds?: string[]) => {
    const selected = groupIds?.length ? groupIds : sequenceRenumberSuggestion?.groups.map(group => group.groupId) ?? []
    if (!selected.length) { setSequenceRenumberSuggestion(undefined); return }
    commit(draft => renumberTaskGroupsByDate(draft, selected))
    setSequenceRenumberSuggestion(undefined)
  }, [commit, sequenceRenumberSuggestion])

  const resetAll = useCallback(async (kind: 'demo' | 'blank' = namespaceRef.current === 'guest' ? 'demo' : 'blank') => {
    if (guidedTutorialMutationBlocked(namespaceRef.current)) return
    if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return
    const next = templateState(kind)
    await clearLocalState(namespaceRef.current)
    history.current = []
    setState(next)
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    state, namespace, ready, loadedFromStorage, canUndo: history.current.length > 0,
    commit, replaceState, loadDataSpace, setDataSpace, clearDataSpace, undo,
    updateSettings, updateDayConfig, updateAssignment, moveAssignments, finishAssignment, reopenAssignment, addTime, updateTimeEntry, deleteTimeEntry, captureDailyPlanBaseline,
    addTaskGroup, editTaskGroup, deleteTaskGroup, removeAssignment, prepareTaskGroupDelete, prepareAssignmentDelete, prepareAssignmentGroupChange,
    prepareSingleAssignment, prepareTaskGroup, createIntakeBatch, duplicateIntakeBatch, updateIntakeBatch, addIntakeSingleTask, addIntakeTaskGroup, updateIntakeSingleTask, updateIntakeTaskGroup, removeIntakeTaskGroup, deleteIntakeBatch, prepareIntakeBatch,
    prepareTaskGroupEdit, prepareGoalChange, prepareGoalDelete, updateGoalMetadata, prepareCalendarConstraintChange, updateCalendarConstraintMetadata, prepareDurationChange, prepareReviewCompletion,
    generateProposals, applySchedulingProposal, applyPreparedWithoutScheduling,
    restoreReplanHistory, recordReview, completeReview, previewPlanVersion, restorePlanVersion,
    startTimer, pauseTimer, stopTimer, resetAll, sequenceRenumberSuggestion,
    dismissSequenceRenumberSuggestion, applySequenceRenumber,
  }), [
    state, namespace, ready, loadedFromStorage, commit, replaceState, loadDataSpace, setDataSpace, clearDataSpace, undo,
    updateSettings, updateDayConfig, updateAssignment, moveAssignments, finishAssignment, reopenAssignment, addTime, updateTimeEntry, deleteTimeEntry, captureDailyPlanBaseline,
    addTaskGroup, editTaskGroup, deleteTaskGroup, removeAssignment, prepareTaskGroupDelete, prepareAssignmentDelete, prepareAssignmentGroupChange, prepareSingleAssignment, prepareTaskGroup,
    createIntakeBatch, duplicateIntakeBatch, updateIntakeBatch, addIntakeSingleTask, addIntakeTaskGroup, updateIntakeSingleTask, updateIntakeTaskGroup, removeIntakeTaskGroup, deleteIntakeBatch, prepareIntakeBatch, prepareTaskGroupEdit, prepareGoalChange,
    prepareGoalDelete, updateGoalMetadata, prepareCalendarConstraintChange, updateCalendarConstraintMetadata, prepareDurationChange, prepareReviewCompletion, generateProposals, applySchedulingProposal,
    applyPreparedWithoutScheduling, restoreReplanHistory, recordReview, completeReview,
    previewPlanVersion, restorePlanVersion, startTimer, pauseTimer, stopTimer, resetAll,
    sequenceRenumberSuggestion, dismissSequenceRenumberSuggestion, applySequenceRenumber,
  ])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}

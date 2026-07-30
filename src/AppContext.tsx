import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AppSettings, AppState, Assignment, CalendarConstraint, CreateResult, DayConfig, DurationSuggestion, Goal, GoalDraft,
  NewTaskDraft, PlanChangeEvent, PlanVersion, ReplanAudit, ReplanBundle, ReplanHistoryEntry, ReplanRequest,
  ReplanResult, ReviewRecord, SchedulingProposal, SequenceRenumberSuggestion, TaskGroup, TaskGroupDraft,
} from './types'
import {
  buildBlankState, buildGuestDemoState, buildInitialState, createAssignmentsForGroup, normalizeState,
} from './lib/seed'
import { clearLocalState, loadLocalState, saveLocalState } from './lib/db'
import { allDurationSuggestions, generateReplanBundle, generateSchedulingProposals } from './lib/planner'
import { uid } from './lib/id'
import { findSequenceRenumberGroups, renumberTaskGroupsByDate } from './lib/sequence'
import { updateGoalAndGroupLifecycle } from './lib/goals'
import { cloneActiveState, hydratePortableState } from './lib/state'
import { createPlanVersion, createVersionFromProposal, previewVersionDiff, restoreVersionState, type VersionDiffSummary } from './lib/versions'
import { todayISO } from './lib/date'

type Recipe = (draft: AppState) => void

type PrepareStateResult = { state: AppState; event: PlanChangeEvent }

interface AppContextValue {
  state: AppState
  namespace: string
  ready: boolean
  loadedFromStorage: boolean
  canUndo: boolean
  commit: (recipe: Recipe, options?: { history?: boolean; markGuestModified?: boolean }) => void
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
  addTaskGroup: (group: TaskGroup) => void
  editTaskGroup: (group: TaskGroup) => void
  deleteTaskGroup: (id: string) => void
  removeAssignment: (id: string) => void
  moveAssignmentToGroup: (id: string, groupId: string, adoptDefaultDuration?: boolean) => void
  prepareSingleAssignment: (draft: NewTaskDraft) => CreateResult
  prepareTaskGroup: (draft: TaskGroupDraft) => CreateResult
  prepareTaskGroupEdit: (group: TaskGroup) => PrepareStateResult
  prepareGoalChange: (draft: GoalDraft, goalId?: string) => PrepareStateResult
  prepareGoalDelete: (goalId: string) => PrepareStateResult
  prepareCalendarConstraintChange: (constraint?: CalendarConstraint, removeId?: string) => PrepareStateResult
  prepareDurationChange: (suggestion: DurationSuggestion, estimate?: number) => PrepareStateResult
  generateProposals: (preparedState: AppState, event: PlanChangeEvent, baseline?: AppState, signal?: AbortSignal) => SchedulingProposal[]
  applySchedulingProposal: (proposal: SchedulingProposal, event: PlanChangeEvent) => void
  applyPreparedWithoutScheduling: (preparedState: AppState, event: PlanChangeEvent, reason?: string) => void
  previewReplan: (request?: Partial<ReplanRequest>, baseState?: AppState) => ReplanBundle
  applyReplan: (result: ReplanResult, editedState?: AppState, audit?: ReplanAudit) => void
  restoreReplanHistory: (id: string) => void
  recordReview: (date: string) => ReviewRecord
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

function withoutNestedHistory(state: AppState) {
  return structuredClone({ ...state, replanHistory: [], conflictBackups: [], planVersions: [] })
}

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

function planEvent(input: Omit<PlanChangeEvent, 'id' | 'createdAt'>): PlanChangeEvent {
  return { id: uid('event'), createdAt: nowISO(), ...input }
}

function automaticTitle(group: TaskGroup, index: number) {
  return group.quantity > 1 ? `${group.title} ${String(index).padStart(2, '0')}` : group.title
}

function goalStrictness(goal: GoalDraft | Goal): number {
  const dateWeight = (value?: string) => value ? Date.parse(value) : Number.MAX_SAFE_INTEGER
  const conditionWeight = goal.completionConditions.reduce((sum, item) => {
    if (item.mode === 'all') return sum + 1_000_000
    if (item.mode === 'percentage') return sum + (item.value ?? 0) * 10_000
    return sum + (item.value ?? 0) * 1_000
  }, 0)
  return -dateWeight(goal.latestDate) - dateWeight(goal.desiredDate) / 10 + conditionWeight
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
    if (!ready || !previous || previous.namespace !== namespace) return
    const changedGroupIds = new Set<string>()
    const changedSources = new Set<'manual' | 'automatic'>()
    for (const assignment of state.assignments) {
      const before = previous.assignments.get(assignment.id)
      if (!before || before.scheduledDate === assignment.scheduledDate) continue
      changedGroupIds.add(assignment.groupId)
      changedSources.add(assignment.scheduleSource === 'replan' ? 'automatic' : 'manual')
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
      if (pushHistory) history.current = [...history.current.slice(-29), previous]
      const next = normalizeState(nextInput)
      next.updatedAt = nowISO()
      if (namespaceRef.current === 'guest') next.guestModified = true
      return next
    })
  }, [])

  const commit = useCallback((recipe: Recipe, options?: { history?: boolean; markGuestModified?: boolean }) => {
    setState(previous => {
      if (options?.history !== false) history.current = [...history.current.slice(-29), previous]
      let next = cloneForMutation(previous)
      recipe(next)
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
    const oldDate = item.scheduledDate
    const moving = Object.prototype.hasOwnProperty.call(patch, 'scheduledDate') && patch.scheduledDate !== oldDate
    Object.assign(item, patch)
    item.updatedAt = nowISO()
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
    item.timeEntries.push({ id: uid('time'), minutes, createdAt: nowISO(), source })
    item.updatedAt = nowISO()
  }), [commit])

  const finishAssignment = useCallback((id: string, actualMinutes?: number, source: 'timer' | 'manual' | 'finish' = 'finish') => commit(draft => {
    const item = draft.assignments.find(candidate => candidate.id === id)
    if (!item) return
    if (actualMinutes && actualMinutes > 0) {
      item.actualMinutes += actualMinutes
      item.timeEntries.push({ id: uid('time'), minutes: actualMinutes, createdAt: nowISO(), source })
    }
    item.progress = 100
    item.remainingMinutes = 0
    item.status = 'done'
    item.completedAt = nowISO()
    item.updatedAt = nowISO()
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

  const deleteTaskGroup = useCallback((id: string) => setState(previous => {
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

  const removeAssignment = useCallback((id: string) => setState(previous => {
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

  const moveAssignmentToGroup = useCallback((id: string, groupId: string, adoptDefaultDuration = false) => commit(draft => {
    const assignment = draft.assignments.find(item => item.id === id)
    const newGroup = draft.taskGroups.find(item => item.id === groupId)
    if (!assignment || !newGroup || assignment.groupId === groupId) return
    const oldGroupId = assignment.groupId
    assignment.groupId = groupId
    assignment.index = draft.assignments.filter(item => item.groupId === groupId && item.id !== id).length + 1
    assignment.updatedAt = nowISO()
    if (adoptDefaultDuration && assignment.status === 'todo' && assignment.actualMinutes === 0) {
      assignment.estimatedMinutes = newGroup.unitMinutes
      assignment.durationCustomized = false
      assignment.manuallyEstimated = false
    }
    const oldGroup = draft.taskGroups.find(item => item.id === oldGroupId)
    if (oldGroup?.hiddenStandalone && !draft.assignments.some(item => item.groupId === oldGroupId)) {
      draft.taskGroups = draft.taskGroups.filter(item => item.id !== oldGroupId)
    }
  }), [commit])

  const prepareSingleAssignment = useCallback((draft: NewTaskDraft): CreateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    let group = draft.groupId ? next.taskGroups.find(item => item.id === draft.groupId) : undefined
    const createdGroupIds: string[] = []
    if (!group || draft.standalone) {
      group = {
        id: uid('group'), subject: '其他', title: draft.title.trim() || '未命名任务', priority: 1, quantity: 0,
        unitMinutes: Math.max(1, Math.round(draft.estimatedMinutes)), targetDate: next.settings.endDate, dueDate: next.settings.endDate,
        countInStats: true, hidden: true, hiddenStandalone: true, activityType: 'normal', highIntensity: false,
        status: 'active', createdAt: now, updatedAt: now,
      }
      next.taskGroups.push(group)
      createdGroupIds.push(group.id)
    }
    const existing = next.assignments.filter(item => item.groupId === group!.id)
    const index = existing.length + 1
    const defaultTitle = existing.length > 0 ? `${group.title} ${String(index).padStart(2, '0')}` : group.title
    const requestedTitle = draft.title.trim() || defaultTitle
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
      affectedDates: assignment.scheduledDate ? [assignment.scheduledDate] : [], metadata: { schedulingIntent: draft.schedulingIntent },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event, createdAssignmentIds: [assignment.id], createdGroupIds }
  }, [])

  const prepareTaskGroup = useCallback((draft: TaskGroupDraft): CreateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
    const group: TaskGroup = {
      id: uid('group'), subject: draft.subject, title: draft.title.trim() || '未命名任务组', priority: draft.priority,
      quantity: Math.max(1, Math.round(draft.quantity)), unitMinutes: Math.max(1, Math.round(draft.unitMinutes)),
      targetDate: next.settings.endDate, dueDate: next.settings.endDate, dailyMax: draft.dailyMax,
      countInStats: draft.countInStats, activityType: draft.activityType, highIntensity: draft.highIntensity,
      notes: draft.notes, status: 'active', createdAt: now, updatedAt: now,
    }
    const assignments = createAssignmentsForGroup(group).map(item => ({ ...item, createdAt: now, updatedAt: now, createdBy: 'user' as const }))
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

  const prepareTaskGroupEdit = useCallback((group: TaskGroup): PrepareStateResult => {
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

    for (const assignment of existing) {
      if (!assignment.durationCustomized && !assignment.manuallyEstimated && assignment.status === 'todo' && assignment.actualMinutes === 0) {
        assignment.estimatedMinutes = updatedGroup.unitMinutes
      }
      if (!assignment.titleCustomized) assignment.title = requestedQuantity > 1 ? `${updatedGroup.title} ${String(assignment.index).padStart(2, '0')}` : updatedGroup.title
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
      const removable = descending.filter(item => item.status === 'todo' && item.progress === 0 && item.actualMinutes === 0 && !item.locked && next.timer.assignmentId !== item.id)
      const removing = removable.slice(0, removeNeeded)
      const removeSet = new Set(removing.map(item => item.id))
      removedIds.push(...removeSet)
      protectedIds.push(...descending.filter(item => !removeSet.has(item.id)).slice(0, Math.max(0, removeNeeded - removing.length)).map(item => item.id))
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
      metadata: { createdIds, removedIds, protectedIds, previousQuantity: existing.length, requestedQuantity },
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
      id: existing?.id ?? uid('goal'), title: draft.title.trim() || '未命名目标', description: draft.description,
      desiredDate: draft.desiredDate && draft.desiredDate <= latestDate ? draft.desiredDate : latestDate,
      latestDate, status: existing?.status === 'archived' ? 'archived' : 'active',
      completionConditions: draft.completionConditions,
      linkedTaskGroupIds: Array.from(new Set([...draft.linkedTaskGroupIds, ...draft.completionConditions.map(item => item.groupId)])),
      linkedAssignmentIds: Array.from(new Set(draft.linkedAssignmentIds)),
      createdAt: existing?.createdAt ?? now, updatedAt: now, completedAt: existing?.completedAt,
    }
    if (existing) next.goals = next.goals.map(item => item.id === existing.id ? goal : item)
    else next.goals.push(goal)
    const oldStrictness = existing ? goalStrictness(existing) : -Infinity
    const newStrictness = goalStrictness(goal)
    const type = !existing || newStrictness > oldStrictness ? 'goal-tightening' : newStrictness < oldStrictness ? 'goal-relaxation' : 'rule-change'
    const event = planEvent({
      type, action: type === 'goal-relaxation' ? 'optimize' : 'repair', title: `${existing ? '调整' : '创建'}目标：${goal.title}`,
      description: '目标本身先进入草稿状态；日历日期只有在用户应用候选方案后才会改变。',
      affectedGoalIds: [goal.id], affectedGroupIds: goal.linkedTaskGroupIds,
      affectedAssignmentIds: next.assignments.filter(item => goal.linkedAssignmentIds.includes(item.id) || goal.linkedTaskGroupIds.includes(item.groupId)).map(item => item.id),
      affectedDates: [goal.desiredDate, goal.latestDate].filter((date): date is string => Boolean(date)),
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
      affectedAssignmentIds: next.assignments.filter(item => goal.linkedAssignmentIds.includes(item.id) || goal.linkedTaskGroupIds.includes(item.groupId)).map(item => item.id),
      affectedDates: [goal.desiredDate, goal.latestDate].filter((date): date is string => Boolean(date)),
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = nowISO()
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const prepareCalendarConstraintChange = useCallback((constraint?: CalendarConstraint, removeId?: string): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    let affectedDates: string[] = []
    let title = '调整日期可用性'
    if (removeId) {
      const existing = next.calendarConstraints.find(item => item.id === removeId)
      if (existing) {
        affectedDates = [existing.startDate, existing.endDate]
        title = `移除日期约束：${existing.reason ?? existing.startDate}`
      }
      next.calendarConstraints = next.calendarConstraints.filter(item => item.id !== removeId)
    } else if (constraint) {
      const normalized = { ...constraint, endDate: constraint.endDate || constraint.startDate, updatedAt: nowISO(), createdAt: constraint.createdAt || nowISO() }
      const index = next.calendarConstraints.findIndex(item => item.id === normalized.id)
      if (index >= 0) next.calendarConstraints[index] = normalized
      else next.calendarConstraints.push(normalized)
      affectedDates = [normalized.startDate, normalized.endDate]
      title = `${index >= 0 ? '修改' : '添加'}日期约束：${normalized.reason ?? normalized.startDate}`
    }
    const start = affectedDates.sort()[0]
    const end = affectedDates.sort().at(-1)
    const affectedAssignments = next.assignments.filter(item => item.scheduledDate && start && end && item.scheduledDate >= start && item.scheduledDate <= end)
    const event = planEvent({
      type: 'availability-change', action: 'repair', title,
      description: `发现 ${affectedAssignments.length} 项已安排任务可能受影响；不会删除任务，也不会直接改写日历。`,
      affectedGoalIds: next.goals.filter(goal => affectedAssignments.some(item => goal.linkedAssignmentIds.includes(item.id) || goal.linkedTaskGroupIds.includes(item.groupId))).map(goal => goal.id),
      affectedGroupIds: Array.from(new Set(affectedAssignments.map(item => item.groupId))),
      affectedAssignmentIds: affectedAssignments.map(item => item.id), affectedDates,
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = nowISO()
    return { state: next, event }
  }, [])

  const prepareDurationChange = useCallback((suggestion: DurationSuggestion, estimate = suggestion.suggestedEstimate): PrepareStateResult => {
    const before = stateRef.current
    const next = cloneActiveState(before)
    const now = nowISO()
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
      metadata: { currentEstimate: suggestion.currentEstimate, suggestedEstimate: estimate, sampleCount: suggestion.sampleCount, deviationRatio: suggestion.deviationRatio },
    })
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    return { state: updateGoalAndGroupLifecycle(next), event }
  }, [])

  const generateProposals = useCallback((preparedState: AppState, event: PlanChangeEvent, baseline?: AppState, signal?: AbortSignal) => {
    return generateSchedulingProposals(preparedState, event, { baseline: baseline ?? stateRef.current, signal })
  }, [])

  const applySchedulingProposal = useCallback((proposal: SchedulingProposal, event: PlanChangeEvent) => setState(previous => {
    history.current = [...history.current.slice(-29), previous]
    let next = hydratePortableState(proposal.stateAfter, { replanHistory: previous.replanHistory, conflictBackups: previous.conflictBackups, planVersions: previous.planVersions })
    next = normalizeState(next)
    next.changeEvents = Array.from(new Map([...previous.changeEvents, event].map(item => [item.id, item])).values()).slice(-100)
    next.planVersions = [...previous.planVersions, createVersionFromProposal(previous, next, event, proposal)].slice(-10)
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])

  const applyPreparedWithoutScheduling = useCallback((preparedState: AppState, event: PlanChangeEvent, reason = '保留为未安排任务') => setState(previous => {
    history.current = [...history.current.slice(-29), previous]
    const next = normalizeState(preparedState)
    next.planVersions = [...previous.planVersions, createPlanVersion(previous, next, event, `${event.title} · ${reason}`)].slice(-10)
    next.replanHistory = previous.replanHistory
    next.conflictBackups = previous.conflictBackups
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])

  const previewReplan = useCallback((request?: Partial<ReplanRequest>, baseState?: AppState) => {
    const source = baseState ?? stateRef.current
    return generateReplanBundle(source, {
      mode: request?.mode ?? 'repair', fromDate: request?.fromDate ?? todayISO(), strategy: request?.strategy,
      freezeDays: request?.freezeDays ?? source.settings.freezeDays, todayExtraMinutes: request?.todayExtraMinutes ?? 0,
      allowBufferUseDates: request?.allowBufferUseDates ?? [], limitOverrides: request?.limitOverrides ?? [],
      localRadius: request?.localRadius ?? source.settings.localRepairRadius,
      affectedAssignmentIds: request?.affectedAssignmentIds, event: request?.event,
    })
  }, [])

  const applyReplan = useCallback((result: ReplanResult, editedState?: AppState, audit?: ReplanAudit) => setState(previous => {
    history.current = [...history.current.slice(-29), previous]
    const event = result.request.event ?? planEvent({
      type: 'future-replanning', action: result.request.mode === 'full' ? 'rebuild' : 'repair',
      title: `计划调整：${result.title}`, description: result.description,
      affectedGoalIds: [], affectedGroupIds: Array.from(new Set(result.moves.map(item => previous.assignments.find(task => task.id === item.assignmentId)?.groupId).filter((id): id is string => Boolean(id)))),
      affectedAssignmentIds: result.moves.map(item => item.assignmentId), affectedDates: result.loadChanges.map(item => item.date),
    })
    const entry: ReplanHistoryEntry = {
      id: uid('history'), createdAt: nowISO(), label: `计划调整 · ${result.title}`, mode: result.request.mode,
      moveCount: result.moves.length, snapshot: JSON.stringify(withoutNestedHistory(previous)), audit,
    }
    const next = normalizeState(editedState ?? result.nextState)
    entry.afterSnapshot = JSON.stringify(withoutNestedHistory(next))
    next.replanHistory = [...previous.replanHistory, entry].slice(-10)
    next.conflictBackups = previous.conflictBackups
    next.planVersions = [...previous.planVersions, createPlanVersion(previous, next, event, entry.label)].slice(-10)
    next.changeEvents = [...previous.changeEvents, event].slice(-100)
    next.updatedAt = nowISO()
    if (namespaceRef.current === 'guest') next.guestModified = true
    return updateGoalAndGroupLifecycle(next)
  }), [])

  const restoreReplanHistory = useCallback((id: string) => setState(previous => {
    const entry = previous.replanHistory.find(item => item.id === id)
    if (!entry) return previous
    history.current = [...history.current.slice(-29), previous]
    try {
      const restored = normalizeState(JSON.parse(entry.snapshot) as AppState)
      const event = planEvent({ type: 'restore', action: 'repair', title: `恢复旧重排记录：${entry.label}`, description: '恢复前已保存当前计划，实际执行记录按恢复政策保留。', affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [], affectedDates: [] })
      restored.replanHistory = previous.replanHistory
      restored.planVersions = [...previous.planVersions, createPlanVersion(previous, restored, event, event.title)].slice(-10)
      restored.updatedAt = nowISO()
      return restored
    } catch {
      return previous
    }
  }), [])

  const recordReview = useCallback((date: string): ReviewRecord => {
    const source = stateRef.current
    const tasks = source.assignments.filter(item => item.scheduledDate === date)
    const suggestions = allDurationSuggestions(source)
    const record: ReviewRecord = {
      id: uid('review'), date, createdAt: nowISO(), completedCount: tasks.filter(item => item.status === 'done').length,
      totalCount: tasks.length, plannedMinutes: tasks.reduce((sum, item) => sum + item.estimatedMinutes, 0),
      actualMinutes: tasks.reduce((sum, item) => sum + item.actualMinutes, 0),
      unfinishedAssignmentIds: tasks.filter(item => item.status !== 'done').map(item => item.id),
      durationSuggestionGroupIds: suggestions.map(item => item.groupId),
    }
    commit(draft => { draft.reviewRecords = [...draft.reviewRecords.filter(item => item.date !== date), record].slice(-120) })
    return record
  }, [commit])

  const previewPlanVersion = useCallback((id: string, side: 'before' | 'after' = 'after') => {
    const version = stateRef.current.planVersions.find(item => item.id === id)
    return version ? previewVersionDiff(stateRef.current, version, side) : undefined
  }, [])

  const restorePlanVersion = useCallback((id: string, side: 'before' | 'after' = 'after') => setState(previous => {
    const version = previous.planVersions.find(item => item.id === id)
    if (!version) return previous
    history.current = [...history.current.slice(-29), previous]
    try {
      const restored = restoreVersionState(previous, version, side)
      const event = planEvent({ type: 'restore', action: 'repair', title: `恢复计划版本：${version.reason}`, description: '恢复前已保存当前计划；实际学习记录不会被旧快照覆盖。', affectedGoalIds: version.affectedGoalIds, affectedGroupIds: version.affectedGroupIds, affectedAssignmentIds: version.affectedAssignmentIds, affectedDates: version.affectedDates })
      const beforeRestoreVersion: PlanVersion = createPlanVersion(previous, restored, event, `恢复前自动保存 · ${version.reason}`)
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
    const next = templateState(kind)
    await clearLocalState(namespaceRef.current)
    history.current = []
    setState(next)
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    state, namespace, ready, loadedFromStorage, canUndo: history.current.length > 0,
    commit, replaceState, loadDataSpace, setDataSpace, clearDataSpace, undo,
    updateSettings, updateDayConfig, updateAssignment, moveAssignments, finishAssignment, reopenAssignment, addTime,
    addTaskGroup, editTaskGroup, deleteTaskGroup, removeAssignment, moveAssignmentToGroup,
    prepareSingleAssignment, prepareTaskGroup, prepareTaskGroupEdit, prepareGoalChange, prepareGoalDelete, prepareCalendarConstraintChange, prepareDurationChange,
    generateProposals, applySchedulingProposal, applyPreparedWithoutScheduling,
    previewReplan, applyReplan, restoreReplanHistory, recordReview, previewPlanVersion, restorePlanVersion,
    startTimer, pauseTimer, stopTimer, resetAll, sequenceRenumberSuggestion,
    dismissSequenceRenumberSuggestion, applySequenceRenumber,
  }), [
    state, namespace, ready, loadedFromStorage, commit, replaceState, loadDataSpace, setDataSpace, clearDataSpace, undo,
    updateSettings, updateDayConfig, updateAssignment, moveAssignments, finishAssignment, reopenAssignment, addTime,
    addTaskGroup, editTaskGroup, deleteTaskGroup, removeAssignment, moveAssignmentToGroup, prepareSingleAssignment, prepareTaskGroup, prepareTaskGroupEdit, prepareGoalChange,
    prepareGoalDelete, prepareCalendarConstraintChange, prepareDurationChange, generateProposals, applySchedulingProposal,
    applyPreparedWithoutScheduling, previewReplan, applyReplan, restoreReplanHistory, recordReview,
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

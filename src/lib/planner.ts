import { differenceInCalendarDays, isAfter, isBefore, parseISO } from 'date-fns'
import type {
  AppState, Assignment, DayTypeSuggestion, LoadChange, ReplanBundle, ReplanConstraintConflict,
  ReplanDisturbance, ReplanLimitOverride, ReplanMove, ReplanRejectedAlternative, ReplanRequest,
  ReplanResult, ReplanStrategy, ReplanMode, TaskActivityType, TaskGroup, PlanChangeEvent, SchedulingProposal,
  ProposalIssue, TaskMovement, DateLoadChange, GoalImpact, AppStatePortable, SchedulingPreference, ConstraintException, ProposalStructuralChange, ReviewDaySnapshot
} from '../types'
import { constraintsForDate, dateRange, getBaseCapacity, getCapacity, getDayConfig, isDateProtected, shiftDate, todayISO } from './date'
import { uid } from './id'
import { isInferredTimeEntry, timeEntryDate } from './execution'
import { cloneActiveState, hydratePortableState, portableState, stableSignature } from './state'
import { goalNamesForAssignment, goalProgress, nearestRelevantGoalDate, nearestRelevantLatestDate, relevantGoalPriority, relevantGoalsForAssignment } from './goals'
import { mergeConstraintExceptions } from './conflicts'
import { dependencyCycleLabels } from './dependencies'

const before = (a: string, b: string) => isBefore(parseISO(a), parseISO(b))
const after = (a: string, b: string) => isAfter(parseISO(a), parseISO(b))
const between = (date: string, start: string, end: string) => !before(date, start) && !after(date, end)
const dayOf = (value?: string) => value ? value.slice(0, 10) : undefined
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function isTodayIncomingConstraint(key?: string) {
  return key === 'today-closed' || key === 'today-extra'
}

function todayIncomingAssignmentIds(exceptions: ConstraintException[] = []) {
  return Array.from(new Set(exceptions
    .filter(item => isTodayIncomingConstraint(item.rawKey ?? item.key))
    .flatMap(item => item.affectedAssignmentIds ?? [])))
}

function groupMap(state: AppState) {
  return new Map(state.taskGroups.map(group => [group.id, group]))
}

interface PlannerIndex {
  groups: Map<string, TaskGroup>
  assignmentsByGroup: Map<string, Assignment[]>
  assignmentsByDate: Map<string, Assignment[]>
}

function plannerIndex(state: AppState): PlannerIndex {
  const groups = groupMap(state)
  const assignmentsByGroup = new Map<string, Assignment[]>()
  const assignmentsByDate = new Map<string, Assignment[]>()
  for (const assignment of state.assignments) {
    assignmentsByGroup.set(assignment.groupId, [...(assignmentsByGroup.get(assignment.groupId) ?? []), assignment])
    if (assignment.scheduledDate) assignmentsByDate.set(assignment.scheduledDate, [...(assignmentsByDate.get(assignment.scheduledDate) ?? []), assignment])
  }
  return { groups, assignmentsByGroup, assignmentsByDate }
}

/** v0.8 当前调度只认 Goal；任务组旧 target/due 字段仅供 v0.7 迁移。 */
function relevantDesiredDate(state: AppState, assignment: Assignment): string | undefined {
  return nearestRelevantGoalDate(state, assignment)
}

function relevantLatestOrPlanEnd(state: AppState, assignment: Assignment): string {
  return nearestRelevantLatestDate(state, assignment) ?? state.settings.endDate
}

export function effectiveMinutes(assignment: Assignment) {
  if (assignment.status === 'done') return 0
  if (typeof assignment.remainingMinutes === 'number' && assignment.remainingMinutes >= 0) {
    return Math.max(1, Math.round(assignment.remainingMinutes))
  }
  return Math.max(1, Math.round(assignment.estimatedMinutes * (1 - clamp01(assignment.progress / 100))))
}

function taskActivity(group: TaskGroup): TaskActivityType {
  if (group.activityType && group.activityType !== 'normal') return group.activityType
  const text = `${group.subject}${group.title}${group.notes ?? ''}`.replaceAll(' ', '')
  if (/默写|听写/.test(text) && group.subject === '语文') return 'classical-dictation'
  if (/背诵|默背/.test(text)) return 'recitation'
  if (/文言文|古文|古诗文/.test(text) && group.subject === '语文') return 'classical-study'
  if (group.subject === '化学' && /预习|微课|预习课/.test(text)) return 'chem-preview'
  if (group.subject === '数学' && /套卷|试卷|周练|真题|模拟卷|测试卷/.test(text)) return 'math-paper'
  return 'normal'
}

function isHighIntensity(group: TaskGroup, assignment: Assignment) {
  if (group.highIntensity) return true
  const text = `${group.title}${assignment.title}`
  return assignment.estimatedMinutes >= 75 && /套卷|试卷|章末|综合|模拟|专题复习|考试/.test(text)
}

function isLongTask(assignment: Assignment, thresholdMinutes = 90) {
  return effectiveMinutes(assignment) >= thresholdMinutes || assignment.estimatedMinutes >= thresholdMinutes
}

interface DayStats {
  actualMinutes: number
  inferredMinutes: number
  plannedMinutes: number
  totalMinutes: number
  taskCount: number
  subjectMinutes: Map<string, number>
  counts: Map<string, number>
  longCount: number
  highIntensityCount: number
  longOrHighCount: number
  incomingTodayMinutes: number
}

function blankStats(): DayStats {
  return {
    actualMinutes: 0,
    inferredMinutes: 0,
    plannedMinutes: 0,
    totalMinutes: 0,
    taskCount: 0,
    subjectMinutes: new Map(),
    counts: new Map(),
    longCount: 0,
    highIntensityCount: 0,
    longOrHighCount: 0,
    incomingTodayMinutes: 0
  }
}

function addCount(day: DayStats, key: string, amount = 1) {
  day.counts.set(key, (day.counts.get(key) ?? 0) + amount)
}

function activityKeys(group: TaskGroup, assignment: Assignment, thresholdMinutes = 90) {
  const keys = [`group:${group.id}`]
  const activity = taskActivity(group)
  if (activity !== 'normal') keys.push(`activity:${activity}`)
  if (isLongTask(assignment, thresholdMinutes)) keys.push('long')
  if (isHighIntensity(group, assignment)) keys.push('high-intensity')
  return keys
}

function defaultLimit(state: AppState, date: string, key: string, group?: TaskGroup) {
  if (key.startsWith('group:')) return group?.dailyMax
  if (key === 'activity:classical-study') return 4
  if (key === 'activity:classical-dictation') return 1
  if (key === 'activity:recitation') return 1
  if (key === 'activity:chem-preview') return 1
  if (key === 'activity:math-paper') return 1
  if (key === 'long') return getDayConfig(state, date).type === 'study' ? state.settings.longTaskMaxPerDay : state.settings.longTaskMaxPerDayLight
  if (key === 'high-intensity') return 2
  return undefined
}

function limitLabel(key: string, group?: TaskGroup) {
  if (key.startsWith('group:')) return `「${group?.title ?? '任务组'}」每日数量`
  const labels: Record<string, string> = {
    'activity:classical-study': '文言文学习次数',
    'activity:classical-dictation': '文言文默写篇数',
    'activity:recitation': '正式背诵次数',
    'activity:chem-preview': '化学预习课节数',
    'activity:math-paper': '数学整套试卷数量',
    long: '长任务数量',
    'high-intensity': '高强度任务数量'
  }
  return labels[key] ?? key
}

function acceptedLimit(state: AppState, date: string, key: string, fallback?: number) {
  const accepted = [...(state.acceptedConstraintExceptions ?? [])].reverse().find(item => item.date === date && (item.rawKey ? item.rawKey === key : item.key === rawConstraintKey(key)))
  return accepted?.overrideLimit ?? fallback
}

function overrideLimit(state: AppState, request: ReplanRequest, date: string, key: string, fallback?: number, assignmentId?: string) {
  // 已接受的例外是一次性的历史记录，不会自动成为以后排期的永久新上限。
  // 本轮覆盖可精确到任务：候选任务不在授权范围内时，不得借用别人接受的例外。
  const matching = (request.limitOverrides ?? []).filter(item => item.date === date && item.key === key)
  const applicable = matching.filter(item => {
    if (!item.affectedAssignmentIds?.length) return true
    if (assignmentId) return item.affectedAssignmentIds.includes(assignmentId)
    // 在扫描现有日期负载时，仅当被授权任务仍实际位于该日期，才保留该例外。
    return item.affectedAssignmentIds.some(id => state.assignments.find(candidate => candidate.id === id)?.scheduledDate === date)
  })
  if (!applicable.length) return fallback
  return Math.max(fallback ?? 0, ...applicable.map(item => item.limit))
}

function currentUseForRawLimit(state: AppState, date: string, key: string) {
  const day = statsMap(state).get(date) ?? blankStats()
  if (key === 'capacity') return day.totalMinutes
  if (key.startsWith('group:') || key.startsWith('activity:')) return day.counts.get(key) ?? 0
  if (key === 'long') return day.longCount
  if (key === 'high-intensity') return day.highIntensityCount
  return 0
}

function baseLimitForRawKey(state: AppState, date: string, key: string) {
  if (key === 'capacity') return getCapacity(state, date)
  if (key.startsWith('group:')) {
    const group = state.taskGroups.find(item => item.id === key.slice('group:'.length))
    return defaultLimit(state, date, key, group)
  }
  return defaultLimit(state, date, key)
}

/**
 * 旧例外只“祖父化”当前已经存在的占用：允许现状继续存在，但不能借旧例外再塞入新任务。
 * 例如曾把某日化学上限一次性放宽到 2，而当前只剩 1 项，则下一次排期仍按 1 校验。
 */
function grandfatheredLimitOverrides(state: AppState): ReplanLimitOverride[] {
  const result = new Map<string, ReplanLimitOverride>()
  for (const item of state.acceptedConstraintExceptions ?? []) {
    if (item.overrideLimit == null) continue
    const key = item.rawKey ?? item.key
    const base = baseLimitForRawKey(state, item.date, key)
    if (base == null) continue
    const limit = Math.max(base, currentUseForRawLimit(state, item.date, key))
    const signature = `${item.date}:${key}`
    const previous = result.get(signature)
    if (!previous || limit > previous.limit) result.set(signature, { date: item.date, key, limit, affectedAssignmentIds: item.affectedAssignmentIds ? [...item.affectedAssignmentIds] : undefined })
  }
  return [...result.values()]
}

function grandfatheredAcceptedExceptions(state: AppState) {
  const now = new Date().toISOString()
  return grandfatheredLimitOverrides(state).map(item => ({
    id: uid('grandfathered-exception'), eventId: 'grandfathered-current-state', accepted: true as const, createdAt: now,
    date: item.date, key: rawConstraintKey(item.key), rawKey: item.key, label: '仅保留当前既有占用，不授权新增使用', permanent: false as const,
    currentLimit: baseLimitForRawKey(state, item.date, item.key), overrideLimit: item.limit,
  }))
}

function rawConstraintKey(key: string): import('../types').ConstraintKey {
  if (key === 'capacity') return 'capacity'
  if (key.startsWith('group:')) return 'group-daily-max'
  if (key.startsWith('activity:')) return 'activity-daily-max'
  if (key === 'long') return 'long-task-max'
  if (key === 'high-intensity') return 'high-intensity-max'
  if (key === 'date-protection' || key === 'protected-buffer') return 'date-protection'
  if (key === 'goal-latest') return 'goal-latest'
  if (key === 'past') return 'past-freeze'
  return 'capacity'
}

function assignmentActualBreakdown(state: AppState) {
  const actualByDate = new Map<string, number>()
  const inferredByDate = new Map<string, number>()
  const assignmentDates = new Map<string, string>()
  const groups = groupMap(state)

  for (const assignment of state.assignments) {
    let entryTotal = 0
    let inferredEntryTotal = 0
    for (const entry of assignment.timeEntries ?? []) {
      const date = timeEntryDate(entry)
      if (!date) continue
      if (isInferredTimeEntry(entry)) {
        inferredEntryTotal += entry.minutes
        inferredByDate.set(date, (inferredByDate.get(date) ?? 0) + entry.minutes)
      } else {
        entryTotal += entry.minutes
        actualByDate.set(date, (actualByDate.get(date) ?? 0) + entry.minutes)
      }
      assignmentDates.set(assignment.id, date)
    }
    const residual = Math.max(0, assignment.actualMinutes - entryTotal)
    const fallbackDate = dayOf(assignment.completedAt) ?? assignment.scheduledDate
    if (residual > 0 && fallbackDate) {
      actualByDate.set(fallbackDate, (actualByDate.get(fallbackDate) ?? 0) + residual)
      assignmentDates.set(assignment.id, fallbackDate)
    }
    if (assignment.status === 'done' && assignment.actualMinutes <= 0 && entryTotal <= 0 && inferredEntryTotal <= 0) {
      const date = dayOf(assignment.completedAt) ?? assignment.scheduledDate
      const group = groups.get(assignment.groupId)
      if (date && group) {
        const inferred = Math.max(1, assignment.estimatedMinutes)
        inferredByDate.set(date, (inferredByDate.get(date) ?? 0) + inferred)
        assignmentDates.set(assignment.id, date)
      }
    }
  }

  if (state.timer.assignmentId) {
    let seconds = state.timer.accumulatedSeconds
    if (state.timer.running && state.timer.startedAt) seconds += Math.max(0, Math.floor((Date.now() - state.timer.startedAt) / 1000))
    if (seconds > 0) {
      const minutes = Math.max(1, Math.round(seconds / 60))
      const date = todayISO()
      actualByDate.set(date, (actualByDate.get(date) ?? 0) + minutes)
      assignmentDates.set(state.timer.assignmentId, date)
    }
  }

  return { actualByDate, inferredByDate, assignmentDates }
}

/**
 * 返回某项任务在指定自然日真实记录的分钟数。
 * 任务后来被顺延到其他日期时，历史计时仍归属于真实发生日；运行中的计时只计入今天。
 */
export function actualMinutesForAssignmentOnDate(state: AppState, assignment: Assignment, date: string): number {
  let minutes = 0
  let recordedTotal = 0
  for (const entry of assignment.timeEntries ?? []) {
    if (isInferredTimeEntry(entry)) continue
    recordedTotal += Math.max(0, entry.minutes)
    if (timeEntryDate(entry) === date) minutes += Math.max(0, entry.minutes)
  }
  const residual = Math.max(0, assignment.actualMinutes - recordedTotal)
  const fallbackDate = dayOf(assignment.completedAt) ?? assignment.scheduledDate
  if (residual > 0 && fallbackDate === date) minutes += residual
  if (state.timer.assignmentId === assignment.id && date === todayISO()) {
    let seconds = state.timer.accumulatedSeconds
    if (state.timer.running && state.timer.startedAt) seconds += Math.max(0, Math.floor((Date.now() - state.timer.startedAt) / 1000))
    if (seconds > 0) minutes += Math.max(1, Math.round(seconds / 60))
  }
  return Math.max(0, Math.round(minutes))
}

function statsMap(state: AppState, excluded = new Set<string>()) {
  const groups = groupMap(state)
  const map = new Map<string, DayStats>()
  const actual = assignmentActualBreakdown(state)
  const longThreshold = state.settings.longTaskThresholdMinutes

  for (const [date, minutes] of actual.actualByDate) {
    const day = map.get(date) ?? blankStats()
    day.actualMinutes += minutes
    day.totalMinutes += minutes
    map.set(date, day)
  }
  for (const [date, minutes] of actual.inferredByDate) {
    const day = map.get(date) ?? blankStats()
    day.inferredMinutes += minutes
    day.totalMinutes += minutes
    map.set(date, day)
  }

  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group) continue
    if (assignment.status === 'done') {
      const date = dayOf(assignment.completedAt) ?? actual.assignmentDates.get(assignment.id) ?? assignment.scheduledDate
      if (!date) continue
      const day = map.get(date) ?? blankStats()
      day.taskCount += group.recurring ? 0 : 1
      for (const key of activityKeys(group, assignment, longThreshold)) addCount(day, key)
      if (isLongTask(assignment, longThreshold)) day.longCount += 1
      if (isHighIntensity(group, assignment)) day.highIntensityCount += 1
      if (isLongTask(assignment, longThreshold) || isHighIntensity(group, assignment)) day.longOrHighCount += 1
      const minutes = assignment.actualMinutes > 0 ? assignment.actualMinutes : assignment.estimatedMinutes
      day.subjectMinutes.set(group.subject, (day.subjectMinutes.get(group.subject) ?? 0) + minutes)
      map.set(date, day)
      continue
    }
    if (!assignment.scheduledDate || excluded.has(assignment.id)) continue
    const day = map.get(assignment.scheduledDate) ?? blankStats()
    const minutes = effectiveMinutes(assignment)
    day.plannedMinutes += minutes
    day.totalMinutes += minutes
    day.taskCount += group.recurring ? 0 : 1
    day.subjectMinutes.set(group.subject, (day.subjectMinutes.get(group.subject) ?? 0) + minutes)
    for (const key of activityKeys(group, assignment, longThreshold)) addCount(day, key)
    if (isLongTask(assignment, longThreshold)) day.longCount += 1
    if (isHighIntensity(group, assignment)) day.highIntensityCount += 1
    if (isLongTask(assignment, longThreshold) || isHighIntensity(group, assignment)) day.longOrHighCount += 1
    map.set(assignment.scheduledDate, day)
  }
  return map
}

function addToStats(stats: Map<string, DayStats>, date: string, assignment: Assignment, group: TaskGroup, originalDate?: string, thresholdMinutes = 90) {
  const day = stats.get(date) ?? blankStats()
  const minutes = effectiveMinutes(assignment)
  day.plannedMinutes += minutes
  day.totalMinutes += minutes
  day.taskCount += group.recurring ? 0 : 1
  day.subjectMinutes.set(group.subject, (day.subjectMinutes.get(group.subject) ?? 0) + minutes)
  for (const key of activityKeys(group, assignment, thresholdMinutes)) addCount(day, key)
  if (isLongTask(assignment, thresholdMinutes)) day.longCount += 1
  if (isHighIntensity(group, assignment)) day.highIntensityCount += 1
  if (isLongTask(assignment, thresholdMinutes) || isHighIntensity(group, assignment)) day.longOrHighCount += 1
  if (date === todayISO() && originalDate !== date) day.incomingTodayMinutes += minutes
  stats.set(date, day)
}

function removeFromStats(stats: Map<string, DayStats>, date: string, assignment: Assignment, group: TaskGroup, originalDate?: string, thresholdMinutes = 90) {
  const current = stats.get(date)
  if (!current) return
  const day: DayStats = { ...current, subjectMinutes: new Map(current.subjectMinutes), counts: new Map(current.counts) }
  const minutes = effectiveMinutes(assignment)
  day.plannedMinutes = Math.max(0, day.plannedMinutes - minutes)
  day.totalMinutes = Math.max(0, day.totalMinutes - minutes)
  day.taskCount = Math.max(0, day.taskCount - (group.recurring ? 0 : 1))
  day.subjectMinutes.set(group.subject, Math.max(0, (day.subjectMinutes.get(group.subject) ?? 0) - minutes))
  for (const key of activityKeys(group, assignment, thresholdMinutes)) day.counts.set(key, Math.max(0, (day.counts.get(key) ?? 0) - 1))
  if (isLongTask(assignment, thresholdMinutes)) day.longCount = Math.max(0, day.longCount - 1)
  if (isHighIntensity(group, assignment)) day.highIntensityCount = Math.max(0, day.highIntensityCount - 1)
  if (isLongTask(assignment, thresholdMinutes) || isHighIntensity(group, assignment)) day.longOrHighCount = Math.max(0, day.longOrHighCount - 1)
  if (date === todayISO() && originalDate !== date) day.incomingTodayMinutes = Math.max(0, day.incomingTodayMinutes - minutes)
  stats.set(date, day)
}

function statsWithoutAssignment(base: Map<string, DayStats>, assignment: Assignment, group: TaskGroup, originalDate?: string, thresholdMinutes = 90) {
  const result = new Map(base)
  if (assignment.scheduledDate && assignment.status !== 'done') removeFromStats(result, assignment.scheduledDate, assignment, group, originalDate, thresholdMinutes)
  return result
}

function loadConstraintForDate(request: ReplanRequest, date: string) {
  const constraints = request.loadConstraints
  if (!constraints || date < constraints.startDate || date > constraints.endDate) return undefined
  return constraints
}

function hardCapacity(state: AppState, date: string, request: ReplanRequest, day?: DayStats, assignmentId?: string) {
  const configured = overrideLimit(state, request, date, 'capacity', getCapacity(state, date), assignmentId) ?? getCapacity(state, date)
  const loadConstraint = loadConstraintForDate(request, date)
  const base = loadConstraint?.maxMinutesPerDay != null ? Math.min(configured, Math.max(0, Math.round(loadConstraint.maxMinutesPerDay))) : configured
  if (date !== todayISO()) return base
  const actual = (day?.actualMinutes ?? 0) + (day?.inferredMinutes ?? 0)
  return Math.max(base, actual + Math.max(0, request.todayExtraMinutes ?? 0))
}

function targetUtilization(state: AppState, date: string, strategy: ReplanStrategy) {
  const config = getDayConfig(state, date)
  if (config.isBufferDay) return state.settings.bufferUtilization
  if (strategy === 'goal') return 1
  if (strategy === 'rest') return 0.78
  if (strategy === 'preserve') return Math.max(state.settings.targetUtilization, 0.9)
  return state.settings.targetUtilization
}

function protectedDateAllowed(request: ReplanRequest, date: string, assignmentId: string) {
  const scoped = request.allowProtectedDateAssignments?.filter(item => item.date === date) ?? []
  if (scoped.length) return scoped.some(item => item.assignmentIds.includes(assignmentId))
  return request.allowBufferUseDates?.includes(date) ?? false
}

function todayIncomingAllowed(request: ReplanRequest, date: string, assignmentId: string) {
  return date === todayISO() && (request.allowTodayIncomingAssignments ?? []).includes(assignmentId)
}

interface PlacementViolation {
  key: string
  label: string
  current: number
  limit: number
  hard: boolean
}

function prerequisiteDepth(groupId: string, groups: Map<string, TaskGroup>, memo: Map<string, number>, visiting = new Set<string>()): number {
  const cached = memo.get(groupId)
  if (cached !== undefined) return cached
  if (visiting.has(groupId)) return 10_000
  visiting.add(groupId)
  const group = groups.get(groupId)
  const depth = group?.prerequisiteGroupIds?.length
    ? 1 + Math.max(...group.prerequisiteGroupIds.map(id => prerequisiteDepth(id, groups, memo, new Set(visiting))))
    : 0
  memo.set(groupId, depth)
  return depth
}

function validatePlacement(
  state: AppState,
  stats: Map<string, DayStats>,
  assignment: Assignment,
  group: TaskGroup,
  date: string,
  request: ReplanRequest,
  originalDate?: string,
  index = plannerIndex(state)
) {
  const violations: PlacementViolation[] = []
  const day = stats.get(date) ?? blankStats()
  const config = getDayConfig(state, date)
  const minutes = effectiveMinutes(assignment)

  if (!between(date, state.settings.startDate, state.settings.endDate)) {
    violations.push({ key: 'plan-range', label: '不在计划日期范围内', current: 1, limit: 0, hard: true })
    return violations
  }
  if (before(date, todayISO())) violations.push({ key: 'past', label: '过去日期已冻结', current: 1, limit: 0, hard: true })
  const goalLatest = nearestRelevantLatestDate(state, assignment)
  if (goalLatest && after(date, goalLatest)) violations.push({ key: 'goal-latest', label: `超过相关目标最晚日期 ${goalLatest}`, current: 1, limit: 0, hard: true })
  for (const prerequisiteId of group.prerequisiteGroupIds ?? []) {
    const prerequisiteGroup = index.groups.get(prerequisiteId)
    const prerequisiteTasks = index.assignmentsByGroup.get(prerequisiteId) ?? []
    const prerequisiteDates = prerequisiteTasks.map(item => item.status === 'done' && item.completedAt ? item.completedAt.slice(0, 10) : item.scheduledDate)
    if (!prerequisiteGroup || !prerequisiteTasks.length || prerequisiteDates.some(value => !value)) {
      violations.push({ key: `prerequisite:${prerequisiteId}`, label: `前置任务组“${prerequisiteGroup?.title ?? '已删除任务组'}”尚未完整安排`, current: 1, limit: 0, hard: true })
      continue
    }
    const latestPrerequisiteDate = prerequisiteDates.filter((value): value is string => Boolean(value)).sort().at(-1)!
    if (!after(date, latestPrerequisiteDate)) {
      violations.push({ key: `prerequisite:${prerequisiteId}`, label: `必须晚于前置任务组“${prerequisiteGroup.title}”（${latestPrerequisiteDate}）`, current: 1, limit: 0, hard: true })
    }
  }
  if (config.type === 'travel' && originalDate !== date) violations.push({ key: 'travel-day', label: '外出日不接收普通任务', current: 1, limit: 0, hard: true })
  if (isDateProtected(state, date) && originalDate !== date && !protectedDateAllowed(request, date, assignment.id)) {
    violations.push({ key: 'date-protection', label: '日期受到保护', current: 1, limit: 0, hard: true })
  }

  const manualBufferProtected = Boolean(config.isBufferDay && (config.bufferProtected ?? config.userSet))
  if (manualBufferProtected && originalDate !== date && !protectedDateAllowed(request, date, assignment.id)) {
    violations.push({ key: 'protected-buffer', label: '用户设置的缓冲日受到保护', current: 1, limit: 0, hard: true })
  }
  if (config.isBufferDay && isHighIntensity(group, assignment)) {
    violations.push({ key: 'buffer-high-intensity', label: '缓冲日不安排高强度任务', current: day.highIntensityCount + 1, limit: 0, hard: true })
  }
  if (config.isBufferDay && isLongTask(assignment, state.settings.longTaskThresholdMinutes)) {
    violations.push({ key: 'buffer-long-task', label: '缓冲日只保留轻量任务，不安排长任务', current: day.longCount + 1, limit: 0, hard: true })
  }

  if (date === todayISO() && originalDate !== date && !todayIncomingAllowed(request, date, assignment.id)) {
    const extra = Math.max(0, request.todayExtraMinutes ?? 0)
    const incoming = day.incomingTodayMinutes + minutes
    if (extra <= 0) violations.push({ key: 'today-closed', label: '今天默认不接收未来任务', current: incoming, limit: 0, hard: true })
    else if (incoming > extra) {
      violations.push({ key: 'today-extra', label: '超过你填写的今日额外可用时间', current: incoming, limit: extra, hard: true })
    }
  }

  const projected = day.totalMinutes + minutes
  const capacity = hardCapacity(state, date, request, day, assignment.id)
  if (projected > capacity) violations.push({ key: 'capacity', label: '超过当天硬容量', current: projected, limit: capacity, hard: true })

  const loadConstraint = loadConstraintForDate(request, date)
  if (loadConstraint?.maxLongHighPerDay != null) {
    const projectedLongHigh = day.longOrHighCount + (isLongTask(assignment, state.settings.longTaskThresholdMinutes) || isHighIntensity(group, assignment) ? 1 : 0)
    if (projectedLongHigh > loadConstraint.maxLongHighPerDay) {
      violations.push({ key: 'load-long-high-max', label: '超过本次减负设置的长任务／高强度任务上限', current: projectedLongHigh, limit: loadConstraint.maxLongHighPerDay, hard: true })
    }
  }
  if (loadConstraint?.maxHighLoadStreak != null) {
    const highThreshold = state.settings.highLoadThreshold
    const projectedRatio = capacity > 0 ? projected / capacity : 1
    let streak = projectedRatio >= highThreshold ? 1 : 0
    for (let offset = 1; streak > 0 && offset <= 31; offset += 1) {
      const previousDate = shiftDate(date, -offset)
      if (previousDate < loadConstraint.startDate) break
      const previous = stats.get(previousDate)
      const previousCapacity = hardCapacity(state, previousDate, request, previous)
      if (!previous || previousCapacity <= 0 || previous.totalMinutes / previousCapacity < highThreshold) break
      streak += 1
    }
    if (streak > loadConstraint.maxHighLoadStreak) {
      violations.push({ key: 'load-high-streak', label: '会超过本次设置的连续高负载天数', current: streak, limit: loadConstraint.maxHighLoadStreak, hard: true })
    }
  }

  for (const key of activityKeys(group, assignment)) {
    const fallback = defaultLimit(state, date, key, group)
    if (fallback === undefined) continue
    const limit = overrideLimit(state, request, date, key, fallback, assignment.id) ?? fallback
    const current = (day.counts.get(key) ?? 0) + 1
    if (current > limit) violations.push({ key, label: limitLabel(key, group), current, limit, hard: true })
  }
  return violations
}

function daysFrom(start: string, date: string) {
  return Math.max(0, differenceInCalendarDays(parseISO(date), parseISO(start)))
}

function baselineMaps(state: AppState) {
  const stats = statsMap(state)
  return {
    load: new Map([...stats.entries()].map(([date, day]) => [date, day.totalMinutes])),
    count: new Map([...stats.entries()].map(([date, day]) => [date, day.taskCount]))
  }
}

function candidateScore(
  state: AppState,
  stats: Map<string, DayStats>,
  assignment: Assignment,
  group: TaskGroup,
  date: string,
  strategy: ReplanStrategy,
  originalDate: string | undefined,
  baseline: ReturnType<typeof baselineMaps>,
  preferredShift?: number,
  request: ReplanRequest = { mode: 'repair', fromDate: todayISO() }
) {
  const day = stats.get(date) ?? blankStats()
  const minutes = effectiveMinutes(assignment)
  const projected = day.totalMinutes + minutes
  const capacity = Math.max(1, hardCapacity(state, date, request, day))
  const ratio = projected / capacity
  const distance = originalDate ? Math.abs(differenceInCalendarDays(parseISO(date), parseISO(originalDate))) : daysFrom(state.settings.startDate, date)
  const moveWeight = strategy === 'preserve' ? 240 : strategy === 'rest' ? 150 : strategy === 'balanced' ? 85 : 35
  let score = distance * moveWeight

  if (originalDate && date !== originalDate) score += moveWeight * 2
  if (originalDate && getDayConfig(state, originalDate).isBufferDay && before(date, originalDate)) score += strategy === 'preserve' ? 14000 : 6000
  if (originalDate && preferredShift !== undefined) {
    const shift = differenceInCalendarDays(parseISO(date), parseISO(originalDate))
    score += Math.abs(shift - preferredShift) * (strategy === 'preserve' ? 1200 : 500)
  }
  if (assignment.intentStrength === 'manual') score += date === originalDate ? -25000 : 18000
  if (assignment.status === 'partial') score += date === originalDate ? -15000 : 8000
  const relevantGoalDate = relevantDesiredDate(state, assignment)
  const effectivePriority = Math.max(group.priority, relevantGoalPriority(state, assignment))
  if (relevantGoalDate && after(date, relevantGoalDate)) score += (effectivePriority === 5 ? 36000 : 8000) + daysFrom(relevantGoalDate, date) * (effectivePriority === 5 ? 4500 : 1000)

  const target = targetUtilization(state, date, strategy)
  if (ratio > target) score += Math.pow(ratio - target, 2) * (strategy === 'goal' ? 3500 : 18000)
  else score += Math.pow(ratio, 2) * (strategy === 'balanced' ? 900 : 400)

  const projectedCount = day.taskCount + (group.recurring ? 0 : 1)
  const maxTasks = getDayConfig(state, date).type === 'study' ? state.settings.studyMaxTasks : state.settings.regularMaxTasks
  if (projectedCount > maxTasks) score += (projectedCount - maxTasks) * 4000

  const subjectMinutes = (day.subjectMinutes.get(group.subject) ?? 0) + minutes
  if (projected > 90 && subjectMinutes / projected > state.settings.subjectShareLimit) score += 5000

  const originalLoad = baseline.load.get(date) ?? 0
  const originalCount = baseline.count.get(date) ?? 0
  const addedCount = projectedCount - originalCount
  const addedLoad = projected - originalLoad
  if (addedCount > state.settings.maxNewTasksPerDay) score += (addedCount - state.settings.maxNewTasksPerDay) * (strategy === 'preserve' ? 9000 : 3500)
  if (addedLoad > getBaseCapacity(state, date) * state.settings.maxLoadChangeRatio) {
    score += (addedLoad - getBaseCapacity(state, date) * state.settings.maxLoadChangeRatio) * (strategy === 'preserve' ? 90 : 35)
  }

  const precedingHigh = Array.from({ length: Math.max(1, state.settings.highLoadStreak - 1) }, (_, index) => shiftDate(date, -(index + 1)))
    .every(previousDate => {
      const previous = stats.get(previousDate)
      const cap = hardCapacity(state, previousDate, request, previous)
      return Boolean(previous && cap > 0 && previous.totalMinutes / cap >= state.settings.highLoadThreshold)
    })
  if (precedingHigh && ratio >= state.settings.highLoadThreshold) score += strategy === 'goal' ? 1800 : 10000
  if (getDayConfig(state, date).isBufferDay) score += strategy === 'rest' ? -200 : 5000

  const earlyWeight = strategy === 'goal' ? 120 : strategy === 'balanced' ? 40 : 10
  if (effectivePriority === 5) score += daysFrom(state.settings.startDate, date) * earlyWeight
  return score
}

function planningStart(request: ReplanRequest) {
  const today = todayISO()
  const requested = request.fromDate || today
  if (request.mode === 'full' && !after(requested, today) && !request.includeToday && !(request.todayExtraMinutes && request.todayExtraMinutes > 0)) return shiftDate(today, 1)
  return before(requested, today) ? today : requested
}

function frozenDates(request: ReplanRequest) {
  const start = planningStart(request)
  const count = Math.max(0, request.freezeDays ?? 0)
  return new Set(count ? dateRange(start, shiftDate(start, count - 1)) : [])
}

function fixedAssignmentIds(request: ReplanRequest) {
  const raw = request.event?.metadata?.fixedAssignmentIds
  return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [])
}

function movableRank(state: AppState, assignments: Assignment[]) {
  const groups = groupMap(state)
  return [...assignments].sort((a, b) => {
    const ga = groups.get(a.groupId)!
    const gb = groups.get(b.groupId)!
    if (a.intentStrength !== b.intentStrength) return a.intentStrength === 'manual' ? 1 : b.intentStrength === 'manual' ? -1 : 0
    if (a.status !== b.status) return a.status === 'partial' ? 1 : b.status === 'partial' ? -1 : 0
    const deadlineA = relevantDesiredDate(state, a) ?? state.settings.endDate
    const deadlineB = relevantDesiredDate(state, b) ?? state.settings.endDate
    if (deadlineA !== deadlineB) return deadlineB.localeCompare(deadlineA)
    const priorityA = Math.max(ga.priority, relevantGoalPriority(state, a))
    const priorityB = Math.max(gb.priority, relevantGoalPriority(state, b))
    if (priorityA !== priorityB) return priorityA - priorityB
    return effectiveMinutes(b) - effectiveMinutes(a)
  })
}

function identifyRepairCandidates(state: AppState, request: ReplanRequest) {
  const index = plannerIndex(state)
  const groups = index.groups
  const candidateIds = new Set<string>()
  const softManualIds = new Set<string>()
  const hardRequired = new Set<string>()
  const fixedIds = fixedAssignmentIds(request)
  const issues: string[] = []
  const start = before(request.fromDate, todayISO()) ? todayISO() : request.fromDate
  const stats = statsMap(state)
  const cycles = dependencyCycleLabels(state.taskGroups)
  cycles.forEach(cycle => issues.push(`检测到循环依赖：${cycle}。相关任务必须先修改依赖关系，系统不会猜测顺序。`))

  const mark = (assignment: Assignment, hard: boolean, message?: string) => {
    if (fixedIds.has(assignment.id) || assignment.locked || assignment.status === 'done' || state.timer.assignmentId === assignment.id) return
    if (assignment.intentStrength === 'manual') softManualIds.add(assignment.id)
    else candidateIds.add(assignment.id)
    if (hard) hardRequired.add(assignment.id)
    if (message) issues.push(message)
  }

  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group || group.recurring || assignment.status === 'done' || assignment.locked || state.timer.assignmentId === assignment.id) continue
    if (!assignment.scheduledDate) {
      mark(assignment, true, `${group.subject}「${assignment.title}」尚未安排。`)
      continue
    }
    if (before(assignment.scheduledDate, todayISO())) {
      mark(assignment, true, `${group.subject}「${assignment.title}」仍停留在过去日期，需要进入今日待处理。`)
      continue
    }
    if (before(assignment.scheduledDate, start)) continue
    const config = getDayConfig(state, assignment.scheduledDate)
    if (config.type === 'travel') mark(assignment, true, `${assignment.scheduledDate} 是旅游日，普通任务需要移出。`)
    const goalLatest = nearestRelevantLatestDate(state, assignment)
    if (goalLatest && after(assignment.scheduledDate, goalLatest)) mark(assignment, true, `${group.subject}「${assignment.title}」已经越过相关目标最晚日期 ${goalLatest}。`)
  }

  for (const date of dateRange(start, state.settings.endDate)) {
    const day = stats.get(date) ?? blankStats()
    const config = getDayConfig(state, date)
    const unfinished = (index.assignmentsByDate.get(date) ?? []).filter(item => item.status !== 'done' && !groups.get(item.groupId)?.recurring)
    const sourceProtected = isDateProtected(state, date)
    const availabilityEventAllowsEvacuation = request.event?.type === 'availability-change' && request.event.affectedDates.some(item => item === date)
    // 创建或修改日期约束本身就是用户对该日期的新明确意图。无论是完全不可用、
    // 降低容量还是设置缓冲日，都必须允许把原有普通任务移出该日期；其他事件仍
    // 不得静默破坏日期保护。
    const allowMoveOut = !sourceProtected || availabilityEventAllowsEvacuation
    const movable = movableRank(state, unfinished.filter(item => !item.locked && state.timer.assignmentId !== item.id && allowMoveOut))

    if (config.isBufferDay) {
      for (const item of unfinished) {
        const itemGroup = groups.get(item.groupId)
        if (!itemGroup) continue
        if (isHighIntensity(itemGroup, item) || isLongTask(item, state.settings.longTaskThresholdMinutes)) {
          mark(item, true, `${date} 是轻量缓冲日，“${item.title}”属于${isHighIntensity(itemGroup, item) ? '高强度' : '长时'}任务，需要移出或由用户明确取消缓冲保护。`)
        }
      }
    }

    const limitKeys = new Set<string>()
    for (const item of unfinished) {
      const group = groups.get(item.groupId)
      if (!group) continue
      for (const key of activityKeys(group, item, state.settings.longTaskThresholdMinutes)) limitKeys.add(key)
    }
    for (const key of limitKeys) {
      const sample = unfinished.find(item => {
        const group = groups.get(item.groupId)
        return Boolean(group && activityKeys(group, item, state.settings.longTaskThresholdMinutes).includes(key))
      })
      const group = sample ? groups.get(sample.groupId) : undefined
      const fallback = defaultLimit(state, date, key, group)
      if (fallback === undefined) continue
      const limit = overrideLimit(state, request, date, key, fallback) ?? fallback
      const count = day.counts.get(key) ?? 0
      if (count <= limit) continue
      let need = count - limit
      const choices = movable.filter(item => {
        const g = groups.get(item.groupId)
        return Boolean(g && activityKeys(g, item).includes(key))
      })
      for (const item of choices) {
        if (need <= 0) break
        mark(item, true)
        need -= 1
      }
      issues.push(`${date} 的${limitLabel(key, group)}为 ${count}，超过上限 ${limit}。`)
    }

    const capacity = hardCapacity(state, date, request, day)
    let projected = day.totalMinutes
    let count = day.taskCount
    const maxCount = config.type === 'study' ? state.settings.studyMaxTasks : state.settings.regularMaxTasks
    const shouldReduce = projected > capacity || count > maxCount || (config.isBufferDay && projected > capacity)
    if (shouldReduce) {
      for (const item of movable) {
        if (projected <= capacity && count <= maxCount) break
        const group = groups.get(item.groupId)
        if (!group || candidateIds.has(item.id) || softManualIds.has(item.id)) continue
        mark(item, projected > capacity)
        projected -= effectiveMinutes(item)
        count -= 1
      }
      if (day.totalMinutes > capacity) issues.push(`${date} 的真实执行与剩余任务合计 ${Math.round(day.totalMinutes)} 分钟，超过可用容量 ${capacity} 分钟。`)
      if (day.taskCount > maxCount) issues.push(`${date} 共 ${day.taskCount} 项活动，超过建议上限 ${maxCount} 项。`)
    }

    if (date === todayISO()) {
      const actual = day.actualMinutes + day.inferredMinutes
      if (actual >= getCapacity(state, date) && unfinished.length) {
        issues.push(`今天已学习约 ${Math.round(actual)} 分钟，系统不会再把未来任务移入今天，并会逐项建议处理今日剩余任务。`)
      }
    }
  }

  return { candidateIds, softManualIds, hardRequired, issues }
}

function applyAutomaticBufferDays(state: AppState, request: ReplanRequest) {
  const start = planningStart(request)
  const end = state.settings.endDate
  const dates = dateRange(start, end)
  const groups = groupMap(state)
  const remainingWork = state.assignments
    .filter(item => item.status !== 'done' && !groups.get(item.groupId)?.recurring)
    .reduce((sum, item) => sum + effectiveMinutes(item), 0)
  let targetSlack = dates.reduce((sum, date) => sum + getCapacity(state, date) * state.settings.targetUtilization, 0) - remainingWork
  const minimumSafetySlack = Math.max(30, Math.round(state.settings.regularMinutes * 0.15))
  const baseline = statsMap(state)
  const manuallyProtectedDates = new Set(state.assignments.filter(item => item.scheduledDate && !groups.get(item.groupId)?.recurring && (item.locked || item.intentStrength === 'manual')).map(item => item.scheduledDate!))
  const requestedLightDays = request.loadConstraints?.lightDaysPerWeek == null
    ? 1
    : Math.max(0, Math.min(7, Math.round(request.loadConstraints.lightDaysPerWeek)))

  for (let offset = 0; offset < dates.length; offset += 7) {
    const block = dates.slice(offset, offset + 7)
    if (block.some(date => getDayConfig(state, date).isBufferDay || getDayConfig(state, date).type === 'travel')) continue
    const candidates = block.filter(date => {
      const config = getDayConfig(state, date)
      if (config.userSet || config.type === 'travel') return false
      return !manuallyProtectedDates.has(date)
    })
    if (!candidates.length || requestedLightDays <= 0) continue
    const ordered = candidates.sort((a, b) => (baseline.get(a)?.totalMinutes ?? 0) - (baseline.get(b)?.totalMinutes ?? 0) || b.localeCompare(a))
    let selectedCount = 0
    for (const selected of ordered) {
      if (selectedCount >= requestedLightDays) break
      const originalCapacity = getCapacity(state, selected)
      const base = getBaseCapacity(state, selected)
      const bufferCapacity = Math.round(base * state.settings.bufferUtilization)
      const targetCapacityReduction = Math.max(0, originalCapacity - bufferCapacity) * state.settings.targetUtilization

      // 休息方案不能为了“凑出缓冲日”而把其余日期重新压满，甚至制造无处可排的任务。
      // 只有剩余工作量在目标利用率下仍留有安全余量时，才自动新增这一周的缓冲日。
      if (targetSlack - targetCapacityReduction < minimumSafetySlack) continue

      state.dayConfigs[selected] = {
        ...(state.dayConfigs[selected] ?? { date: selected, type: 'regular' as const }),
        date: selected,
        isBufferDay: true,
        availableMinutes: bufferCapacity,
        bufferReason: '系统按本次减负条件预留轻量日',
        bufferPreference: 'preserve',
        bufferProtected: false,
        userSet: false
      }
      targetSlack -= targetCapacityReduction
      selectedCount += 1
    }
  }
}

function supportCandidateIds(state: AppState, request: ReplanRequest, alreadySelected: Set<string>) {
  if (request.mode !== 'repair' || !request.event) return new Set<string>()
  const supportedEvents: PlanChangeEvent['type'][] = [
    'new-task-insertion', 'task-group-size-increase', 'goal-tightening', 'availability-change',
    'execution-difference', 'rule-change', 'bulk-move',
  ]
  if (!supportedEvents.includes(request.event.type)) return new Set<string>()

  const groups = groupMap(state)
  const frozen = frozenDates(request)
  const fixedIds = fixedAssignmentIds(request)
  const radius = Math.max(1, request.localRadius ?? state.settings.localRepairRadius)
  const anchors = new Set<string>(request.event.affectedDates)
  for (const id of request.event.affectedAssignmentIds) {
    const item = state.assignments.find(candidate => candidate.id === id)
    if (item?.scheduledDate) anchors.add(item.scheduledDate)
    const goalDate = item ? relevantDesiredDate(state, item) : undefined
    if (goalDate) anchors.add(goalDate)
  }
  if (!anchors.size) anchors.add(planningStart(request))
  const affectedGroups = new Set(request.event.affectedGroupIds)
  const affectedGoals = new Set(request.event.affectedGoalIds)
  const candidates = state.assignments.filter(item => {
    const group = groups.get(item.groupId)
    if (!group || group.recurring || !item.scheduledDate || alreadySelected.has(item.id) || fixedIds.has(item.id)) return false
    if (item.status !== 'todo' || item.progress > 0 || item.actualMinutes > 0) return false
    if (item.locked || item.intentStrength === 'manual' || state.timer.assignmentId === item.id) return false
    if (before(item.scheduledDate, planningStart(request)) || frozen.has(item.scheduledDate)) return false
    if (isDateProtected(state, item.scheduledDate)) return false
    const nearAnchor = [...anchors].some(anchor => Math.abs(differenceInCalendarDays(parseISO(item.scheduledDate!), parseISO(anchor))) <= radius)
    const sameGroup = affectedGroups.has(item.groupId)
    const sameGoal = affectedGoals.size > 0 && relevantGoalsForAssignment(state, item).some(goal => affectedGoals.has(goal.id))
    return nearAnchor || sameGroup || sameGoal
  })

  // 扩大候选范围时增加可被挪动的自动任务，但始终设置上限，避免小事件直接退化为整盘重排。
  const limit = request.strategy === 'preserve' ? Math.max(8, radius * 4) : Math.max(16, radius * 8)
  return new Set(movableRank(state, candidates).slice(0, limit).map(item => item.id))
}

function assignmentCandidates(state: AppState, request: ReplanRequest, repair: ReturnType<typeof identifyRepairCandidates>) {
  const groups = groupMap(state)
  const frozen = frozenDates(request)
  const fixedIds = fixedAssignmentIds(request)
  const start = planningStart(request)
  const ids = new Set<string>()
  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group || group.recurring || fixedIds.has(assignment.id) || assignment.status === 'done' || assignment.locked || state.timer.assignmentId === assignment.id) continue
    const date = assignment.scheduledDate
    if (request.affectedAssignmentIds?.includes(assignment.id)) {
      ids.add(assignment.id)
      continue
    }
    if (request.mode === 'repair') {
      if (repair.candidateIds.has(assignment.id)) ids.add(assignment.id)
      if (request.strategy !== 'preserve' && repair.softManualIds.has(assignment.id)) ids.add(assignment.id)
      continue
    }

    if (repair.hardRequired.has(assignment.id)) {
      ids.add(assignment.id)
      continue
    }
    if (request.strategy === 'preserve') {
      if (repair.candidateIds.has(assignment.id) || !date) ids.add(assignment.id)
      continue
    }
    if (assignment.status === 'partial' && date && !before(date, todayISO())) continue
    if (assignment.intentStrength === 'manual') continue
    if (!date) {
      ids.add(assignment.id)
      continue
    }
    if (date === todayISO()) {
      if (repair.candidateIds.has(assignment.id)) ids.add(assignment.id)
      continue
    }
    const sourceDateExplicitlyChanged = request.event?.type === 'availability-change' && request.event.affectedDates.includes(date)
    if (isDateProtected(state, date) && !sourceDateExplicitlyChanged) continue
    if (before(date, start)) continue
    if (frozen.has(date)) continue
    ids.add(assignment.id)
  }
  for (const id of supportCandidateIds(state, request, ids)) ids.add(id)
  return ids
}

function possibleDateRange(state: AppState, request: ReplanRequest, group: TaskGroup, originalDate?: string, assignment?: Assignment) {
  const start = planningStart(request)
  const goalLatest = assignment ? nearestRelevantLatestDate(state, assignment) : undefined
  const candidates = [state.settings.endDate, goalLatest].filter((item): item is string => Boolean(item)).sort()
  const end = candidates[0] ?? state.settings.endDate
  const all = dateRange(start, end)
  if (request.mode !== 'repair' || !originalDate) return all
  const radius = Math.max(1, request.localRadius ?? state.settings.localRepairRadius)
  const local = all.filter(date => Math.abs(differenceInCalendarDays(parseISO(date), parseISO(originalDate))) <= radius)
  const localSet = new Set(local)
  const rest = all.filter(date => !localSet.has(date))
  return [...local, ...rest]
}

function rejectedAlternative(date: string, violations: PlacementViolation[]): ReplanRejectedAlternative {
  return { date, reasons: violations.map(item => `${item.label}（${Math.round(item.current)}/${Math.round(item.limit)}）`) }
}

function conflictFromRejections(
  assignment: Assignment,
  rejected: { date: string; violations: PlacementViolation[] }[],
  existing: ReplanConstraintConflict[]
) {
  const limitViolations = rejected.flatMap(item => item.violations.map(violation => ({ date: item.date, violation })))
    .filter(item => item.violation.key === 'capacity' || item.violation.key.startsWith('group:') || item.violation.key.startsWith('activity:') || item.violation.key === 'long' || item.violation.key === 'high-intensity' || item.violation.key === 'load-long-high-max' || item.violation.key === 'load-high-streak' || item.violation.key === 'date-protection' || item.violation.key === 'protected-buffer' || item.violation.key === 'buffer-high-intensity' || item.violation.key === 'buffer-long-task' || isTodayIncomingConstraint(item.violation.key))
  if (!limitViolations.length) return
  const chosen = limitViolations.sort((a, b) => a.violation.current - b.violation.current)[0]
  const key = `${chosen.date}:${chosen.violation.key}`
  const found = existing.find(item => `${item.date}:${item.key}` === key)
  if (found) {
    if (!found.affectedAssignmentIds.includes(assignment.id)) found.affectedAssignmentIds.push(assignment.id)
    found.current = Math.max(found.current, chosen.violation.current)
    found.suggestedLimit = Math.max(found.suggestedLimit, chosen.violation.current, chosen.violation.limit + 1)
    found.deficit = Math.max(0, found.current - found.limit)
    found.minimumFeasibleLimit = Math.max(found.minimumFeasibleLimit, found.suggestedLimit)
    return
  }
  existing.push({
    date: chosen.date,
    key: chosen.violation.key,
    label: chosen.violation.label,
    current: chosen.violation.current,
    limit: chosen.violation.limit,
    suggestedLimit: Math.max(chosen.violation.current, chosen.violation.limit + 1),
    deficit: Math.max(0, chosen.violation.current - chosen.violation.limit),
    minimumFeasibleLimit: Math.max(chosen.violation.current, chosen.violation.limit + 1),
    affectedAssignmentIds: [assignment.id],
    options: [
      `仅本次把 ${chosen.date} 的上限放宽到 ${Math.max(chosen.violation.current, chosen.violation.limit + 1)}`,
      '延后阶段目标或最终截止日期',
      '增加附近日期的可用时间',
      '使用一个明确允许的缓冲日'
    ]
  })
}

function calculateDisturbance(beforeState: AppState, afterState: AppState, beforeStats = statsMap(beforeState), afterStats = statsMap(afterState)): ReplanDisturbance {
  const dates = dateRange(beforeState.settings.startDate, beforeState.settings.endDate)
  const deltas = dates.map(date => Math.abs((afterStats.get(date)?.totalMinutes ?? 0) - (beforeStats.get(date)?.totalMinutes ?? 0)))
  const changedDays = deltas.filter(value => value > 0).length
  const scheduled = beforeState.assignments.filter(item => item.scheduledDate)
  const afterById = new Map(afterState.assignments.map(item => [item.id, item]))
  const retained = scheduled.filter(item => afterById.get(item.id)?.scheduledDate === item.scheduledDate).length
  const movedByOrigin = new Map<string, number[]>()
  for (const item of scheduled) {
    const nextDate = afterById.get(item.id)?.scheduledDate
    if (!item.scheduledDate || !nextDate || item.scheduledDate === nextDate) continue
    const shift = differenceInCalendarDays(parseISO(nextDate), parseISO(item.scheduledDate))
    movedByOrigin.set(item.scheduledDate, [...(movedByOrigin.get(item.scheduledDate) ?? []), shift])
  }
  const preservedDailyBundles = [...movedByOrigin.values()].filter(shifts => shifts.length > 1 && shifts.every(value => value === shifts[0])).length
  return {
    changedDays,
    movedTasks: beforeState.assignments.filter(item => afterById.get(item.id)?.scheduledDate !== item.scheduledDate).length,
    originalDateRetentionRate: scheduled.length ? retained / scheduled.length : 1,
    averageLoadDelta: dates.length ? deltas.reduce((sum, value) => sum + value, 0) / dates.length : 0,
    maximumLoadDelta: Math.max(0, ...deltas),
    preservedDailyBundles
  }
}

function explainMove(
  beforeState: AppState,
  afterState: AppState,
  assignment: Assignment,
  group: TaskGroup,
  from: string | undefined,
  to: string | undefined,
  hardRequired: boolean,
  beforeStatsMap: Map<string, DayStats>,
  afterStatsMap: Map<string, DayStats>
) {
  if (!to) return {
    reason: '完整验算后没有找到不会制造新硬冲突的日期。',
    impact: '任务保持未安排；请放宽一次上限、增加可用时间、使用缓冲日或调整目标日期。'
  }
  if (!from) {
    const desired = relevantDesiredDate(afterState, assignment)
    return {
      reason: '任务原先未安排，系统在目标期限、负载和每日上限均通过验算后选择该日。',
      impact: desired ? (after(to, desired) ? `会晚于期望完成日期 ${desired}，但仍需继续检查最晚期限。` : `不晚于期望完成日期 ${desired}。`) : '该任务没有直接期望日期，以计划结束日作为搜索边界。'
    }
  }
  const beforeStats = beforeStatsMap.get(from) ?? blankStats()
  const targetBefore = beforeStatsMap.get(to) ?? blankStats()
  const targetAfter = afterStatsMap.get(to) ?? blankStats()
  const sourceReason = getDayConfig(beforeState, from).isBufferDay
    ? `${from} 被设为缓冲日，可用时间降低`
    : hardRequired
      ? `${from} 存在容量、截止日期或每日上限硬冲突`
      : `${from} 的负载或任务结构需要改善`
  const desired = relevantDesiredDate(afterState, assignment)
  return {
    reason: `${sourceReason}；${to} 在完整验算后可以接收该任务。`,
    impact: `${from} 由约 ${Math.round(beforeStats.totalMinutes)} 分钟减负；${to} 由约 ${Math.round(targetBefore.totalMinutes)} 分钟变为 ${Math.round(targetAfter.totalMinutes)} 分钟${desired ? (after(to, desired) ? `，晚于期望日期 ${desired}` : `，不晚于期望日期 ${desired}`) : '，且未受旧任务组日期字段影响'}。`
  }
}

function buildScenario(input: AppState, request: ReplanRequest, strategy: ReplanStrategy, repair: ReturnType<typeof identifyRepairCandidates>): ReplanResult {
  const state = cloneActiveState(input)
  if (strategy === 'rest') applyAutomaticBufferDays(state, request)
  const scenarioRepair = strategy === 'rest' ? identifyRepairCandidates(state, request) : repair
  const groups = groupMap(state)
  const index = plannerIndex(state)
  const oldDates = new Map(input.assignments.map(item => [item.id, item.scheduledDate]))
  const candidates = assignmentCandidates(state, { ...request, strategy }, scenarioRepair)
  const baseline = baselineMaps(input)
  const forbiddenReturn = new Map<string, string>()
  for (const assignment of state.assignments) {
    if (!candidates.has(assignment.id) || !assignment.previousDate || !assignment.lastManualMoveAt) continue
    if (Date.now() - Date.parse(assignment.lastManualMoveAt) < 72 * 60 * 60 * 1000) forbiddenReturn.set(assignment.id, assignment.previousDate)
  }

  for (const assignment of state.assignments) if (candidates.has(assignment.id)) assignment.scheduledDate = undefined
  const stats = statsMap(state, candidates)
  const unresolved: Assignment[] = []
  const rejectionMap = new Map<string, ReplanRejectedAlternative[]>()
  const constraintConflicts: ReplanConstraintConflict[] = []
  const preferredShiftByOrigin = new Map<string, number>()
  const candidateDateCache = new Map<string, string[]>()

  const affectedIds = new Set(request.affectedAssignmentIds ?? [])
  const dependencyDepth = new Map<string, number>()
  const candidateItems = [...state.assignments.filter(item => candidates.has(item.id))].sort((a, b) => {
    const ga = groups.get(a.groupId)!
    const gb = groups.get(b.groupId)!
    const depthA = prerequisiteDepth(ga.id, groups, dependencyDepth)
    const depthB = prerequisiteDepth(gb.id, groups, dependencyDepth)
    if (depthA !== depthB) return depthA - depthB
    if (a.intentStrength !== b.intentStrength) return a.intentStrength === 'manual' ? -1 : b.intentStrength === 'manual' ? 1 : 0
    if (a.status !== b.status) return a.status === 'partial' ? -1 : b.status === 'partial' ? 1 : 0
    const deadlineA = relevantDesiredDate(state, a) ?? state.settings.endDate
    const deadlineB = relevantDesiredDate(state, b) ?? state.settings.endDate
    if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB)
    const priorityA = Math.max(ga.priority, relevantGoalPriority(state, a))
    const priorityB = Math.max(gb.priority, relevantGoalPriority(state, b))
    if (priorityA !== priorityB) return priorityB - priorityA
    if (scenarioRepair.hardRequired.has(a.id) !== scenarioRepair.hardRequired.has(b.id)) return scenarioRepair.hardRequired.has(a.id) ? -1 : 1
    if (affectedIds.has(a.id) !== affectedIds.has(b.id)) return affectedIds.has(a.id) ? -1 : 1
    return effectiveMinutes(b) - effectiveMinutes(a)
  })

  for (const assignment of candidateItems) {
    const group = groups.get(assignment.groupId)!
    const originalDate = oldDates.get(assignment.id)
    const latest = nearestRelevantLatestDate(state, assignment) ?? state.settings.endDate
    const dateCacheKey = `${planningStart(request)}|${latest}|${request.mode}|${originalDate ?? ''}|${request.localRadius ?? ''}`
    let candidateDates = candidateDateCache.get(dateCacheKey)
    if (!candidateDates) {
      candidateDates = possibleDateRange(state, request, group, originalDate, assignment)
      candidateDateCache.set(dateCacheKey, candidateDates)
    }
    const dates = candidateDates
      .filter(date => forbiddenReturn.get(assignment.id) !== date)
    const legal: { date: string; score: number }[] = []
    const rejected: { date: string; violations: PlacementViolation[] }[] = []
    for (const date of dates) {
      const violations = validatePlacement(state, stats, assignment, group, date, request, originalDate, index)
      if (violations.some(item => item.hard)) {
        rejected.push({ date, violations })
        continue
      }
      const preferredShift = originalDate ? preferredShiftByOrigin.get(originalDate) : undefined
      legal.push({ date, score: candidateScore(state, stats, assignment, group, date, strategy, originalDate, baseline, preferredShift, request) })
    }
    legal.sort((a, b) => a.score - b.score || a.date.localeCompare(b.date))
    const radius = Math.max(1, request.localRadius ?? state.settings.localRepairRadius)
    const broadEventTypes: PlanChangeEvent['type'][] = ['new-task-insertion', 'task-group-size-increase', 'goal-tightening', 'availability-change', 'execution-difference', 'rule-change', 'bulk-move']
    const useStrictLocalWindow = request.mode === 'repair' && originalDate && !broadEventTypes.includes(request.event?.type ?? 'future-replanning')
    const localLegal = useStrictLocalWindow
      ? legal.filter(item => Math.abs(differenceInCalendarDays(parseISO(item.date), parseISO(originalDate))) <= radius)
      : legal
    const preferredShift = originalDate ? preferredShiftByOrigin.get(originalDate) : undefined
    const originalConfig = originalDate ? getDayConfig(state, originalDate) : undefined
    const preserveBundle = Boolean(originalDate && originalConfig?.isBufferDay && originalConfig.bufferPreference === 'preserve' && preferredShift !== undefined)
    const exactBundleDate = preserveBundle && originalDate ? shiftDate(originalDate, preferredShift!) : undefined
    const exactBundleCandidate = exactBundleDate ? legal.find(item => item.date === exactBundleDate) : undefined
    const selected = exactBundleCandidate?.date ?? (localLegal.length ? localLegal : legal)[0]?.date
    rejectionMap.set(assignment.id, rejected.slice(0, 8).map(item => rejectedAlternative(item.date, item.violations)))
    if (!selected) {
      unresolved.push(assignment)
      conflictFromRejections(assignment, rejected, constraintConflicts)
      continue
    }
    assignment.scheduledDate = selected
    assignment.scheduleSource = 'replan'
    if (assignment.intentStrength !== 'locked') assignment.intentStrength = assignment.intentStrength === 'manual' ? 'manual' : 'normal'
    addToStats(stats, selected, assignment, group, originalDate, input.settings.longTaskThresholdMinutes)
    if (originalDate && !preferredShiftByOrigin.has(originalDate) && originalDate !== selected) {
      preferredShiftByOrigin.set(originalDate, differenceInCalendarDays(parseISO(selected), parseISO(originalDate)))
    }
  }

  // Bounded local exchange: if the greedy pass leaves a task unplaced, move one
  // ordinary automatic task out of a candidate date and try both placements again.
  let swapBudget = 48
  const remainingUnresolved: Assignment[] = []
  for (const assignment of unresolved) {
    let resolved = false
    const group = groups.get(assignment.groupId)!
    const originalDate = oldDates.get(assignment.id)
    const dates = possibleDateRange(state, request, group, originalDate, assignment).slice(0, 12)
    for (const date of dates) {
      if (resolved || swapBudget <= 0) break
      const blockers = state.assignments.filter(item => item.scheduledDate === date && item.id !== assignment.id && candidates.has(item.id) && item.status === 'todo' && !item.locked && item.intentStrength !== 'manual').slice(0, 8)
      for (const blocker of blockers) {
        if (swapBudget-- <= 0) break
        const blockerGroup = groups.get(blocker.groupId)
        if (!blockerGroup || !blocker.scheduledDate) continue
        const blockerDate = blocker.scheduledDate
        removeFromStats(stats, blockerDate, blocker, blockerGroup, oldDates.get(blocker.id), input.settings.longTaskThresholdMinutes)
        const placementIssues = validatePlacement(state, stats, assignment, group, date, request, originalDate, index)
        if (!placementIssues.some(item => item.hard)) {
          assignment.scheduledDate = date
          addToStats(stats, date, assignment, group, originalDate, input.settings.longTaskThresholdMinutes)
          const blockerDates = possibleDateRange(state, request, blockerGroup, oldDates.get(blocker.id), blocker).filter(item => item !== date).slice(0, 20)
          const alternate = blockerDates.find(candidate => !validatePlacement(state, stats, blocker, blockerGroup, candidate, request, oldDates.get(blocker.id), index).some(item => item.hard))
          if (alternate) {
            blocker.scheduledDate = alternate
            blocker.scheduleSource = 'replan'
            assignment.scheduleSource = 'replan'
            addToStats(stats, alternate, blocker, blockerGroup, oldDates.get(blocker.id), input.settings.longTaskThresholdMinutes)
            resolved = true
            break
          }
          removeFromStats(stats, date, assignment, group, originalDate, input.settings.longTaskThresholdMinutes)
          assignment.scheduledDate = undefined
        }
        blocker.scheduledDate = blockerDate
        addToStats(stats, blockerDate, blocker, blockerGroup, oldDates.get(blocker.id), input.settings.longTaskThresholdMinutes)
      }
    }
    if (!resolved) remainingUnresolved.push(assignment)
  }

  const warnings: string[] = []
  for (const assignment of remainingUnresolved) {
    const group = groups.get(assignment.groupId)!
    warnings.push(`${group.subject}「${assignment.title}」暂无合法安排位置，系统没有强行制造新的冲突。`)
  }

  const analyzed = analyzePlan(state, planningStart(request), index, stats)
  warnings.push(...analyzed.filter(issue => issue.level !== 'info').map(issue => issue.message))

  const beforeStats = statsMap(input)
  const afterStats = statsMap(state)
  const inputById = new Map(input.assignments.map(item => [item.id, item]))
  const includeFullExplanations = request.explanationLevel === 'full'
  const moves: ReplanMove[] = state.assignments
    .filter(assignment => oldDates.get(assignment.id) !== assignment.scheduledDate)
    .map(assignment => {
      const group = groups.get(assignment.groupId)!
      const from = oldDates.get(assignment.id)
      const to = assignment.scheduledDate
      const explanation = includeFullExplanations
        ? explainMove(input, state, assignment, group, from, to, scenarioRepair.hardRequired.has(assignment.id), beforeStats, afterStats)
        : { reason: from ? '方案为解决当前冲突或改善负载而调整此任务。' : '任务原先未安排，方案为它找到一个通过硬约束检查的日期。', impact: to ? `${from ?? '未安排'} → ${to}` : '仍无合法日期，需要放宽约束或增加可用时间。' }
      const alternativeStats = includeFullExplanations ? statsWithoutAssignment(afterStats, assignment, group, from, input.settings.longTaskThresholdMinutes) : undefined
      const alternatives = includeFullExplanations ? dateRange(planningStart(request), relevantLatestOrPlanEnd(state, assignment))
        .filter(date => date !== to)
        .map(date => ({ date, violations: validatePlacement(state, alternativeStats!, assignment, group, date, request, from, index) }))
        .filter(item => !item.violations.some(violation => violation.hard))
        .slice(0, 3)
        .map(item => { const desired = relevantDesiredDate(state, assignment); return { date: item.date, label: item.date, impact: desired && after(item.date, desired) ? `会晚于期望日期 ${desired}` : desired ? `不晚于期望日期 ${desired}` : '不受旧任务组日期约束' } }) : []
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        subject: group.subject,
        from,
        to,
        reason: explanation.reason,
        impact: explanation.impact,
        alternatives,
        rejectedAlternatives: rejectionMap.get(assignment.id)?.slice(0, 3),
        wasManual: inputById.get(assignment.id)?.intentStrength === 'manual',
        hardRequired: scenarioRepair.hardRequired.has(assignment.id)
      }
    })

  const start = planningStart(request)
  const loadChanges: LoadChange[] = dateRange(start, state.settings.endDate)
    .map(date => ({
      date,
      beforeMinutes: Math.round(beforeStats.get(date)?.totalMinutes ?? 0),
      afterMinutes: Math.round(afterStats.get(date)?.totalMinutes ?? 0),
      capacity: getCapacity(state, date)
    }))
    .filter(change => change.beforeMinutes !== change.afterMinutes || getCapacity(input, change.date) !== change.capacity)

  const dayTypeSuggestions: DayTypeSuggestion[] = []
  for (const date of dateRange(start, state.settings.endDate)) {
    const config = getDayConfig(state, date)
    const load = afterStats.get(date)?.totalMinutes ?? 0
    if (!config.isBufferDay && config.type === 'regular' && load > state.settings.regularMinutes && load <= state.settings.studyMinutes) {
      dayTypeSuggestions.push({
        date,
        from: 'regular',
        to: 'study',
        reason: `该日约 ${Math.round(load)} 分钟，改为学习日可增加安全余量`,
        capacityGain: state.settings.studyMinutes - state.settings.regularMinutes
      })
    }
  }

  const disturbance = calculateDisturbance(input, state, beforeStats, afterStats)
  // ReplanSummary 的 core* 字段仅为 v0.7 兼容名称；v0.8 实际承载“最近活跃目标”的预计结果。
  const nearestGoal = (source: AppState) => source.goals
    .filter(goal => goal.status === 'active')
    .sort((a, b) => (a.desiredDate ?? a.latestDate).localeCompare(b.desiredDate ?? b.latestDate))[0]
  const goalSummary = (source: AppState) => {
    const goal = nearestGoal(source)
    if (!goal) return undefined
    const progress = goalProgress(source, goal)
    return progress.completed ? '已完成' : progress.expectedCompletion
  }
  const coreBefore = goalSummary(input)
  const coreAfter = goalSummary(state)
  const chemistryBefore = predictCompletion(input, group => taskActivity(group) === 'chem-preview')
  const chemistryAfter = predictCompletion(state, group => taskActivity(group) === 'chem-preview')
  const allBefore = predictCompletion(input, group => !group.recurring && group.priority > 0)
  const allAfter = predictCompletion(state, group => !group.recurring && group.priority > 0)
  const titles: Record<ReplanStrategy, string> = {
    preserve: '最少改动',
    balanced: '平衡执行',
    goal: '目标优先',
    rest: '休息缓冲'
  }
  const descriptions: Record<ReplanStrategy, string> = {
    preserve: '优先保持每日任务组合，只修复真正的冲突并控制涟漪范围。',
    balanced: '保留约 15% 余量，平衡科目、强度、长任务和每日数量。',
    goal: '高优先级任务尽量靠前，可接近满载，但仍不突破硬限制。',
    rest: '滚动七天保留轻量缓冲位置，连续高负载后主动降低强度。'
  }
  const bufferDates = dateRange(start, state.settings.endDate).filter(date => getDayConfig(state, date).isBufferDay)
  const consequences = [
    scenarioRepair.issues.length ? `检测到 ${scenarioRepair.issues.length} 个待处理问题。` : '当前没有明显硬冲突。',
    moves.length ? `将移动 ${moves.length} 项任务，涉及 ${disturbance.changedDays} 天。` : '无需移动任务。',
    `原计划日期保留率 ${Math.round(disturbance.originalDateRetentionRate * 100)}%，平均每日负载变化约 ${Math.round(disturbance.averageLoadDelta)} 分钟。`,
    bufferDates.length ? `方案保留或生成 ${bufferDates.length} 个缓冲日；用户手动缓冲日不会被自动占用。` : '该方案没有新增缓冲日。',
    remainingUnresolved.length ? `仍有 ${remainingUnresolved.length} 项没有合法位置，已保留为待决定，不会强塞。` : '所有候选任务都通过了来源日与目标日完整验算。'
  ]

  state.updatedAt = new Date().toISOString()
  return {
    id: uid('scenario'),
    strategy,
    title: titles[strategy],
    description: descriptions[strategy],
    request: { ...request, strategy },
    nextState: state,
    moves,
    warnings: [...new Set(warnings)],
    consequences,
    dayTypeSuggestions,
    loadChanges,
    constraintConflicts,
    disturbance,
    summary: {
      moved: moves.length,
      preservedManual: state.assignments.filter(item => item.intentStrength === 'manual' && oldDates.get(item.id) === item.scheduledDate).length,
      locked: state.assignments.filter(item => item.locked).length,
      unresolved: remainingUnresolved.length,
      coreBefore,
      coreAfter,
      chemistryBefore,
      chemistryAfter,
      allBefore,
      allAfter,
      bufferDays: bufferDates.length,
      changedDays: disturbance.changedDays,
      originalRetentionRate: disturbance.originalDateRetentionRate
    }
  }
}

export function autoConfigureDayTypes(state: AppState): AppState {
  const next = cloneActiveState(state)
  for (const date of dateRange(next.settings.startDate, next.settings.endDate)) {
    if (!next.dayConfigs[date]) next.dayConfigs[date] = { date, type: 'regular', userSet: false }
  }
  const remaining = next.assignments.filter(item => item.status !== 'done' && !next.taskGroups.find(group => group.id === item.groupId)?.recurring)
    .reduce((sum, item) => sum + effectiveMinutes(item), 0)
  const dates = dateRange(next.settings.startDate, next.settings.endDate)
  const current = dates.reduce((sum, date) => sum + getCapacity(next, date) * next.settings.targetUtilization, 0)
  let shortfall = Math.max(0, remaining - current)
  const gain = Math.max(1, next.settings.studyMinutes - next.settings.regularMinutes)
  for (const date of dates) {
    if (shortfall <= 0) break
    const config = next.dayConfigs[date]
    if (config.type === 'regular' && !config.userSet && !config.isBufferDay) {
      config.type = 'study'
      shortfall -= gain
    }
  }
  next.updatedAt = new Date().toISOString()
  return next
}

function normalizeReplanRequest(input: AppState, request: ReplanRequest): ReplanRequest {
  return {
    ...request,
    fromDate: request.fromDate || todayISO(),
    freezeDays: request.freezeDays ?? input.settings.freezeDays,
    includeToday: request.includeToday === true,
    todayExtraMinutes: Math.max(0, request.todayExtraMinutes ?? 0),
    allowTodayIncomingAssignments: request.allowTodayIncomingAssignments ?? [],
    localRadius: request.localRadius ?? input.settings.localRepairRadius,
    allowBufferUseDates: request.allowBufferUseDates ?? [],
    limitOverrides: request.limitOverrides ?? [],
    explanationLevel: request.explanationLevel ?? 'summary'
  }
}

const replanBundleCache = new Map<string, ReplanBundle>()

function replanInputSignature(input: AppState, request: ReplanRequest, strategies: ReplanStrategy[]) {
  // AppContext increments dataRevision for every semantic mutation. Using that
  // stable version avoids serializing every time-entry and nested rule on each
  // preview while still invalidating the cache whenever the input changes.
  // Legacy/demo fixtures may not have a revision yet; never let two such states
  // share a preview just because they happen to have the same updatedAt value.
  const revision = input.dataRevision ?? stableSignature({
    settings: input.settings,
    dayConfigs: input.dayConfigs,
    taskGroups: input.taskGroups,
    goals: input.goals,
    calendarConstraints: input.calendarConstraints,
    acceptedConstraintExceptions: input.acceptedConstraintExceptions,
    assignments: input.assignments.map(item => ({
      ...item,
      timeEntries: item.timeEntries.map(entry => ({
        date: timeEntryDate(entry),
        minutes: entry.minutes,
        source: entry.source,
        countInStatistics: entry.countInStatistics,
      })),
    })),
  })
  return stableSignature({ revision, updatedAt: input.updatedAt, day: todayISO(), request, strategies })
}

export function generateReplanScenario(input: AppState, request: ReplanRequest, strategy: ReplanStrategy): ReplanResult {
  const normalized = normalizeReplanRequest(input, { ...request, strategy })
  const repair = identifyRepairCandidates(input, normalized)
  return buildScenario(input, normalized, strategy, repair)
}

export function generateReplanBundle(input: AppState, request: ReplanRequest, requestedStrategies: ReplanStrategy[] = ['preserve', 'balanced', 'goal', 'rest']): ReplanBundle {
  const normalized = normalizeReplanRequest(input, request)
  const strategies: ReplanStrategy[] = Array.from(new Set<ReplanStrategy>(requestedStrategies.length ? requestedStrategies : ['preserve']))
  const cacheKey = input.timer.running ? undefined : replanInputSignature(input, normalized, strategies)
  const cached = cacheKey ? replanBundleCache.get(cacheKey) : undefined
  if (cached && cacheKey) {
    replanBundleCache.delete(cacheKey)
    replanBundleCache.set(cacheKey, cached)
    return structuredClone(cached)
  }
  const repair = identifyRepairCandidates(input, normalized)
  const actual = assignmentActualBreakdown(input)
  const today = todayISO()
  const todayStats = statsMap(input).get(today) ?? blankStats()
  const actualToday = todayStats.actualMinutes
  const inferredToday = todayStats.inferredMinutes
  const baseCapacity = getCapacity(input, today)
  const automaticRemaining = Math.max(0, baseCapacity - actualToday - inferredToday)
  const allowedIncoming = Math.max(0, normalized.todayExtraMinutes ?? 0)
  void actual
  const bundle: ReplanBundle = {
    request: normalized,
    issues: [...new Set(repair.issues)],
    todaySnapshot: {
      date: today,
      actualMinutes: Math.round(actualToday),
      inferredMinutes: Math.round(inferredToday),
      completedCount: input.assignments.filter(item => item.status === 'done' && (dayOf(item.completedAt) ?? item.scheduledDate) === today).length,
      remainingCapacity: Math.round(automaticRemaining),
      allowedIncomingMinutes: allowedIncoming,
      message: allowedIncoming > 0
        ? `今天已学习约 ${Math.round(actualToday + inferredToday)} 分钟；你为本次重排额外开放了 ${Math.round(allowedIncoming)} 分钟。`
        : actualToday + inferredToday >= baseCapacity
          ? `今天已学习约 ${Math.round(actualToday + inferredToday)} 分钟，默认不再新增任务。`
          : `今天自动剩余约 ${Math.round(automaticRemaining)} 分钟，但未来任务默认不会移入今天。`
    },
    scenarios: strategies.map(strategy => buildScenario(input, normalized, strategy, repair))
  }
  if (cacheKey) {
    replanBundleCache.set(cacheKey, bundle)
    while (replanBundleCache.size > 4) replanBundleCache.delete(replanBundleCache.keys().next().value!)
  }
  return bundle
}

export function replanState(input: AppState, fromDate = todayISO()): ReplanResult {
  const bundle = generateReplanBundle(input, { mode: 'repair', fromDate, freezeDays: input.settings.freezeDays })
  return bundle.scenarios.find(item => item.strategy === 'balanced') ?? bundle.scenarios[0]
}

export interface PlanIssue {
  level: 'info' | 'warning' | 'danger'
  date?: string
  message: string
}

/**
 * 可执行计划中的“硬约束事实”。
 *
 * 这里刻意把已经完成的真实执行和仍可调整的剩余计划分开：
 * - 已经完成/已经发生的用时与任务数量只作为历史基线；
 * - 只有当天仍存在未完成任务，且这些任务继续保留会超过约束时，才形成待处理事实；
 * - 已完成历史不会独自生成硬冲突，也不会阻止其他合法改动应用。
 */
interface HardConstraintFact {
  id: string
  date?: string
  key: string
  current: number
  limit: number
  adjustableAssignmentIds: string[]
  message: string
}

function hardConstraintFacts(state: AppState, fromDate = state.settings.startDate, index = plannerIndex(state), stats = statsMap(state)): HardConstraintFact[] {
  const groups = index.groups
  const facts: HardConstraintFact[] = []
  const start = before(fromDate, todayISO()) ? fromDate : fromDate

  for (const date of dateRange(start, state.settings.endDate)) {
    const day = stats.get(date) ?? blankStats()
    const unfinished = (index.assignmentsByDate.get(date) ?? []).filter(item => item.status !== 'done')
    const ordinaryUnfinished = unfinished.filter(item => !groups.get(item.groupId)?.recurring)
    const capacity = acceptedLimit(state, date, 'capacity', getCapacity(state, date)) ?? getCapacity(state, date)
    const actualHistory = day.actualMinutes + day.inferredMinutes

    if (ordinaryUnfinished.length > 0 && day.plannedMinutes > 0 && day.totalMinutes > capacity) {
      const remaining = Math.max(0, day.plannedMinutes)
      const historyText = actualHistory > 0
        ? `已完成或已记录的 ${Math.round(actualHistory)} 分钟作为历史保留，不参与重排；`
        : ''
      facts.push({
        id: `${date}:capacity`, date, key: 'capacity', current: day.totalMinutes, limit: capacity,
        adjustableAssignmentIds: ordinaryUnfinished.map(item => item.id),
        message: `${date} ${historyText}仍有约 ${Math.round(remaining)} 分钟未完成任务。继续保留会使当天合计约 ${Math.round(day.totalMinutes)} 分钟，超过容量 ${Math.round(day.totalMinutes - capacity)} 分钟。`,
      })
    }

    const keys = new Set(day.counts.keys())
    for (const key of keys) {
      const contributors = ordinaryUnfinished.filter(item => {
        const group = groups.get(item.groupId)
        return Boolean(group && activityKeys(group, item, state.settings.longTaskThresholdMinutes).includes(key))
      })
      if (!contributors.length) continue
      const sample = contributors[0] ?? state.assignments.find(item => {
        const group = groups.get(item.groupId)
        return Boolean(group && activityKeys(group, item, state.settings.longTaskThresholdMinutes).includes(key))
      })
      const group = sample ? groups.get(sample.groupId) : undefined
      const baseLimit = defaultLimit(state, date, key, group)
      const limit = acceptedLimit(state, date, key, baseLimit)
      const current = day.counts.get(key) ?? 0
      if (limit === undefined || current <= limit) continue
      const historicalCount = Math.max(0, current - contributors.length)
      const historyText = historicalCount > 0 ? `其中 ${historicalCount} 项已经完成或已发生，作为历史保留；` : ''
      facts.push({
        id: `${date}:${key}`, date, key, current, limit,
        adjustableAssignmentIds: contributors.map(item => item.id),
        message: `${date} 的${limitLabel(key, group)}为 ${current}，超过上限 ${limit}。${historyText}仍需决定 ${contributors.length} 项未完成任务的安排。`,
      })
    }

    const config = getDayConfig(state, date)
    const isBufferDay = Boolean(config.isBufferDay || constraintsForDate(state, date).some(item => item.kind === 'protected-buffer'))
    if (isBufferDay) {
      const longTasks = ordinaryUnfinished.filter(item => isLongTask(item, state.settings.longTaskThresholdMinutes))
      if (longTasks.length) facts.push({
        id: `${date}:buffer-long-task`, date, key: 'buffer-long-task', current: longTasks.length, limit: 0,
        adjustableAssignmentIds: longTasks.map(item => item.id),
        message: `${date} 是缓冲日，仍有 ${longTasks.length} 项未完成长任务需要处理。已经完成的长任务记录不参与重排。`,
      })
      const highTasks = ordinaryUnfinished.filter(item => {
        const group = groups.get(item.groupId)
        return Boolean(group && isHighIntensity(group, item))
      })
      if (highTasks.length) facts.push({
        id: `${date}:buffer-high-intensity`, date, key: 'buffer-high-intensity', current: highTasks.length, limit: 0,
        adjustableAssignmentIds: highTasks.map(item => item.id),
        message: `${date} 是缓冲日，仍有 ${highTasks.length} 项未完成高强度任务需要处理。已经完成的高强度任务记录不参与重排。`,
      })
    }
  }

  for (const assignment of state.assignments.filter(item => item.status !== 'done' && item.scheduledDate)) {
    const group = groups.get(assignment.groupId)
    const latest = nearestRelevantLatestDate(state, assignment)
    if (!group || !latest || !after(assignment.scheduledDate!, latest)) continue
    facts.push({
      id: `${assignment.scheduledDate}:goal-latest:${assignment.id}`, date: assignment.scheduledDate,
      key: 'goal-latest', current: 1, limit: 0, adjustableAssignmentIds: [assignment.id],
      message: `${group.subject}「${assignment.title}」晚于相关目标最晚日期 ${latest}。`,
    })
  }

  return [...new Map(facts.map(fact => [fact.id, fact])).values()]
}

/**
 * 只返回相对基线“新增或恶化”的硬约束事实。
 * 使用约束身份与超额值比较，而不是比较带数字的提示文案，避免把“609 分钟降到 594 分钟”
 * 误判成一个全新的冲突。若非法占用中出现了新的任务，即使超额相同，也仍视为新增使用。
 */
function worsenedHardConstraintFacts(baseline: AppState, candidate: AppState, fromDate: string) {
  const beforeFacts = new Map(hardConstraintFacts(baseline, fromDate).map(item => [item.id, item]))
  return hardConstraintFacts(candidate, fromDate).filter(item => {
    const beforeFact = beforeFacts.get(item.id)
    if (!beforeFact) return true
    const beforeExcess = Math.max(0, beforeFact.current - beforeFact.limit)
    const afterExcess = Math.max(0, item.current - item.limit)
    if (afterExcess > beforeExcess + 1e-6) return true
    const oldAssignments = new Set(beforeFact.adjustableAssignmentIds)
    return item.adjustableAssignmentIds.some(id => !oldAssignments.has(id))
  })
}

function hardConstraintIssueDelta(baseline: AppState, candidate: AppState, fromDate: string) {
  const before = new Map(hardConstraintFacts(baseline, fromDate).map(item => [item.id, item]))
  const after = new Map(hardConstraintFacts(candidate, fromDate).map(item => [item.id, item]))
  let resolvedPreExistingCount = 0
  let improvedPreExistingCount = 0
  let remainingPreExistingCount = 0
  for (const [id, oldFact] of before) {
    const nextFact = after.get(id)
    if (!nextFact) {
      resolvedPreExistingCount += 1
      continue
    }
    remainingPreExistingCount += 1
    const oldExcess = Math.max(0, oldFact.current - oldFact.limit)
    const nextExcess = Math.max(0, nextFact.current - nextFact.limit)
    if (nextExcess + 1e-6 < oldExcess) improvedPreExistingCount += 1
  }
  return {
    preExistingCount: before.size,
    remainingPreExistingCount,
    resolvedPreExistingCount,
    improvedPreExistingCount,
    newOrWorsenedCount: worsenedHardConstraintFacts(baseline, candidate, fromDate).length,
  }
}

export function analyzePlan(state: AppState, fromDate = state.settings.startDate, index = plannerIndex(state), stats = statsMap(state)): PlanIssue[] {
  const groups = index.groups
  const issues: PlanIssue[] = hardConstraintFacts(state, fromDate, index, stats).map(fact => ({ level: 'danger', date: fact.date, message: fact.message }))
  for (const cycle of dependencyCycleLabels(state.taskGroups)) issues.push({ level: 'danger', message: `检测到循环依赖：${cycle}。请修改前置任务组后再排期。` })
  let highStreak = 0
  const start = before(fromDate, todayISO()) ? fromDate : fromDate
  for (const date of dateRange(start, state.settings.endDate)) {
    const day = stats.get(date) ?? blankStats()
    const capacity = acceptedLimit(state, date, 'capacity', getCapacity(state, date)) ?? getCapacity(state, date)
    const config = getDayConfig(state, date)
    const unfinished = (index.assignmentsByDate.get(date) ?? []).filter(item => item.status !== 'done' && !groups.get(item.groupId)?.recurring)

    // 已完成的真实执行可能远高于计划容量，但它是历史事实，不再作为计划冲突或满载提醒展示。
    if (unfinished.length > 0 && capacity > 0 && day.totalMinutes <= capacity && day.totalMinutes / capacity > state.settings.nearFullThreshold) {
      issues.push({ level: 'warning', date, message: `${date} 的剩余计划使当天接近满载（${Math.round(day.totalMinutes / capacity * 100)}%），建议保留缓冲。` })
    }
    const maxTasks = config.type === 'study' ? state.settings.studyMaxTasks : state.settings.regularMaxTasks
    if (unfinished.length > 0 && day.taskCount > maxTasks) issues.push({ level: 'warning', date, message: `${date} 合计有 ${day.taskCount} 项活动，其中仍有 ${unfinished.length} 项未完成；超过建议上限 ${maxTasks}。` })

    const subjectOver = unfinished.length > 0
      ? [...day.subjectMinutes.entries()].find(([, minutes]) => day.totalMinutes > 90 && minutes / day.totalMinutes > state.settings.subjectShareLimit)
      : undefined
    if (subjectOver) issues.push({ level: 'info', date, message: `${date} 的${subjectOver[0]}占比偏高，建议与其他科目搭配。` })
    if (config.type === 'travel' && unfinished.length) issues.push({ level: 'warning', date, message: `${date} 是旅游日，但仍有 ${unfinished.length} 项普通任务。` })

    const ratio = capacity > 0 && unfinished.length > 0 ? day.totalMinutes / capacity : 0
    highStreak = ratio >= state.settings.highLoadThreshold ? highStreak + 1 : 0
    if (highStreak >= state.settings.highLoadStreak) {
      issues.push({ level: 'info', date, message: `截至 ${date} 已连续 ${highStreak} 天高负载，建议下一天设置为轻量缓冲日。` })
      highStreak = 0
    }
  }
  return [...new Map(issues.map(issue => [`${issue.level}:${issue.date ?? ''}:${issue.message}`, issue])).values()]
}

export function predictCompletion(state: AppState, predicate?: (group: TaskGroup) => boolean): string | undefined {
  const groups = groupMap(state)
  const remaining = state.assignments.filter(assignment => {
    const group = groups.get(assignment.groupId)
    return Boolean(group && assignment.status !== 'done' && (!predicate || predicate(group)))
  })
  if (!remaining.length) return '已完成'
  const scheduled = remaining.map(item => item.scheduledDate).filter(Boolean) as string[]
  if (scheduled.length !== remaining.length) return undefined
  return [...scheduled].sort().at(-1)
}

export interface PlacementCheckItem {
  key: string
  label: string
  current: number
  limit: number
  hard: boolean
}

export function checkAssignmentPlacement(state: AppState, assignmentId: string, date: string): PlacementCheckItem[] {
  const assignment = state.assignments.find(item => item.id === assignmentId)
  if (!assignment) return [{ key: 'missing-task', label: '找不到该任务', current: 1, limit: 0, hard: true }]
  const group = state.taskGroups.find(item => item.id === assignment.groupId)
  if (!group) return [{ key: 'missing-group', label: '找不到任务组', current: 1, limit: 0, hard: true }]
  const stats = statsMap(state, new Set([assignment.id]))
  const today = stats.get(todayISO()) ?? blankStats()
  const automaticTodayRemaining = Math.max(0, getCapacity(state, todayISO()) - today.actualMinutes - today.inferredMinutes)
  const request: ReplanRequest = {
    mode: 'repair',
    fromDate: todayISO(),
    todayExtraMinutes: automaticTodayRemaining,
    allowBufferUseDates: [],
    limitOverrides: []
  }
  return validatePlacement(state, stats, assignment, group, date, request, assignment.scheduledDate)
}

export function suggestMoveDates(state: AppState, assignmentId: string, limit = 5): string[] {
  const assignment = state.assignments.find(item => item.id === assignmentId)
  if (!assignment) return []
  const group = state.taskGroups.find(item => item.id === assignment.groupId)
  if (!group) return []
  const request: ReplanRequest = { mode: 'repair', fromDate: todayISO(), todayExtraMinutes: 0, limitOverrides: [], allowBufferUseDates: [] }
  const stats = statsMap(state, new Set([assignment.id]))
  const baseline = baselineMaps(state)
  return dateRange(todayISO(), relevantLatestOrPlanEnd(state, assignment))
    .filter(date => !validatePlacement(state, stats, assignment, group, date, request, assignment.scheduledDate).some(item => item.hard))
    .map(date => ({ date, score: candidateScore(state, stats, assignment, group, date, 'balanced', assignment.scheduledDate, baseline) }))
    .sort((a, b) => a.score - b.score || a.date.localeCompare(b.date))
    .slice(0, limit)
    .map(item => item.date)
}

export function moveOneDay(date: string, direction: -1 | 1) {
  return shiftDate(date, direction)
}

export function plannerActivityType(group: TaskGroup) {
  return taskActivity(group)
}

export function actualLearningSnapshot(state: AppState, date = todayISO()) {
  const stats = statsMap(state).get(date) ?? blankStats()
  return {
    actualMinutes: Math.round(stats.actualMinutes),
    inferredMinutes: Math.round(stats.inferredMinutes),
    plannedMinutes: Math.round(stats.plannedMinutes),
    totalMinutes: Math.round(stats.totalMinutes),
    taskCount: stats.taskCount
  }
}

/**
 * 每日复盘同时看“原计划在这一天的任务”和“真实在这一天执行的任务”。
 * 这样提前完成、补做逾期任务或跨日计时不会从复盘中消失；历史日期也不会
 * 因为任务后来才完成而被错误改写为当日已完成。
 */
export function reviewDaySnapshot(state: AppState, date: string): ReviewDaySnapshot {
  const groups = groupMap(state)
  const baseline = state.dailyPlanBaselines.find(item => item.date === date)
  const plannedAssignmentIds = baseline
    ? baseline.assignments.map(item => item.assignmentId)
    : state.assignments.filter(item => item.scheduledDate === date).map(item => item.id)
  const plannedIdSet = new Set(plannedAssignmentIds)
  const planned = state.assignments.filter(item => plannedIdSet.has(item.id))
  const executed = state.assignments.filter(item => {
    const completedDate = dayOf(item.completedAt) ?? (item.status === 'done' ? item.scheduledDate : undefined)
    return actualMinutesForAssignmentOnDate(state, item, date) > 0 || completedDate === date
  })
  const assignmentIds = Array.from(new Set([...plannedAssignmentIds, ...executed.map(item => item.id)]))
  const completedAssignmentIds = assignmentIds.filter(id => {
    const item = state.assignments.find(candidate => candidate.id === id)
    if (!item || item.status !== 'done') return false
    const completedDate = dayOf(item.completedAt) ?? item.scheduledDate
    return Boolean(completedDate && completedDate <= date)
  })
  const completedSet = new Set(completedAssignmentIds)
  const unfinishedPlanned = planned.filter(item => !completedSet.has(item.id))
  const stats = statsMap(state).get(date) ?? blankStats()
  return {
    date,
    plannedAssignmentIds,
    executedAssignmentIds: executed.map(item => item.id),
    assignmentIds,
    completedAssignmentIds,
    unfinishedAssignmentIds: unfinishedPlanned.filter(item => !groups.get(item.groupId)?.recurring).map(item => item.id),
    recurringUnfinishedAssignmentIds: unfinishedPlanned.filter(item => groups.get(item.groupId)?.recurring).map(item => item.id),
    plannedMinutes: baseline
      ? baseline.assignments.reduce((sum, item) => sum + item.estimatedMinutes, 0)
      : planned.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    actualMinutes: Math.round(stats.actualMinutes),
    inferredMinutes: Math.round(stats.inferredMinutes),
  }
}

export function planningDayLoad(state: AppState, date: string) {
  return Math.round(statsMap(state).get(date)?.totalMinutes ?? 0)
}

function proposalIssueFromText(text: string, event: PlanChangeEvent): ProposalIssue {
  return {
    id: uid('issue'),
    type: 'unscheduled',
    title: '计划影响',
    detail: text,
    assignmentIds: event.affectedAssignmentIds,
    consequence: '若不处理，部分任务可能保持冲突或未安排。',
    resolution: '查看候选方案并选择是否应用，或保留当前计划。',
  }
}

function proposalIssuesFromScenario(event: PlanChangeEvent, bundleIssues: string[], scenario: ReplanResult): ProposalIssue[] {
  const issues = bundleIssues.map(text => proposalIssueFromText(text, event))
  for (const conflict of scenario.constraintConflicts) {
    const todayIncoming = isTodayIncomingConstraint(conflict.key)
    const type = conflict.key === 'long' ? 'long-task-max'
      : conflict.key === 'high-intensity' ? 'high-intensity-max'
        : conflict.key.startsWith('group:') ? 'group-daily-max'
          : conflict.key.startsWith('activity:') ? 'activity-daily-max'
            : conflict.key === 'date-protection' || conflict.key === 'protected-buffer' ? 'date-protection'
              : 'capacity'
    const groupId = conflict.key.startsWith('group:') ? conflict.key.slice('group:'.length) : undefined
    const durationEvidence = groupId ? allDurationSuggestions(scenario.nextState).find(item => item.groupId === groupId) : undefined
    const durationCapSuggestion = durationEvidence
      ? `近期 ${durationEvidence.sampleCount} 个有效样本平均 ${Math.round(durationEvidence.recentAverage)} 分钟；可在此方案中考虑一次性放宽，或另行预览永久上限调整。系统只提出建议，不会自动提高上限。`
      : ''
    issues.push({
      id: uid('issue'), type, title: conflict.label,
      detail: `${conflict.date}：当前 ${Math.round(conflict.current)}，允许 ${Math.round(conflict.limit)}。`,
      date: conflict.date, currentValue: String(conflict.current), allowedValue: String(conflict.limit),
      assignmentIds: conflict.affectedAssignmentIds,
      consequence: '当前规则下没有完全合法的放置方案。',
      resolution: [conflict.options.join('；'), durationCapSuggestion].filter(Boolean).join('；'),
      rawConstraintKey: conflict.key,
      suggestedLimit: conflict.suggestedLimit,
      conflictCategory: conflict.key === 'date-protection' || conflict.key === 'protected-buffer' ? 'protected-intent' : 'waivable-rule',
      allowedResolutions: todayIncoming
        ? ['accept-once', 'system-find-another-date', 'keep-original', 'change-capacity']
        : conflict.key === 'date-protection' || conflict.key === 'protected-buffer'
        ? ['accept-once', 'system-find-another-date', 'keep-original']
        : ['accept-once', 'system-find-another-date', 'leave-unscheduled'],
    })
  }
  const leaveUnscheduled = new Set(Array.isArray(event.metadata?.leaveUnscheduledIds) ? event.metadata?.leaveUnscheduledIds.filter((item): item is string => typeof item === 'string') : [])
  const unresolvedIds = scenario.nextState.assignments
    .filter(item => event.affectedAssignmentIds.includes(item.id) && !item.scheduledDate && !leaveUnscheduled.has(item.id))
    .map(item => item.id)
  if (unresolvedIds.length) issues.push({
    id: uid('issue'), type: 'unscheduled', title: '仍有任务未安排',
    detail: `${unresolvedIds.length} 项任务没有找到合法日期。`, assignmentIds: unresolvedIds,
    currentValue: String(unresolvedIds.length), allowedValue: '0',
    consequence: '这些任务不会被强行放入冲突日期。',
    resolution: '调整目标、容量、规则，接受明确的一次性例外，或继续保持未安排。',
  })
  return issues
}

function proposalMovements(before: AppState, afterState: AppState, scenario: ReplanResult): TaskMovement[] {
  const byId = new Map(before.assignments.map(item => [item.id, item]))
  return scenario.moves.map(move => {
    const beforeTask = byId.get(move.assignmentId)
    const afterTask = afterState.assignments.find(item => item.id === move.assignmentId)
    const goals = afterTask ? goalNamesForAssignment(afterState, afterTask) : []
    return {
      assignmentId: move.assignmentId,
      fromDate: move.from,
      toDate: move.to,
      reason: move.reason,
      beforeLoad: move.from ? planningDayLoad(before, move.from) : 0,
      afterLoad: move.to ? planningDayLoad(afterState, move.to) : 0,
      goalImpact: goals.length ? `关联目标：${goals.join('、')}` : '不直接关联目标',
      manualIntentImpact: beforeTask?.locked ? 'locked-blocked'
        : beforeTask?.intentStrength === 'manual' && move.from !== move.to ? 'moved-manual'
          : beforeTask?.intentStrength === 'manual' ? 'preserved' : 'none',
      rejectedAlternatives: (move.rejectedAlternatives ?? []).map(item => ({ date: item.date, reasons: item.reasons })),
    }
  })
}

function proposalDateChanges(before: AppState, afterState: AppState, scenario: ReplanResult, event: PlanChangeEvent): DateLoadChange[] {
  const dates = new Set<string>([
    ...event.affectedDates,
    ...scenario.loadChanges.map(item => item.date),
    ...scenario.moves.flatMap(item => [item.from, item.to].filter((date): date is string => Boolean(date))),
  ])
  return [...dates].sort().map(date => ({
    date,
    beforeMinutes: planningDayLoad(before, date),
    afterMinutes: planningDayLoad(afterState, date),
    beforeCapacity: getCapacity(before, date),
    afterCapacity: getCapacity(afterState, date),
    beforeTaskIds: before.assignments.filter(item => item.scheduledDate === date).map(item => item.id),
    afterTaskIds: afterState.assignments.filter(item => item.scheduledDate === date).map(item => item.id),
  })).filter(item => item.beforeMinutes !== item.afterMinutes || item.beforeCapacity !== item.afterCapacity || stableSignature(item.beforeTaskIds) !== stableSignature(item.afterTaskIds))
}

function proposalGoalImpacts(before: AppState, afterState: AppState): GoalImpact[] {
  const ids = new Set([...before.goals.map(goal => goal.id), ...afterState.goals.map(goal => goal.id)])
  return [...ids].flatMap(goalId => {
    const beforeGoal = before.goals.find(goal => goal.id === goalId)
    const afterGoal = afterState.goals.find(goal => goal.id === goalId)
    if (!beforeGoal && !afterGoal) return []
    const beforeProgress = beforeGoal ? goalProgress(before, beforeGoal) : undefined
    const afterProgress = afterGoal ? goalProgress(afterState, afterGoal) : undefined
    const changed = !beforeProgress || !afterProgress
      || beforeProgress.expectedCompletion !== afterProgress.expectedCompletion
      || beforeProgress.desiredRisk !== afterProgress.desiredRisk
      || beforeProgress.latestRisk !== afterProgress.latestRisk
      || Math.abs(beforeProgress.progress - afterProgress.progress) > 0.0001
    if (!changed) return []
    const title = afterGoal?.title ?? beforeGoal?.title ?? '目标'
    return [{
      goalId,
      beforeProgress: beforeProgress?.progress ?? 0,
      afterProgress: afterProgress?.progress ?? 0,
      beforeExpectedCompletion: beforeProgress?.expectedCompletion,
      afterExpectedCompletion: afterProgress?.expectedCompletion,
      desiredRiskBefore: beforeProgress?.desiredRisk ?? false,
      desiredRiskAfter: afterProgress?.desiredRisk ?? false,
      latestRiskBefore: beforeProgress?.latestRisk ?? false,
      latestRiskAfter: afterProgress?.latestRisk ?? false,
      summary: `${title}：预计完成 ${beforeProgress?.expectedCompletion ?? '未确定'} → ${afterProgress?.expectedCompletion ?? '未确定'}；最晚期限风险 ${beforeProgress?.latestRisk ? '有' : '无'} → ${afterProgress?.latestRisk ? '有' : '无'}。`,
    }]
  })
}


function textValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function structuralChanges(before: AppState, afterState: AppState): ProposalStructuralChange[] {
  const changes: ProposalStructuralChange[] = []
  const beforeGroups = new Map(before.taskGroups.map(item => [item.id, item]))
  const afterGroups = new Map(afterState.taskGroups.map(item => [item.id, item]))
  const add = (change: ProposalStructuralChange) => {
    if (change.changeType !== 'updated' || change.fields.length) changes.push(change)
  }
  const fields = (pairs: Array<[string, unknown, unknown]>) => pairs.flatMap(([label, oldValue, newValue]) => {
    const oldText = textValue(oldValue)
    const newText = textValue(newValue)
    return oldText === newText ? [] : [{ label, before: oldText, after: newText }]
  })

  const beforeAssignments = new Map(before.assignments.map(item => [item.id, item]))
  const afterAssignments = new Map(afterState.assignments.map(item => [item.id, item]))
  for (const id of new Set([...beforeAssignments.keys(), ...afterAssignments.keys()])) {
    const oldItem = beforeAssignments.get(id)
    const newItem = afterAssignments.get(id)
    if (!oldItem && newItem) continue // 新增任务已有独立且可展开的“新增任务”权威入口。
    if (oldItem && !newItem) {
      add({ entityType: 'assignment', entityId: id, title: oldItem.title, changeType: 'removed', fields: [
        { label: '原任务组', before: beforeGroups.get(oldItem.groupId)?.title ?? oldItem.groupId },
        { label: '原预计时长', before: `${oldItem.estimatedMinutes} 分钟` },
        { label: '原日期', before: oldItem.scheduledDate ?? '未安排' },
      ] })
      continue
    }
    if (!oldItem || !newItem) continue
    add({ entityType: 'assignment', entityId: id, title: newItem.title, changeType: 'updated', fields: fields([
      ['任务标题', oldItem.title, newItem.title],
      ['所属任务组', beforeGroups.get(oldItem.groupId)?.title ?? oldItem.groupId, afterGroups.get(newItem.groupId)?.title ?? newItem.groupId],
      ['预计时长', `${oldItem.estimatedMinutes} 分钟`, `${newItem.estimatedMinutes} 分钟`],
      ['是否自定义预计', Boolean(oldItem.durationCustomized || oldItem.manuallyEstimated), Boolean(newItem.durationCustomized || newItem.manuallyEstimated)],
      ['锁定状态', oldItem.locked, newItem.locked],
      ['用户安排保护', oldItem.intentStrength, newItem.intentStrength],
    ]) })
  }

  for (const id of new Set([...beforeGroups.keys(), ...afterGroups.keys()])) {
    const oldItem = beforeGroups.get(id)
    const newItem = afterGroups.get(id)
    if (!oldItem && newItem) {
      add({ entityType: 'task-group', entityId: id, title: newItem.title, changeType: 'added', fields: fields([
        ['科目／类别', undefined, newItem.subject], ['优先级', undefined, newItem.priority], ['任务数量', undefined, newItem.quantity],
        ['默认预计', undefined, `${newItem.unitMinutes} 分钟`], ['每日上限', undefined, newItem.dailyMax ?? '按类型默认'],
      ]) })
      continue
    }
    if (oldItem && !newItem) {
      add({ entityType: 'task-group', entityId: id, title: oldItem.title, changeType: 'removed', fields: [{ label: '任务组', before: oldItem.title }] })
      continue
    }
    if (!oldItem || !newItem) continue
    add({ entityType: 'task-group', entityId: id, title: newItem.title, changeType: 'updated', fields: fields([
      ['任务组名称', oldItem.title, newItem.title], ['科目／类别', oldItem.subject, newItem.subject], ['优先级', oldItem.priority, newItem.priority],
      ['任务数量', oldItem.quantity, newItem.quantity], ['默认预计', `${oldItem.unitMinutes} 分钟`, `${newItem.unitMinutes} 分钟`],
      ['每日上限', oldItem.dailyMax ?? '按类型默认', newItem.dailyMax ?? '按类型默认'], ['活动类型', oldItem.activityType ?? 'normal', newItem.activityType ?? 'normal'],
      ['高强度', Boolean(oldItem.highIntensity), Boolean(newItem.highIntensity)], ['计入统计', oldItem.countInStats, newItem.countInStats],
    ]) })
  }

  const conditionText = (goal: AppState['goals'][number]) => goal.completionConditions.map(condition => `${afterGroups.get(condition.groupId)?.title ?? beforeGroups.get(condition.groupId)?.title ?? condition.groupId}:${condition.mode}:${condition.value ?? ''}`).join('；')
  const beforeGoals = new Map(before.goals.map(item => [item.id, item]))
  const afterGoals = new Map(afterState.goals.map(item => [item.id, item]))
  for (const id of new Set([...beforeGoals.keys(), ...afterGoals.keys()])) {
    const oldItem = beforeGoals.get(id)
    const newItem = afterGoals.get(id)
    if (!oldItem && newItem) {
      add({ entityType: 'goal', entityId: id, title: newItem.title, changeType: 'added', fields: fields([
        ['期望日期', undefined, newItem.desiredDate ?? '未设置'], ['最晚日期', undefined, newItem.latestDate], ['优先级', undefined, newItem.priority], ['完成条件', undefined, conditionText(newItem)],
      ]) })
      continue
    }
    if (oldItem && !newItem) { add({ entityType: 'goal', entityId: id, title: oldItem.title, changeType: 'removed', fields: [{ label: '目标', before: oldItem.title }] }); continue }
    if (!oldItem || !newItem) continue
    add({ entityType: 'goal', entityId: id, title: newItem.title, changeType: 'updated', fields: fields([
      ['目标名称', oldItem.title, newItem.title], ['说明', oldItem.description, newItem.description], ['优先级', oldItem.priority, newItem.priority],
      ['期望日期', oldItem.desiredDate ?? '未设置', newItem.desiredDate ?? '未设置'], ['最晚日期', oldItem.latestDate, newItem.latestDate],
      ['完成条件', conditionText(oldItem), conditionText(newItem)], ['直接关联任务数', oldItem.linkedAssignmentIds.length, newItem.linkedAssignmentIds.length], ['状态', oldItem.status, newItem.status],
    ]) })
  }

  const beforeConstraints = new Map(before.calendarConstraints.map(item => [item.id, item]))
  const afterConstraints = new Map(afterState.calendarConstraints.map(item => [item.id, item]))
  for (const id of new Set([...beforeConstraints.keys(), ...afterConstraints.keys()])) {
    const oldItem = beforeConstraints.get(id)
    const newItem = afterConstraints.get(id)
    if (!oldItem && newItem) {
      add({ entityType: 'calendar-constraint', entityId: id, title: newItem.reason ?? `${newItem.startDate}－${newItem.endDate}`, changeType: 'added', fields: fields([
        ['日期范围', undefined, `${newItem.startDate}－${newItem.endDate}`], ['类型', undefined, newItem.kind], ['容量', undefined, newItem.capacityMinutes != null ? `${newItem.capacityMinutes} 分钟` : undefined], ['日期保护', undefined, newItem.protected],
      ]) })
      continue
    }
    if (oldItem && !newItem) { add({ entityType: 'calendar-constraint', entityId: id, title: oldItem.reason ?? `${oldItem.startDate}－${oldItem.endDate}`, changeType: 'removed', fields: [{ label: '原日期范围', before: `${oldItem.startDate}－${oldItem.endDate}` }] }); continue }
    if (!oldItem || !newItem) continue
    add({ entityType: 'calendar-constraint', entityId: id, title: newItem.reason ?? `${newItem.startDate}－${newItem.endDate}`, changeType: 'updated', fields: fields([
      ['日期范围', `${oldItem.startDate}－${oldItem.endDate}`, `${newItem.startDate}－${newItem.endDate}`], ['类型', oldItem.kind, newItem.kind],
      ['容量', oldItem.capacityMinutes != null ? `${oldItem.capacityMinutes} 分钟` : undefined, newItem.capacityMinutes != null ? `${newItem.capacityMinutes} 分钟` : undefined],
      ['日期保护', oldItem.protected, newItem.protected], ['原因', oldItem.reason, newItem.reason],
    ]) })
  }

  const settingFields = fields([
    ['计划开始', before.settings.startDate, afterState.settings.startDate], ['计划结束', before.settings.endDate, afterState.settings.endDate],
    ['常规日容量', `${before.settings.regularMinutes} 分钟`, `${afterState.settings.regularMinutes} 分钟`], ['学习日容量', `${before.settings.studyMinutes} 分钟`, `${afterState.settings.studyMinutes} 分钟`],
    ['旅游日容量', `${before.settings.travelMinutes} 分钟`, `${afterState.settings.travelMinutes} 分钟`], ['目标利用率', before.settings.targetUtilization, afterState.settings.targetUtilization],
  ])
  if (settingFields.length) add({ entityType: 'settings', entityId: 'settings', title: '计划设置', changeType: 'updated', fields: settingFields })
  return changes
}

function proposalMetrics(before: AppState, afterState: AppState, event: PlanChangeEvent, issues: ProposalIssue[], movements: TaskMovement[], dates: DateLoadChange[], goals: GoalImpact[]) {
  const existingBefore = before.assignments.filter(item => item.scheduledDate)
  const retained = existingBefore.filter(item => afterState.assignments.find(next => next.id === item.id)?.scheduledDate === item.scheduledDate).length
  const beforeLoads = dateRange(before.settings.startDate, before.settings.endDate).map(date => planningDayLoad(before, date))
  const afterLoads = dateRange(afterState.settings.startDate, afterState.settings.endDate).map(date => planningDayLoad(afterState, date))
  const manualMoves = movements.filter(item => item.manualIntentImpact === 'moved-manual').length
  const protectedUse = movements.filter(item => item.toDate && isDateProtected(afterState, item.toDate)).length
  const moveDistance = movements.reduce((sum, item) => {
    if (!item.fromDate || !item.toDate) return sum + 1
    return sum + Math.abs(differenceInCalendarDays(parseISO(item.toDate), parseISO(item.fromDate)))
  }, 0)
  const loadDeltaHours = dates.reduce((sum, item) => sum + Math.abs(item.afterMinutes - item.beforeMinutes), 0) / 60
  const introducedGoalRisk = goals.filter(item => (!item.latestRiskBefore && item.latestRiskAfter) || (!item.desiredRiskBefore && item.desiredRiskAfter)).length
  const disturbance = movements.length * 5 + Math.min(25, moveDistance * 1.5) + manualMoves * 22 + dates.length * 2 + protectedUse * 15 + Math.min(15, loadDeltaHours * 1.5) + introducedGoalRisk * 20
  const stabilityScore = Math.max(0, Math.round(100 - disturbance))
  const impactLevel = movements.length > 12 || dates.length > 7 || manualMoves > 0 || introducedGoalRisk > 0 ? 'large' : movements.length > 4 || dates.length > 3 ? 'medium' : 'small'
  return {
    newTaskCount: event.type === 'new-task-insertion' || event.type === 'task-group-size-increase' ? event.affectedAssignmentIds.length : 0,
    movedTaskCount: movements.length,
    affectedDateCount: dates.length,
    issueCount: issues.length,
    manualTaskMoveCount: manualMoves,
    protectedDateUseCount: protectedUse,
    beforeAverageLoad: beforeLoads.length ? beforeLoads.reduce((sum, value) => sum + value, 0) / beforeLoads.length : 0,
    afterAverageLoad: afterLoads.length ? afterLoads.reduce((sum, value) => sum + value, 0) / afterLoads.length : 0,
    beforeMaxLoad: Math.max(0, ...beforeLoads),
    afterMaxLoad: Math.max(0, ...afterLoads),
    originalDateRetention: existingBefore.length ? retained / existingBefore.length : 1,
    stabilityScore,
    impactLevel: impactLevel as 'small' | 'medium' | 'large',
  }
}


function exceptionsFromConflicts(conflicts: ReplanConstraintConflict[]): ConstraintException[] {
  const result: ConstraintException[] = []
  for (const conflict of conflicts) {
    const todayIncoming = isTodayIncomingConstraint(conflict.key)
    const supported = todayIncoming || conflict.key === 'capacity' || conflict.key.startsWith('group:') || conflict.key.startsWith('activity:')
      || conflict.key === 'long' || conflict.key === 'high-intensity'
      || conflict.key === 'date-protection' || conflict.key === 'protected-buffer'
    if (!supported) continue
    const protectedDate = conflict.key === 'date-protection' || conflict.key === 'protected-buffer'
    result.push({
      date: conflict.date,
      key: todayIncoming ? 'capacity' : rawConstraintKey(conflict.key),
      rawKey: todayIncoming ? 'today-extra' : conflict.key,
      label: todayIncoming
        ? `${conflict.label}：仅本次允许列出的任务进入今天`
        : protectedDate ? `${conflict.label}：本次明确允许使用` : `${conflict.label}：本次由 ${Math.round(conflict.limit)} 放宽到 ${Math.round(conflict.suggestedLimit)}`,
      permanent: false,
      currentLimit: conflict.limit,
      overrideLimit: protectedDate || todayIncoming ? undefined : conflict.suggestedLimit,
      affectedAssignmentIds: [...conflict.affectedAssignmentIds],
    })
  }
  return mergeConstraintExceptions(result)
}


function exceptionUsedByResult(state: AppState, exception: ConstraintException, movements: TaskMovement[]) {
  const rawKey = exception.rawKey ?? exception.key
  if (isTodayIncomingConstraint(rawKey)) {
    const scoped = new Set(exception.affectedAssignmentIds ?? [])
    return movements.some(move => {
      if (scoped.size && !scoped.has(move.assignmentId)) return false
      return move.toDate === exception.date && move.fromDate !== move.toDate
    })
  }
  if (exception.key === 'date-protection' || rawKey === 'date-protection' || rawKey === 'protected-buffer' || rawKey === 'source-date-protection') {
    const scoped = new Set(exception.affectedAssignmentIds ?? [])
    return movements.some(move => {
      if (scoped.size && !scoped.has(move.assignmentId)) return false
      return rawKey === 'source-date-protection'
        ? move.fromDate === exception.date && move.fromDate !== move.toDate
        : move.toDate === exception.date && move.fromDate !== move.toDate
    })
  }
  if (exception.overrideLimit == null) return false
  const base = baseLimitForRawKey(state, exception.date, rawKey)
  if (base == null) return false
  return currentUseForRawLimit(state, exception.date, rawKey) > base
}

function proposalFromScenario(
  baseline: AppState,
  input: AppState,
  event: PlanChangeEvent,
  bundleIssues: string[],
  scenario: ReplanResult,
  exceptions: ConstraintException[] = [],
): SchedulingProposal {
  const afterState = scenario.nextState
  const issues = proposalIssuesFromScenario(event, bundleIssues, scenario)
  const movements = proposalMovements(baseline, afterState, scenario)
  const dateChanges = proposalDateChanges(baseline, afterState, scenario, event)
  const goalImpacts = proposalGoalImpacts(baseline, afterState)
  for (const impact of goalImpacts.filter(item => (!item.latestRiskBefore && item.latestRiskAfter) || (!item.desiredRiskBefore && item.desiredRiskAfter))) {
    const goal = afterState.goals.find(item => item.id === impact.goalId) ?? baseline.goals.find(item => item.id === impact.goalId)
    issues.push({
      id: uid('issue'), type: 'goal-risk', title: `目标风险：${goal?.title ?? impact.goalId}`,
      detail: impact.summary, goalId: impact.goalId,
      assignmentIds: goal ? goalProgress(afterState, goal).remainingAssignmentIds : [],
      consequence: impact.latestRiskAfter ? '按当前候选，最晚完成条件仍可能无法满足。' : '按当前候选，期望完成日期可能无法满足。',
      resolution: '比较其他方案，增加可用时间，放宽完成条件，或调整目标日期；系统不会自动降低目标重要性。',
    })
  }
  const nonDateChanges = structuralChanges(baseline, afterState)
  const excludedDates = movements.flatMap(item => item.rejectedAlternatives)
  let effectiveExceptions = mergeConstraintExceptions(exceptions.filter(item => exceptionUsedByResult(afterState, item, movements)))
  const addEffectiveException = (item: ConstraintException) => { effectiveExceptions = mergeConstraintExceptions([...effectiveExceptions, item]) }
  const availabilitySourceDates = event.type === 'availability-change' ? new Set(event.affectedDates) : new Set<string>()
  for (const move of movements) {
    if (move.fromDate && move.fromDate !== move.toDate && isDateProtected(baseline, move.fromDate) && !availabilitySourceDates.has(move.fromDate)) {
      addEffectiveException({
        date: move.fromDate, key: 'date-protection', rawKey: 'source-date-protection', permanent: false,
        label: `从受保护日期 ${move.fromDate} 移出任务：仅本次明确允许`,
        affectedAssignmentIds: [move.assignmentId],
      })
    }
    if (move.toDate && move.fromDate !== move.toDate && isDateProtected(afterState, move.toDate)) {
      addEffectiveException({
        date: move.toDate, key: 'date-protection', rawKey: 'date-protection', permanent: false,
        label: `使用受保护日期 ${move.toDate}：仅本次明确允许`,
        affectedAssignmentIds: [move.assignmentId],
      })
    }
  }

  // A preferred/locked draft may already contain an illegal date and therefore never enter
  // the movable-candidate loop. Compare the resulting hard dangers against the baseline so
  // a proposal cannot look valid merely because the engine correctly refused to move it.
  const analysisState = cloneActiveState(afterState)
  const acceptedAt = new Date().toISOString()
  analysisState.acceptedConstraintExceptions = [
    ...grandfatheredAcceptedExceptions(baseline),
    ...effectiveExceptions.map(item => ({ ...item, id: uid('preview-exception'), eventId: event.id, accepted: true as const, createdAt: acceptedAt })),
  ]
  const analysisFrom = proposalPlanningStart(afterState, event)
  const newDangers = worsenedHardConstraintFacts(baseline, analysisState, analysisFrom)
  for (const danger of newDangers) issues.push(issueFromHardConstraintFact(danger, '草稿仍产生新的硬冲突'))
  const protectedMoveViolations = movements.filter(move => move.toDate && move.fromDate !== move.toDate && isDateProtected(afterState, move.toDate)
    && !effectiveExceptions.some(item => item.date === move.toDate && item.key === 'date-protection'))
  for (const move of protectedMoveViolations) issues.push({
    id: uid('issue'), type: 'date-protection', title: '候选会使用受保护日期',
    detail: `${move.toDate} 是受保护日期，但本候选没有列出并确认一次性例外。`, date: move.toDate,
    assignmentIds: [move.assignmentId], consequence: '会破坏用户明确设置的日期保护。',
    resolution: '改选其他日期，或使用明确标记并由用户确认的一次性日期保护例外。',
  })

  const metrics = proposalMetrics(baseline, afterState, event, issues, movements, dateChanges, goalImpacts)
  const signature = stableSignature({
    moves: movements.map(item => [item.assignmentId, item.toDate]),
    dates: dateChanges.map(item => [item.date, item.afterMinutes]),
    goals: goalImpacts.map(item => [item.goalId, item.afterExpectedCompletion, item.latestRiskAfter]),
    structural: nonDateChanges.map(item => [item.entityType, item.entityId, item.changeType, item.fields]),
    exceptions: effectiveExceptions.map(item => [item.date, item.rawKey, item.overrideLimit]),
  })
  const leaveUnscheduled = new Set(Array.isArray(event.metadata?.leaveUnscheduledIds) ? event.metadata?.leaveUnscheduledIds.filter((item): item is string => typeof item === 'string') : [])
  const unresolved = afterState.assignments.filter(item => event.affectedAssignmentIds.includes(item.id) && !item.scheduledDate && !leaveUnscheduled.has(item.id))
  const infeasibleReasons: string[] = []
  if (unresolved.length) infeasibleReasons.push(`${unresolved.length} 项任务在当前硬约束下没有合法日期，系统未强行安排。`)
  if (newDangers.length) infeasibleReasons.push(`本候选会新增 ${newDangers.length} 个硬冲突。`)
  if (protectedMoveViolations.length) infeasibleReasons.push(`本候选会未经确认使用 ${protectedMoveViolations.length} 个受保护日期。`)
  return {
    id: uid('proposal'), eventId: event.id,
    title: effectiveExceptions.length ? `${scenario.title} · 明确一次性例外` : scenario.title,
    description: effectiveExceptions.length
      ? `${scenario.description} 本候选只在所列日期使用明确的一次性例外，不修改任务组或全局永久默认值。`
      : scenario.description,
    action: event.action,
    preference: scenario.strategy,
    generatedAt: new Date().toISOString(),
    stateBefore: portableState(baseline),
    stateAfter: portableState(afterState),
    issues,
    movements,
    dateChanges,
    goalImpacts,
    structuralChanges: nonDateChanges,
    exceptions: effectiveExceptions,
    excludedDates,
    metrics,
    distinctSignature: signature,
    infeasible: infeasibleReasons.length > 0,
    infeasibleReason: infeasibleReasons.join(' '),
  }
}


function directIssueType(key: string): ProposalIssue['type'] {
  if (key === 'capacity' || key === 'today-extra' || key === 'today-closed' || key === 'travel-day' || key === 'buffer-high-intensity' || key === 'buffer-long-task') return 'capacity'
  if (key.startsWith('group:')) return 'group-daily-max'
  if (key.startsWith('activity:')) return 'activity-daily-max'
  if (key === 'long') return 'long-task-max'
  if (key === 'high-intensity') return 'high-intensity-max'
  if (key === 'date-protection' || key === 'protected-buffer') return 'date-protection'
  if (key === 'past' || key === 'plan-range') return 'past-freeze'
  if (key === 'goal-latest') return 'goal-risk'
  return 'unscheduled'
}

function issueFromHardConstraintFact(fact: HardConstraintFact, title: string): ProposalIssue {
  const waivable = fact.key === 'capacity' || fact.key.startsWith('group:') || fact.key.startsWith('activity:') || fact.key === 'long' || fact.key === 'high-intensity'
  const goal = fact.key === 'goal-latest'
  return {
    id: uid('issue'), type: directIssueType(fact.key), title, detail: fact.message, date: fact.date,
    currentValue: String(Math.round(fact.current)), allowedValue: String(Math.round(fact.limit)),
    assignmentIds: [...fact.adjustableAssignmentIds], rawConstraintKey: fact.key,
    suggestedLimit: waivable ? fact.current : undefined,
    consequence: '只有仍未完成、仍可调整的任务需要处理；已经完成的真实记录保持不变。',
    resolution: waivable
      ? '可仅本次接受最小范围例外、只让系统为涉及任务换日，或明确暂不安排。'
      : goal
        ? '修改任务日期、保留为未安排，或返回调整目标定义。'
        : '仅调整涉及的未完成任务，或返回修改相关条件。',
    conflictCategory: waivable ? 'waivable-rule' : 'structural-conflict',
    allowedResolutions: waivable
      ? ['accept-once', 'system-find-another-date', 'leave-unscheduled']
      : goal
        ? ['system-find-another-date', 'leave-unscheduled', 'change-goal', 'cancel-change']
        : ['system-find-another-date', 'leave-unscheduled', 'change-capacity', 'cancel-change'],
  }
}

/**
 * 对“用户已经明确指定结果”或“默认保持日期”的变化生成精确预览。
 * 此函数不重新选择日期，只检查准备态相对当前正式计划新增了哪些硬冲突。
 */
export function previewPreparedChange(
  baseline: AppState,
  preparedState: AppState,
  event: PlanChangeEvent,
  title = '按当前选择执行',
  acceptedExceptions: ConstraintException[] = [],
): SchedulingProposal {
  const beforeById = new Map(baseline.assignments.map(item => [item.id, item]))
  const afterById = new Map(preparedState.assignments.map(item => [item.id, item]))
  const groups = groupMap(preparedState)
  const changed = [...new Set([...beforeById.keys(), ...afterById.keys()])].flatMap(id => {
    const oldItem = beforeById.get(id)
    const newItem = afterById.get(id)
    if (!oldItem || !newItem || oldItem.scheduledDate === newItem.scheduledDate) return []
    return [{ oldItem, newItem }]
  })
  const movements: TaskMovement[] = changed.map(({ oldItem, newItem }) => ({
    assignmentId: newItem.id,
    fromDate: oldItem.scheduledDate,
    toDate: newItem.scheduledDate,
    reason: event.type === 'execution-difference'
      ? '按用户在复盘中逐项选择的日期执行；系统只负责完整校验。'
      : event.type === 'bulk-move'
        ? '按用户指定的批量目标日期执行；系统只负责完整校验。'
        : '保持当前准备态中的明确日期变化。',
    beforeLoad: oldItem.scheduledDate ? planningDayLoad(baseline, oldItem.scheduledDate) : 0,
    afterLoad: newItem.scheduledDate ? planningDayLoad(preparedState, newItem.scheduledDate) : 0,
    goalImpact: goalNamesForAssignment(preparedState, newItem).length
      ? `关联目标：${goalNamesForAssignment(preparedState, newItem).join('、')}`
      : '不直接关联目标',
    manualIntentImpact: oldItem.locked ? 'locked-blocked'
      : oldItem.intentStrength === 'manual' && oldItem.scheduledDate !== newItem.scheduledDate ? 'moved-manual'
        : oldItem.intentStrength === 'manual' ? 'preserved' : 'none',
    rejectedAlternatives: [],
  }))
  const changedDates = new Set<string>(event.affectedDates)
  for (const move of movements) {
    if (move.fromDate) changedDates.add(move.fromDate)
    if (move.toDate) changedDates.add(move.toDate)
  }
  const dateChanges: DateLoadChange[] = [...changedDates].sort().map(date => ({
    date,
    beforeMinutes: planningDayLoad(baseline, date),
    afterMinutes: planningDayLoad(preparedState, date),
    beforeCapacity: getCapacity(baseline, date),
    afterCapacity: getCapacity(preparedState, date),
    beforeTaskIds: baseline.assignments.filter(item => item.scheduledDate === date).map(item => item.id),
    afterTaskIds: preparedState.assignments.filter(item => item.scheduledDate === date).map(item => item.id),
  })).filter(item => item.beforeMinutes !== item.afterMinutes || item.beforeCapacity !== item.afterCapacity || stableSignature(item.beforeTaskIds) !== stableSignature(item.afterTaskIds))

  const issuesByKey = new Map<string, ProposalIssue>()
  const addIssue = (signature: string, issue: ProposalIssue) => {
    const existing = issuesByKey.get(signature)
    if (!existing) { issuesByKey.set(signature, issue); return }
    existing.assignmentIds = Array.from(new Set([...existing.assignmentIds, ...issue.assignmentIds]))
  }
  const today = todayISO()
  const mergedAcceptedExceptions = mergeConstraintExceptions(acceptedExceptions)
  const request: ReplanRequest = {
    mode: 'repair', fromDate: today,
    todayExtraMinutes: Number(event.metadata?.todayExtraMinutes ?? 0),
    allowTodayIncomingAssignments: todayIncomingAssignmentIds(mergedAcceptedExceptions),
    allowBufferUseDates: mergedAcceptedExceptions
      .filter(item => item.key === 'date-protection' && !item.affectedAssignmentIds?.length && item.rawKey !== 'source-date-protection')
      .map(item => item.date),
    allowProtectedDateAssignments: mergedAcceptedExceptions
      .filter(item => item.key === 'date-protection' && item.affectedAssignmentIds?.length && item.rawKey !== 'source-date-protection')
      .map(item => ({ date: item.date, assignmentIds: [...(item.affectedAssignmentIds ?? [])] })),
    limitOverrides: [
      ...grandfatheredLimitOverrides(baseline),
      ...mergedAcceptedExceptions.flatMap(item => item.overrideLimit == null ? [] : [{
        date: item.date,
        key: item.rawKey ?? item.key,
        limit: item.overrideLimit,
        affectedAssignmentIds: item.affectedAssignmentIds ? [...item.affectedAssignmentIds] : undefined,
      }]),
    ],
    event,
  }
  for (const { oldItem, newItem } of changed) {
    const assignmentIds = [newItem.id]
    const oldDateIsPast = Boolean(oldItem.scheduledDate && before(oldItem.scheduledDate, today))
    const newDateIsPast = Boolean(newItem.scheduledDate && before(newItem.scheduledDate, today))
    const explicitlyMovesPastUnfinishedOut = Boolean(
      oldDateIsPast
      && oldItem.status !== 'done'
      && !oldItem.locked
      && baseline.timer.assignmentId !== oldItem.id
      && (!newItem.scheduledDate || !newDateIsPast)
      && event.affectedAssignmentIds.includes(newItem.id)
      && (event.type === 'execution-difference' || event.type === 'bulk-move')
    )
    const availabilitySourceChange = event.type === 'availability-change' && oldItem.scheduledDate && event.affectedDates.includes(oldItem.scheduledDate)
    const acceptedSourceProtection = Boolean(oldItem.scheduledDate && mergedAcceptedExceptions.some(item =>
      item.rawKey === 'source-date-protection' && item.date === oldItem.scheduledDate
      && (!item.affectedAssignmentIds?.length || item.affectedAssignmentIds.includes(newItem.id))))
    if (oldItem.scheduledDate && oldItem.scheduledDate !== newItem.scheduledDate && isDateProtected(baseline, oldItem.scheduledDate)
      && !availabilitySourceChange && !explicitlyMovesPastUnfinishedOut && !acceptedSourceProtection) addIssue(`source-protected:${oldItem.scheduledDate}:${newItem.id}`, {
      id: uid('issue'), type: 'date-protection', title: '原日期受到保护',
      detail: `“${oldItem.title}”当前位于受保护日期 ${oldItem.scheduledDate}，移出也需要你的明确授权。`,
      date: oldItem.scheduledDate, assignmentIds, consequence: '会改变用户明确保护的日期内容。',
      resolution: '只对这项任务接受一次性移出授权，或保留原日期。', rawConstraintKey: 'source-date-protection',
      conflictCategory: 'protected-intent', allowedResolutions: ['accept-once', 'keep-original', 'cancel-change'],
    })
    if (oldItem.status === 'done') addIssue(`done:${newItem.id}`, {
      id: uid('issue'), type: 'task-lock', title: '已完成任务不能改期', detail: `“${oldItem.title}”已经完成，计划调整不能改写其日期。`,
      assignmentIds, consequence: '会破坏真实执行历史。', resolution: '保持原日期；如需修正记录，应从任务详情单独处理。',
      rawConstraintKey: 'completed-history', conflictCategory: 'absolute-blocker', allowedResolutions: ['keep-original', 'cancel-change'],
    })
    if (oldItem.locked) addIssue(`locked:${newItem.id}`, {
      id: uid('issue'), type: 'task-lock', title: '任务已锁定', detail: `“${oldItem.title}”已锁定，不能移动到 ${newItem.scheduledDate ?? '未安排'}。`,
      assignmentIds, consequence: '会违背用户明确锁定。', resolution: '保持原日期，或先由用户主动解除锁定。',
      rawConstraintKey: 'task-lock', conflictCategory: 'protected-intent', allowedResolutions: ['keep-original', 'unlock-and-move', 'cancel-change'],
    })
    if (baseline.timer.assignmentId === newItem.id) addIssue(`timer:${newItem.id}`, {
      id: uid('issue'), type: 'active-timer', title: '正在计时的任务不能移动', detail: `“${oldItem.title}”正在计时。`,
      assignmentIds, consequence: '会破坏当前执行上下文。', resolution: '结束或暂停计时后再调整。',
      rawConstraintKey: 'active-timer', conflictCategory: 'absolute-blocker', allowedResolutions: ['keep-original', 'cancel-change'],
    })
    // 过去日期冻结的是已经发生的执行事实，而不是把未完成任务永远困在过去。
    // 用户在复盘或待处理任务中明确选择顺延时，允许把过去未完成任务移到今天/未来，
    // 或暂时取消日期；但仍禁止把任务移入过去、改写已完成记录、锁定任务或计时任务。
    if (newDateIsPast || (oldDateIsPast && !explicitlyMovesPastUnfinishedOut)) addIssue(`past:${newItem.id}`, {
      id: uid('issue'), type: 'past-freeze', title: newDateIsPast ? '不能把任务安排到过去' : '过去日期已冻结',
      detail: newDateIsPast
        ? `“${oldItem.title}”不能移动到过去日期 ${newItem.scheduledDate}。`
        : `“${oldItem.title}”的变化会改写已经冻结的过去记录。`,
      assignmentIds,
      consequence: newDateIsPast ? '过去日期不能接收新的计划任务。' : '会改写历史计划。',
      resolution: newDateIsPast ? '请选择今天或未来日期。' : '保留过去记录，只调整仍未完成且可移动的任务。',
      rawConstraintKey: 'past', conflictCategory: 'absolute-blocker', allowedResolutions: ['keep-original', 'cancel-change'],
    })
    if (!newItem.scheduledDate) continue
    const group = groups.get(newItem.groupId)
    if (!group) continue
    const stats = statsMap(preparedState, new Set([newItem.id]))
    for (const violation of validatePlacement(preparedState, stats, newItem, group, newItem.scheduledDate, request, oldItem.scheduledDate)) {
      if (!violation.hard) continue
      const type = directIssueType(violation.key)
      const signature = `${newItem.scheduledDate}:${violation.key}`
      const todayIncoming = isTodayIncomingConstraint(violation.key)
      addIssue(signature, {
        id: uid('issue'), type, title: violation.label,
        detail: `${newItem.scheduledDate}：调整后 ${Math.round(violation.current)}，允许 ${Math.round(violation.limit)}。`,
        date: newItem.scheduledDate, groupId: violation.key.startsWith('group:') ? newItem.groupId : undefined,
        currentValue: String(Math.round(violation.current)), allowedValue: String(Math.round(violation.limit)), assignmentIds,
        consequence: '按当前选择直接执行会产生新的硬冲突。',
        resolution: '只修改这项冲突选择，或让系统为冲突项生成替代日期；其他合法选择保持不变。',
        rawConstraintKey: violation.key,
        suggestedLimit: violation.current,
        conflictCategory: todayIncoming ? 'waivable-rule' : violation.key === 'date-protection' || violation.key === 'protected-buffer' ? 'protected-intent'
          : violation.key === 'capacity' || violation.key.startsWith('group:') || violation.key.startsWith('activity:') || violation.key === 'long' || violation.key === 'high-intensity' ? 'waivable-rule'
            : violation.key === 'past' || violation.key === 'plan-range' ? 'absolute-blocker' : 'structural-conflict',
        allowedResolutions: todayIncoming
          ? ['accept-once', 'system-find-another-date', 'keep-original', 'change-capacity']
          : violation.key === 'date-protection' || violation.key === 'protected-buffer'
          ? ['accept-once', 'system-find-another-date', 'keep-original']
          : violation.key === 'capacity' || violation.key.startsWith('group:') || violation.key.startsWith('activity:') || violation.key === 'long' || violation.key === 'high-intensity'
            ? ['accept-once', 'system-find-another-date', 'leave-unscheduled']
            : violation.key === 'past' || violation.key === 'plan-range'
              ? ['keep-original', 'cancel-change']
              : ['system-find-another-date', 'keep-original', 'change-capacity', 'cancel-change'],
      })
    }
  }

  // 预计时长、容量和规则变化可能没有移动日期，但仍可能让现有日期新增硬冲突。
  const fromDate = proposalPlanningStart(preparedState, event)
  const analysisPreparedState = cloneActiveState(preparedState)
  analysisPreparedState.acceptedConstraintExceptions = [
    ...grandfatheredAcceptedExceptions(baseline),
    ...mergedAcceptedExceptions.map(item => ({
      ...item, id: uid('preview-exception'), eventId: event.id, accepted: true as const, createdAt: new Date().toISOString(),
    })),
  ]
  const specificallyValidatedDates = new Set([...issuesByKey.values()].flatMap(item => item.date ? [item.date] : []))
  for (const danger of worsenedHardConstraintFacts(baseline, analysisPreparedState, fromDate)) {
    if (danger.date && specificallyValidatedDates.has(danger.date)) continue
    addIssue(`analysis:${danger.id}`, issueFromHardConstraintFact(danger, '变化后出现新的硬冲突'))
  }

  const issues = [...issuesByKey.values()]
  const issueDelta = hardConstraintIssueDelta(baseline, analysisPreparedState, fromDate)
  const effectiveAcceptedExceptions = mergeConstraintExceptions(mergedAcceptedExceptions.filter(item => exceptionUsedByResult(preparedState, item, movements)))
  const goalImpacts = proposalGoalImpacts(baseline, preparedState)
  const nonDateChanges = structuralChanges(baseline, preparedState)
  const metrics = proposalMetrics(baseline, preparedState, event, issues, movements, dateChanges, goalImpacts)
  const signature = stableSignature({
    direct: true,
    moves: movements.map(item => [item.assignmentId, item.toDate]),
    dates: dateChanges.map(item => [item.date, item.afterMinutes]),
    structural: nonDateChanges.map(item => [item.entityType, item.entityId, item.changeType, item.fields]),
    issues: issues.map(item => [item.type, item.date, item.assignmentIds]),
    exceptions: effectiveAcceptedExceptions.map(item => [item.date, item.rawKey ?? item.key, item.overrideLimit, item.affectedAssignmentIds]),
  })
  return {
    id: uid('proposal'), eventId: event.id, title,
    description: issues.length
      ? `已按用户明确选择生成精确预览；发现 ${issues.length} 个需要先处理的问题，系统没有重新决定其他合法项。`
      : '已按用户明确选择完成全部约束校验；应用后只执行预览中列出的变化。',
    action: event.action, preference: 'preserve', generatedAt: new Date().toISOString(),
    stateBefore: portableState(baseline), stateAfter: portableState(preparedState),
    issues, movements, dateChanges, goalImpacts, structuralChanges: nonDateChanges,
    exceptions: effectiveAcceptedExceptions, excludedDates: [], metrics, issueDelta, distinctSignature: signature,
    infeasible: issues.length > 0,
    infeasibleReason: issues.length ? `当前选择中有 ${issues.length} 个硬冲突；合法项不会被重新重排。` : undefined,
  }
}

export interface GenerateProposalOptions {
  baseline?: AppState
  preferences?: SchedulingPreference[]
  signal?: AbortSignal
  todayExtraMinutes?: number
  allowProtectedDates?: string[]
  /** 用户逐项接受的一次性例外；只作用于本轮重新计算。 */
  acceptedExceptions?: ConstraintException[]
  /** 逐项决策重算时不再自动打包所有未接受例外。 */
  disableAutomaticExceptions?: boolean
  /** 生成更多方案时逐步扩大候选半径；0 为默认，1/2 为更宽但仍受同一硬约束。 */
  expansionLevel?: number
}

/**
 * 事件中的日期是“约束/目标发生在哪一天”，不等于调度只能从那一天开始。
 * 目标提前到 8 月 6 日时，需要利用今天起的全部未来容量，而不是到 8 月 6 日才开始排。
 */
function proposalPlanningStart(state: AppState, event: PlanChangeEvent): string {
  // 事件日期只是目标、行程或原安排的位置。候选窗口仍从今天的未来开始：
  // 这样 8/10–8/15 的旅行既可把任务提前到旅行前，也可顺延到旅行后；
  // “偏好某日”的新任务仍由手动意图评分优先保留原日，而不是禁止更早的合法替代日。
  const today = todayISO()
  const requested = typeof event.metadata?.fromDate === 'string' ? event.metadata.fromDate : today
  if (before(requested, state.settings.startDate)) return state.settings.startDate
  if (after(requested, state.settings.endDate)) return state.settings.endDate
  return requested
}

/**
 * v0.8 统一方案入口。事件说明“为什么变”，action 说明计算范围，preference 说明取舍。
 * 继续复用 v0.7 经验证的同一约束/候选核心，不再创建第二套重排算法。
 */
export function generateSchedulingProposals(input: AppState, event: PlanChangeEvent, options: GenerateProposalOptions = {}): SchedulingProposal[] {
  if (options.signal?.aborted) return []
  const baseline = options.baseline ?? input
  const mode: ReplanMode = event.action === 'optimize' || event.action === 'rebuild' ? 'full' : 'repair'
  const fromDate = proposalPlanningStart(input, event)
  const rawLoadConstraints = event.metadata?.loadConstraints
  const loadConstraints = rawLoadConstraints && typeof rawLoadConstraints === 'object'
    ? rawLoadConstraints as ReplanRequest['loadConstraints']
    : undefined
  const request: ReplanRequest = {
    mode,
    fromDate,
    freezeDays: input.settings.freezeDays,
    includeToday: event.metadata?.includeToday === true,
    todayExtraMinutes: options.todayExtraMinutes ?? Number(event.metadata?.todayExtraMinutes ?? 0),
    allowTodayIncomingAssignments: todayIncomingAssignmentIds(options.acceptedExceptions ?? []),
    // Earlier accepted date-protection exceptions are audit records, not standing permission for future changes.
    allowBufferUseDates: Array.from(new Set(options.allowProtectedDates ?? [])),
    allowProtectedDateAssignments: (options.acceptedExceptions ?? [])
      .filter(item => item.key === 'date-protection' && item.affectedAssignmentIds?.length)
      .map(item => ({ date: item.date, assignmentIds: [...(item.affectedAssignmentIds ?? [])] })),
    limitOverrides: [
      ...grandfatheredLimitOverrides(baseline),
      ...(options.acceptedExceptions ?? []).flatMap(item => item.overrideLimit == null ? [] : [{ date: item.date, key: item.rawKey ?? item.key, limit: item.overrideLimit, affectedAssignmentIds: item.affectedAssignmentIds ? [...item.affectedAssignmentIds] : undefined }]),
    ],
    localRadius: (() => {
      const level = Math.max(0, Math.min(2, Math.round(options.expansionLevel ?? 0)))
      const base = input.settings.localRepairRadius
      if (event.action === 'rebuild') return Math.max(14, base * (level + 1))
      if (level === 1) return Math.max(7, base * 2)
      if (level === 2) return Math.max(14, base * 3)
      return base
    })(),
    affectedAssignmentIds: event.affectedAssignmentIds,
    loadConstraints,
    event,
    explanationLevel: (options.expansionLevel ?? 0) >= 2 ? 'full' : 'summary',
  }
  const metadataPreferences = Array.isArray(event.metadata?.preferredPreferences) ? event.metadata?.preferredPreferences.filter((item): item is SchedulingPreference => ['preserve', 'balanced', 'goal', 'rest'].includes(String(item))) : undefined
  const preferred = options.preferences ?? (metadataPreferences?.length ? metadataPreferences : ['preserve', 'balanced', 'goal', 'rest'])
  const bundle = generateReplanBundle(input, request, preferred)
  const proposals: SchedulingProposal[] = []
  const signatures = new Set<string>()
  const append = (proposal: SchedulingProposal) => {
    if (signatures.has(proposal.distinctSignature)) return
    signatures.add(proposal.distinctSignature)
    proposals.push(proposal)
  }
  for (const preference of preferred) {
    if (options.signal?.aborted) break
    const scenario = bundle.scenarios.find(item => item.strategy === preference)
    if (!scenario) continue
    append(proposalFromScenario(baseline, input, event, bundle.issues, scenario, options.acceptedExceptions ?? []))
  }

  // 只有普通硬限制（容量、每日上限、保护日期）阻止合法安排时，才生成一个
  // 明确标记的一次性例外候选；锁定、过去和 Goal 最晚日期永远不会在这里放宽。
  const seedScenario = preferred.map(preference => bundle.scenarios.find(item => item.strategy === preference))
    .find(item => item && item.constraintConflicts.length > 0)
  if (seedScenario && !options.signal?.aborted && !options.disableAutomaticExceptions) {
    const generatedExceptions = exceptionsFromConflicts(seedScenario.constraintConflicts)
    const exceptions = mergeConstraintExceptions([...(options.acceptedExceptions ?? []), ...generatedExceptions])
    if (exceptions.length) {
      const overrideRequest: ReplanRequest = {
        ...request,
        strategy: seedScenario.strategy,
        allowTodayIncomingAssignments: todayIncomingAssignmentIds(exceptions),
        limitOverrides: [
          ...(request.limitOverrides ?? []),
          ...exceptions.filter(item => item.overrideLimit != null).map(item => ({ date: item.date, key: item.rawKey ?? item.key, limit: item.overrideLimit!, affectedAssignmentIds: item.affectedAssignmentIds ? [...item.affectedAssignmentIds] : undefined })),
        ],
        allowBufferUseDates: Array.from(new Set([
          ...(request.allowBufferUseDates ?? []),
          ...exceptions.filter(item => item.key === 'date-protection' && !item.affectedAssignmentIds?.length).map(item => item.date),
        ])),
        allowProtectedDateAssignments: [
          ...(request.allowProtectedDateAssignments ?? []),
          ...exceptions.filter(item => item.key === 'date-protection' && item.affectedAssignmentIds?.length).map(item => ({ date: item.date, assignmentIds: [...(item.affectedAssignmentIds ?? [])] })),
        ],
      }
      const exceptionBundle = generateReplanBundle(input, overrideRequest, [seedScenario.strategy])
      const exceptionScenario = exceptionBundle.scenarios.find(item => item.strategy === seedScenario.strategy)
      if (exceptionScenario) append(proposalFromScenario(baseline, input, event, exceptionBundle.issues, exceptionScenario, exceptions))
    }
  }
  return proposals
}


export interface ProposalMovementRevision {
  assignmentId: string
  /** undefined 表示保留为未安排；普通已有任务通常传入原日期。 */
  date?: string
  lock?: boolean
}

function movementsFromStates(beforeState: AppState, afterState: AppState, previous: SchedulingProposal): TaskMovement[] {
  const previousMap = new Map(previous.movements.map(item => [item.assignmentId, item]))
  const ids = new Set([...beforeState.assignments.map(item => item.id), ...afterState.assignments.map(item => item.id)])
  return [...ids].flatMap(assignmentId => {
    const beforeTask = beforeState.assignments.find(item => item.id === assignmentId)
    const afterTask = afterState.assignments.find(item => item.id === assignmentId)
    if (!afterTask || beforeTask?.scheduledDate === afterTask.scheduledDate) return []
    const prior = previousMap.get(assignmentId)
    const goals = goalNamesForAssignment(afterState, afterTask)
    const customChanged = !prior || prior.toDate !== afterTask.scheduledDate
    return [{
      assignmentId,
      fromDate: beforeTask?.scheduledDate,
      toDate: afterTask.scheduledDate,
      reason: customChanged ? '用户在方案预览中逐项调整了该任务的目标日期；系统已重新验算全部约束。' : prior.reason,
      beforeLoad: beforeTask?.scheduledDate ? planningDayLoad(beforeState, beforeTask.scheduledDate) : 0,
      afterLoad: afterTask.scheduledDate ? planningDayLoad(afterState, afterTask.scheduledDate) : 0,
      goalImpact: goals.length ? `关联目标：${goals.join('、')}` : '不直接关联目标',
      manualIntentImpact: beforeTask?.locked ? 'locked-blocked'
        : beforeTask?.intentStrength === 'manual' && beforeTask.scheduledDate !== afterTask.scheduledDate ? 'moved-manual'
          : beforeTask?.intentStrength === 'manual' ? 'preserved' : 'none',
      rejectedAlternatives: customChanged ? [] : prior.rejectedAlternatives,
    } satisfies TaskMovement]
  })
}

function dateChangesFromStates(beforeState: AppState, afterState: AppState, movements: TaskMovement[]): DateLoadChange[] {
  const dates = new Set(movements.flatMap(item => [item.fromDate, item.toDate].filter((date): date is string => Boolean(date))))
  return [...dates].sort().map(date => ({
    date,
    beforeMinutes: planningDayLoad(beforeState, date),
    afterMinutes: planningDayLoad(afterState, date),
    beforeCapacity: getCapacity(beforeState, date),
    afterCapacity: getCapacity(afterState, date),
    beforeTaskIds: beforeState.assignments.filter(item => item.scheduledDate === date).map(item => item.id),
    afterTaskIds: afterState.assignments.filter(item => item.scheduledDate === date).map(item => item.id),
  })).filter(item => item.beforeMinutes !== item.afterMinutes || stableSignature(item.beforeTaskIds) !== stableSignature(item.afterTaskIds))
}

/**
 * 在方案预览内逐项“保留原日 / 自定义改期 / 锁定结果”后重建完整方案。
 * 这不是绕过调度器的直接移动：每次修改都会重新计算日期负载、目标影响、
 * 新硬冲突、稳定性和最终可应用状态。
 */
export function reviseSchedulingProposal(
  baseline: AppState,
  event: PlanChangeEvent,
  proposal: SchedulingProposal,
  revision: ProposalMovementRevision,
): SchedulingProposal {
  const afterState = hydratePortableState(proposal.stateAfter)
  const assignment = afterState.assignments.find(item => item.id === revision.assignmentId)
  const baselineAssignment = baseline.assignments.find(item => item.id === revision.assignmentId)
  if (!assignment || assignment.status === 'done' || baselineAssignment?.locked || afterState.timer.assignmentId === assignment.id) {
    return { ...proposal, infeasible: true, infeasibleReason: '该任务已完成、已锁定、正在计时或不存在，不能在方案中改期。' }
  }

  const previousDate = assignment.scheduledDate
  let placementProblems: PlacementCheckItem[] = []
  if (revision.date) {
    const validationState = cloneActiveState(afterState)
    const validationAssignment = validationState.assignments.find(item => item.id === assignment.id)!
    const validationGroup = validationState.taskGroups.find(item => item.id === validationAssignment.groupId)
    // “保留原日期”是保留既有占用，不应被当成向受保护日期新塞入任务。
    if (baselineAssignment?.scheduledDate === revision.date) validationAssignment.scheduledDate = revision.date
    if (!validationGroup) {
      placementProblems = [{ key: 'missing-group', label: '找不到任务组', current: 1, limit: 0, hard: true }]
    } else {
      const todayStats = statsMap(validationState, new Set([assignment.id])).get(todayISO()) ?? blankStats()
      const automaticTodayRemaining = Math.max(0, getCapacity(validationState, todayISO()) - todayStats.actualMinutes - todayStats.inferredMinutes)
      const explicitOverrides = proposal.exceptions.flatMap(item => item.overrideLimit == null ? [] : [{
        date: item.date,
        key: item.rawKey ?? (item.key === 'group-daily-max' ? `group:${assignment.groupId}` : item.key === 'activity-daily-max' ? `activity:${taskActivity(validationGroup)}` : item.key === 'long-task-max' ? 'long' : item.key === 'high-intensity-max' ? 'high-intensity' : item.key),
        limit: item.overrideLimit,
        affectedAssignmentIds: item.affectedAssignmentIds ? [...item.affectedAssignmentIds] : undefined,
      }])
      const request: ReplanRequest = {
        mode: 'repair',
        fromDate: todayISO(),
        todayExtraMinutes: automaticTodayRemaining,
        allowTodayIncomingAssignments: todayIncomingAssignmentIds(proposal.exceptions),
        allowBufferUseDates: proposal.exceptions.filter(item => (item.key === 'date-protection' || item.rawKey === 'date-protection' || item.rawKey === 'protected-buffer') && !item.affectedAssignmentIds?.length).map(item => item.date),
        allowProtectedDateAssignments: proposal.exceptions.filter(item => (item.key === 'date-protection' || item.rawKey === 'date-protection' || item.rawKey === 'protected-buffer') && item.affectedAssignmentIds?.length).map(item => ({ date: item.date, assignmentIds: [...(item.affectedAssignmentIds ?? [])] })),
        limitOverrides: [...grandfatheredLimitOverrides(baseline), ...explicitOverrides],
      }
      placementProblems = validatePlacement(
        validationState,
        statsMap(validationState, new Set([assignment.id])),
        validationAssignment,
        validationGroup,
        revision.date,
        request,
        baselineAssignment?.scheduledDate,
      ).filter(item => item.hard)
    }
  }

  assignment.previousDate = previousDate
  assignment.scheduledDate = revision.date
  assignment.locked = Boolean(revision.lock)
  assignment.intentStrength = revision.lock ? 'locked' : 'manual'
  assignment.scheduleSource = 'manual'
  assignment.lastManualMoveAt = new Date().toISOString()
  assignment.updatedAt = assignment.lastManualMoveAt

  const movements = movementsFromStates(baseline, afterState, proposal)
  const dateChanges = dateChangesFromStates(baseline, afterState, movements)
  const goalImpacts = proposalGoalImpacts(baseline, afterState)
  const structural = structuralChanges(baseline, afterState)
  const issues = proposal.issues.filter(item => !['草稿仍产生新的硬冲突', '候选会使用受保护日期', '逐项微调产生冲突', '仍有任务未安排'].includes(item.title))

  if (placementProblems.length) issues.push({
    id: uid('issue'), type: 'capacity', title: '逐项微调产生冲突',
    detail: placementProblems.map(item => `${item.label}（${Math.round(item.current)}/${Math.round(item.limit)}）`).join('；'),
    date: revision.date, assignmentIds: [assignment.id], consequence: '当前自定义日期不能作为合法最终方案直接应用。',
    resolution: '选择其他日期、恢复方案推荐日期，或返回方案列表选择明确的一次性例外候选。',
  })

  const analysisState = cloneActiveState(afterState)
  analysisState.acceptedConstraintExceptions = [
    ...grandfatheredAcceptedExceptions(baseline),
    ...proposal.exceptions.map(item => ({
      ...item, id: uid('preview-exception'), eventId: event.id, accepted: true as const, createdAt: new Date().toISOString(),
    })),
  ]
  const analysisFrom = proposalPlanningStart(afterState, event)
  const newDangers = worsenedHardConstraintFacts(baseline, analysisState, analysisFrom)
  for (const danger of newDangers) issues.push(issueFromHardConstraintFact(danger, '逐项微调产生冲突'))

  const leaveUnscheduled = new Set(Array.isArray(event.metadata?.leaveUnscheduledIds) ? event.metadata?.leaveUnscheduledIds.filter((item): item is string => typeof item === 'string') : [])
  const unresolved = afterState.assignments.filter(item => event.affectedAssignmentIds.includes(item.id) && !item.scheduledDate && !leaveUnscheduled.has(item.id))
  if (unresolved.length) issues.push({
    id: uid('issue'), type: 'unscheduled', title: '仍有任务未安排', detail: `${unresolved.length} 项本次相关任务仍未安排。`,
    assignmentIds: unresolved.map(item => item.id), consequence: '这些任务不会被强行塞入冲突日期。', resolution: '改选日期或使用“保留为未安排”操作。',
  })
  const metrics = proposalMetrics(baseline, afterState, event, issues, movements, dateChanges, goalImpacts)
  const distinctSignature = stableSignature({
    moves: movements.map(item => [item.assignmentId, item.toDate]),
    dates: dateChanges.map(item => [item.date, item.afterMinutes]),
    goals: goalImpacts.map(item => [item.goalId, item.afterExpectedCompletion, item.latestRiskAfter]),
    structural: structural.map(item => [item.entityType, item.entityId, item.changeType, item.fields]),
    exceptions: proposal.exceptions.map(item => [item.date, item.rawKey, item.overrideLimit]),
  })
  const reasons = [placementProblems.length ? '自定义日期未通过放置校验。' : '', newDangers.length ? `产生 ${newDangers.length} 个新硬冲突。` : '', unresolved.length ? `${unresolved.length} 项任务未安排。` : ''].filter(Boolean)
  return {
    ...proposal,
    id: `${proposal.id}-custom-${stableSignature([revision.assignmentId, revision.date, revision.lock, distinctSignature])}`,
    title: proposal.title.includes('· 已微调') ? proposal.title : `${proposal.title} · 已微调`,
    description: `${proposal.description} 用户逐项调整后已重新计算全部影响。`,
    generatedAt: new Date().toISOString(),
    stateAfter: portableState(afterState),
    issues,
    movements,
    dateChanges,
    goalImpacts,
    structuralChanges: structural,
    metrics,
    distinctSignature,
    infeasible: reasons.length > 0,
    infeasibleReason: reasons.join(' '),
  }
}

export function allDurationSuggestions(state: AppState): import('../types').DurationSuggestion[] {
  if (!state.settings.duration.enabled) return []
  return state.taskGroups.flatMap(group => {
    const completed = state.assignments
      .filter(item => item.groupId === group.id && item.status === 'done' && item.actualMinutes > 0)
      .sort((a, b) => (b.completedAt ?? b.updatedAt ?? '').localeCompare(a.completedAt ?? a.updatedAt ?? ''))
      .slice(0, state.settings.duration.windowSize)
    if (completed.length < state.settings.duration.minimumSamples) return []
    const sorted = completed.map(item => ({ item, value: item.actualMinutes })).sort((a, b) => a.value - b.value)
    let filtered = sorted
    if (sorted.length >= 4) {
      const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)].value
      const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)].value
      const iqr = q3 - q1
      filtered = sorted.filter(sample => sample.value >= q1 - 1.5 * iqr && sample.value <= q3 + 1.5 * iqr)
    }
    if (filtered.length < state.settings.duration.minimumSamples) return []
    const average = filtered.reduce((sum, sample) => sum + sample.value, 0) / filtered.length
    const deviationRatio = group.unitMinutes > 0 ? (average - group.unitMinutes) / group.unitMinutes : 0
    if (Math.abs(deviationRatio) < state.settings.duration.deviationThreshold) return []
    return [{
      groupId: group.id,
      currentEstimate: group.unitMinutes,
      suggestedEstimate: Math.max(5, Math.round(average / 5) * 5),
      recentAverage: Math.round(average * 10) / 10,
      sampleCount: filtered.length,
      deviationRatio,
      eligibleAssignmentIds: state.assignments.filter(item => item.groupId === group.id && item.status === 'todo' && !item.durationCustomized && !item.manuallyEstimated).map(item => item.id),
      samples: filtered.map(({ item }) => ({ assignmentId: item.id, actualMinutes: item.actualMinutes, estimatedMinutes: item.estimatedMinutes, completionDate: item.completedAt?.slice(0, 10) })),
    }]
  })
}

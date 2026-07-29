import { differenceInCalendarDays, isAfter, isBefore, parseISO } from 'date-fns'
import type {
  AppState, Assignment, DayTypeSuggestion, LoadChange, ReplanBundle, ReplanConstraintConflict,
  ReplanDisturbance, ReplanLimitOverride, ReplanMove, ReplanRejectedAlternative, ReplanRequest,
  ReplanResult, ReplanStrategy, TaskActivityType, TaskGroup
} from '../types'
import { dateRange, getBaseCapacity, getCapacity, getDayConfig, shiftDate, todayISO } from './date'
import { uid } from './id'
import { cloneActiveState } from './state'

const before = (a: string, b: string) => isBefore(parseISO(a), parseISO(b))
const after = (a: string, b: string) => isAfter(parseISO(a), parseISO(b))
const between = (date: string, start: string, end: string) => !before(date, start) && !after(date, end)
const dayOf = (value?: string) => value ? value.slice(0, 10) : undefined
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function groupMap(state: AppState) {
  return new Map(state.taskGroups.map(group => [group.id, group]))
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

function isLongTask(assignment: Assignment) {
  return effectiveMinutes(assignment) >= 90 || assignment.estimatedMinutes >= 90
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
    incomingTodayMinutes: 0
  }
}

function addCount(day: DayStats, key: string, amount = 1) {
  day.counts.set(key, (day.counts.get(key) ?? 0) + amount)
}

function activityKeys(group: TaskGroup, assignment: Assignment) {
  const keys = [`group:${group.id}`]
  const activity = taskActivity(group)
  if (activity !== 'normal') keys.push(`activity:${activity}`)
  if (isLongTask(assignment)) keys.push('long')
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
  if (key === 'long') return getDayConfig(state, date).type === 'study' ? 2 : 1
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

function overrideLimit(request: ReplanRequest, date: string, key: string, fallback?: number) {
  const override = request.limitOverrides?.find(item => item.date === date && item.key === key)
  return override?.limit ?? fallback
}

function assignmentActualBreakdown(state: AppState) {
  const actualByDate = new Map<string, number>()
  const inferredByDate = new Map<string, number>()
  const assignmentDates = new Map<string, string>()
  const groups = groupMap(state)

  for (const assignment of state.assignments) {
    let entryTotal = 0
    for (const entry of assignment.timeEntries ?? []) {
      const date = dayOf(entry.createdAt)
      if (!date) continue
      entryTotal += entry.minutes
      actualByDate.set(date, (actualByDate.get(date) ?? 0) + entry.minutes)
      assignmentDates.set(assignment.id, date)
    }
    const residual = Math.max(0, assignment.actualMinutes - entryTotal)
    const fallbackDate = dayOf(assignment.completedAt) ?? assignment.scheduledDate
    if (residual > 0 && fallbackDate) {
      actualByDate.set(fallbackDate, (actualByDate.get(fallbackDate) ?? 0) + residual)
      assignmentDates.set(assignment.id, fallbackDate)
    }
    if (assignment.status === 'done' && assignment.actualMinutes <= 0 && entryTotal <= 0) {
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

function statsMap(state: AppState, excluded = new Set<string>()) {
  const groups = groupMap(state)
  const map = new Map<string, DayStats>()
  const actual = assignmentActualBreakdown(state)

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
      const date = actual.assignmentDates.get(assignment.id) ?? dayOf(assignment.completedAt) ?? assignment.scheduledDate
      if (!date) continue
      const day = map.get(date) ?? blankStats()
      day.taskCount += group.recurring ? 0 : 1
      for (const key of activityKeys(group, assignment)) addCount(day, key)
      if (isLongTask(assignment)) day.longCount += 1
      if (isHighIntensity(group, assignment)) day.highIntensityCount += 1
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
    for (const key of activityKeys(group, assignment)) addCount(day, key)
    if (isLongTask(assignment)) day.longCount += 1
    if (isHighIntensity(group, assignment)) day.highIntensityCount += 1
    map.set(assignment.scheduledDate, day)
  }
  return map
}

function addToStats(stats: Map<string, DayStats>, date: string, assignment: Assignment, group: TaskGroup, originalDate?: string) {
  const day = stats.get(date) ?? blankStats()
  const minutes = effectiveMinutes(assignment)
  day.plannedMinutes += minutes
  day.totalMinutes += minutes
  day.taskCount += group.recurring ? 0 : 1
  day.subjectMinutes.set(group.subject, (day.subjectMinutes.get(group.subject) ?? 0) + minutes)
  for (const key of activityKeys(group, assignment)) addCount(day, key)
  if (isLongTask(assignment)) day.longCount += 1
  if (isHighIntensity(group, assignment)) day.highIntensityCount += 1
  if (date === todayISO() && originalDate !== date) day.incomingTodayMinutes += minutes
  stats.set(date, day)
}

function hardCapacity(state: AppState, date: string, request: ReplanRequest, day?: DayStats) {
  const base = getCapacity(state, date)
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

interface PlacementViolation {
  key: string
  label: string
  current: number
  limit: number
  hard: boolean
}

function validatePlacement(
  state: AppState,
  stats: Map<string, DayStats>,
  assignment: Assignment,
  group: TaskGroup,
  date: string,
  request: ReplanRequest,
  originalDate?: string
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
  if (after(date, group.dueDate)) violations.push({ key: 'due-date', label: `超过最终截止 ${group.dueDate}`, current: 1, limit: 0, hard: true })
  if (config.type === 'travel' && originalDate !== date) violations.push({ key: 'travel-day', label: '旅游日不接收普通任务', current: 1, limit: 0, hard: true })

  const manualBufferProtected = Boolean(config.isBufferDay && (config.bufferProtected ?? config.userSet))
  if (manualBufferProtected && originalDate !== date && !request.allowBufferUseDates?.includes(date)) {
    violations.push({ key: 'protected-buffer', label: '用户设置的缓冲日受到保护', current: 1, limit: 0, hard: true })
  }
  if (config.isBufferDay && isHighIntensity(group, assignment)) {
    violations.push({ key: 'buffer-high-intensity', label: '缓冲日不安排高强度任务', current: day.highIntensityCount + 1, limit: 0, hard: true })
  }

  if (date === todayISO() && originalDate !== date) {
    const extra = Math.max(0, request.todayExtraMinutes ?? 0)
    if (extra <= 0) violations.push({ key: 'today-closed', label: '今天默认不接收未来任务', current: 1, limit: 0, hard: true })
    else if (day.incomingTodayMinutes + minutes > extra) {
      violations.push({ key: 'today-extra', label: '超过你填写的今日额外可用时间', current: day.incomingTodayMinutes + minutes, limit: extra, hard: true })
    }
  }

  const projected = day.totalMinutes + minutes
  const capacity = hardCapacity(state, date, request, day)
  if (projected > capacity) violations.push({ key: 'capacity', label: '超过当天硬容量', current: projected, limit: capacity, hard: true })

  for (const key of activityKeys(group, assignment)) {
    const fallback = defaultLimit(state, date, key, group)
    if (fallback === undefined) continue
    const limit = overrideLimit(request, date, key, fallback) ?? fallback
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
  preferredShift?: number
) {
  const day = stats.get(date) ?? blankStats()
  const minutes = effectiveMinutes(assignment)
  const projected = day.totalMinutes + minutes
  const capacity = Math.max(1, hardCapacity(state, date, { mode: 'repair', fromDate: todayISO() }, day))
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
  if (after(date, group.targetDate)) score += (group.priority === 5 ? 36000 : 8000) + daysFrom(group.targetDate, date) * (group.priority === 5 ? 4500 : 1000)

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
      const cap = getCapacity(state, previousDate)
      return Boolean(previous && cap > 0 && previous.totalMinutes / cap >= state.settings.highLoadThreshold)
    })
  if (precedingHigh && ratio >= state.settings.highLoadThreshold) score += strategy === 'goal' ? 1800 : 10000
  if (getDayConfig(state, date).isBufferDay) score += strategy === 'rest' ? -200 : 5000

  const earlyWeight = strategy === 'goal' ? 120 : strategy === 'balanced' ? 40 : 10
  if (group.priority === 5) score += daysFrom(state.settings.startDate, date) * earlyWeight
  return score
}

function planningStart(request: ReplanRequest) {
  const today = todayISO()
  const requested = request.fromDate || today
  if (request.mode === 'full' && !after(requested, today) && !(request.todayExtraMinutes && request.todayExtraMinutes > 0)) return shiftDate(today, 1)
  return before(requested, today) ? today : requested
}

function frozenDates(request: ReplanRequest) {
  const start = planningStart(request)
  const count = Math.max(0, request.freezeDays ?? 0)
  return new Set(count ? dateRange(start, shiftDate(start, count - 1)) : [])
}

function movableRank(state: AppState, assignments: Assignment[]) {
  const groups = groupMap(state)
  return [...assignments].sort((a, b) => {
    const ga = groups.get(a.groupId)!
    const gb = groups.get(b.groupId)!
    if (a.intentStrength !== b.intentStrength) return a.intentStrength === 'manual' ? 1 : b.intentStrength === 'manual' ? -1 : 0
    if (ga.priority !== gb.priority) return ga.priority - gb.priority
    if (a.status !== b.status) return a.status === 'partial' ? 1 : b.status === 'partial' ? -1 : 0
    if (ga.targetDate !== gb.targetDate) return gb.targetDate.localeCompare(ga.targetDate)
    return effectiveMinutes(b) - effectiveMinutes(a)
  })
}

function identifyRepairCandidates(state: AppState, request: ReplanRequest) {
  const groups = groupMap(state)
  const candidateIds = new Set<string>()
  const softManualIds = new Set<string>()
  const hardRequired = new Set<string>()
  const issues: string[] = []
  const start = before(request.fromDate, todayISO()) ? todayISO() : request.fromDate
  const stats = statsMap(state)

  const mark = (assignment: Assignment, hard: boolean, message?: string) => {
    if (assignment.locked || assignment.status === 'done' || state.timer.assignmentId === assignment.id) return
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
    if (after(assignment.scheduledDate, group.dueDate)) mark(assignment, true, `${group.subject}「${assignment.title}」已经越过最终截止日期。`)
  }

  for (const date of dateRange(start, state.settings.endDate)) {
    const day = stats.get(date) ?? blankStats()
    const config = getDayConfig(state, date)
    const unfinished = state.assignments.filter(item => item.scheduledDate === date && item.status !== 'done' && !groups.get(item.groupId)?.recurring)
    const movable = movableRank(state, unfinished.filter(item => !item.locked && state.timer.assignmentId !== item.id))

    const limitKeys = new Set<string>()
    for (const item of unfinished) {
      const group = groups.get(item.groupId)
      if (!group) continue
      for (const key of activityKeys(group, item)) limitKeys.add(key)
    }
    for (const key of limitKeys) {
      const sample = unfinished.find(item => {
        const group = groups.get(item.groupId)
        return Boolean(group && activityKeys(group, item).includes(key))
      })
      const group = sample ? groups.get(sample.groupId) : undefined
      const fallback = defaultLimit(state, date, key, group)
      if (fallback === undefined) continue
      const limit = overrideLimit(request, date, key, fallback) ?? fallback
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

  for (let offset = 0; offset < dates.length; offset += 7) {
    const block = dates.slice(offset, offset + 7)
    if (block.some(date => getDayConfig(state, date).isBufferDay || getDayConfig(state, date).type === 'travel')) continue
    const candidates = block.filter(date => {
      const config = getDayConfig(state, date)
      if (config.userSet || config.type === 'travel') return false
      return !state.assignments.some(item => item.scheduledDate === date && !groups.get(item.groupId)?.recurring && (item.locked || item.intentStrength === 'manual'))
    })
    if (!candidates.length) continue
    const selected = candidates.sort((a, b) => (baseline.get(a)?.totalMinutes ?? 0) - (baseline.get(b)?.totalMinutes ?? 0) || b.localeCompare(a))[0]
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
      bufferReason: '系统为休息、超时和临时安排预留',
      bufferPreference: 'preserve',
      bufferProtected: false,
      userSet: false
    }
    targetSlack -= targetCapacityReduction
  }
}

function assignmentCandidates(state: AppState, request: ReplanRequest, repair: ReturnType<typeof identifyRepairCandidates>) {
  const groups = groupMap(state)
  const frozen = frozenDates(request)
  const start = planningStart(request)
  const ids = new Set<string>()
  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group || group.recurring || assignment.status === 'done' || assignment.locked || state.timer.assignmentId === assignment.id) continue
    const date = assignment.scheduledDate
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
    if (before(date, start)) continue
    if (frozen.has(date)) continue
    ids.add(assignment.id)
  }
  return ids
}

function possibleDateRange(state: AppState, request: ReplanRequest, group: TaskGroup, originalDate?: string) {
  const start = planningStart(request)
  const end = before(group.dueDate, state.settings.endDate) ? group.dueDate : state.settings.endDate
  const all = dateRange(start, end)
  if (request.mode !== 'repair' || !originalDate) return all
  const radius = Math.max(1, request.localRadius ?? state.settings.localRepairRadius)
  const local = all.filter(date => Math.abs(differenceInCalendarDays(parseISO(date), parseISO(originalDate))) <= radius)
  const rest = all.filter(date => !local.includes(date))
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
    .filter(item => item.violation.key.startsWith('group:') || item.violation.key.startsWith('activity:') || item.violation.key === 'long' || item.violation.key === 'high-intensity')
  if (!limitViolations.length) return
  const chosen = limitViolations.sort((a, b) => a.violation.current - b.violation.current)[0]
  const key = `${chosen.date}:${chosen.violation.key}`
  const found = existing.find(item => `${item.date}:${item.key}` === key)
  if (found) {
    if (!found.affectedAssignmentIds.includes(assignment.id)) found.affectedAssignmentIds.push(assignment.id)
    return
  }
  existing.push({
    date: chosen.date,
    key: chosen.violation.key,
    label: chosen.violation.label,
    current: chosen.violation.current,
    limit: chosen.violation.limit,
    suggestedLimit: Math.max(chosen.violation.current, chosen.violation.limit + 1),
    affectedAssignmentIds: [assignment.id],
    options: [
      `仅本次把 ${chosen.date} 的上限放宽到 ${Math.max(chosen.violation.current, chosen.violation.limit + 1)}`,
      '延后阶段目标或最终截止日期',
      '增加附近日期的可用时间',
      '使用一个明确允许的缓冲日'
    ]
  })
}

function calculateDisturbance(beforeState: AppState, afterState: AppState): ReplanDisturbance {
  const beforeStats = statsMap(beforeState)
  const afterStats = statsMap(afterState)
  const dates = dateRange(beforeState.settings.startDate, beforeState.settings.endDate)
  const deltas = dates.map(date => Math.abs((afterStats.get(date)?.totalMinutes ?? 0) - (beforeStats.get(date)?.totalMinutes ?? 0)))
  const changedDays = deltas.filter(value => value > 0).length
  const scheduled = beforeState.assignments.filter(item => item.scheduledDate)
  const retained = scheduled.filter(item => afterState.assignments.find(next => next.id === item.id)?.scheduledDate === item.scheduledDate).length
  const movedByOrigin = new Map<string, number[]>()
  for (const item of scheduled) {
    const nextDate = afterState.assignments.find(next => next.id === item.id)?.scheduledDate
    if (!item.scheduledDate || !nextDate || item.scheduledDate === nextDate) continue
    const shift = differenceInCalendarDays(parseISO(nextDate), parseISO(item.scheduledDate))
    movedByOrigin.set(item.scheduledDate, [...(movedByOrigin.get(item.scheduledDate) ?? []), shift])
  }
  const preservedDailyBundles = [...movedByOrigin.values()].filter(shifts => shifts.length > 1 && shifts.every(value => value === shifts[0])).length
  return {
    changedDays,
    movedTasks: beforeState.assignments.filter(item => afterState.assignments.find(next => next.id === item.id)?.scheduledDate !== item.scheduledDate).length,
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
  hardRequired: boolean
) {
  if (!to) return {
    reason: '完整验算后没有找到不会制造新硬冲突的日期。',
    impact: '任务保持未安排；请放宽一次上限、增加可用时间、使用缓冲日或调整目标日期。'
  }
  if (!from) return {
    reason: '任务原先未安排，系统在截止日期、负载和每日上限均通过验算后选择该日。',
    impact: after(to, group.targetDate) ? `会晚于阶段目标 ${group.targetDate}。` : `不晚于阶段目标 ${group.targetDate}。`
  }
  const beforeStats = statsMap(beforeState).get(from) ?? blankStats()
  const targetBefore = statsMap(beforeState).get(to) ?? blankStats()
  const targetAfter = statsMap(afterState).get(to) ?? blankStats()
  const sourceReason = getDayConfig(beforeState, from).isBufferDay
    ? `${from} 被设为缓冲日，可用时间降低`
    : hardRequired
      ? `${from} 存在容量、截止日期或每日上限硬冲突`
      : `${from} 的负载或任务结构需要改善`
  return {
    reason: `${sourceReason}；${to} 在完整验算后可以接收该任务。`,
    impact: `${from} 由约 ${Math.round(beforeStats.totalMinutes)} 分钟减负；${to} 由约 ${Math.round(targetBefore.totalMinutes)} 分钟变为 ${Math.round(targetAfter.totalMinutes)} 分钟${after(to, group.targetDate) ? '，但晚于阶段目标' : '，且不晚于阶段目标'}。`
  }
}

function buildScenario(input: AppState, request: ReplanRequest, strategy: ReplanStrategy, repair: ReturnType<typeof identifyRepairCandidates>): ReplanResult {
  const state = cloneActiveState(input)
  if (strategy === 'rest') applyAutomaticBufferDays(state, request)
  const scenarioRepair = strategy === 'rest' ? identifyRepairCandidates(state, request) : repair
  const groups = groupMap(state)
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

  const candidateItems = [...state.assignments.filter(item => candidates.has(item.id))].sort((a, b) => {
    const ga = groups.get(a.groupId)!
    const gb = groups.get(b.groupId)!
    if (a.intentStrength !== b.intentStrength) return a.intentStrength === 'manual' ? -1 : b.intentStrength === 'manual' ? 1 : 0
    if (ga.priority !== gb.priority) return gb.priority - ga.priority
    if (a.status !== b.status) return a.status === 'partial' ? -1 : b.status === 'partial' ? 1 : 0
    if (ga.targetDate !== gb.targetDate) return ga.targetDate.localeCompare(gb.targetDate)
    return effectiveMinutes(b) - effectiveMinutes(a)
  })

  for (const assignment of candidateItems) {
    const group = groups.get(assignment.groupId)!
    const originalDate = oldDates.get(assignment.id)
    const dates = possibleDateRange(state, request, group, originalDate)
      .filter(date => forbiddenReturn.get(assignment.id) !== date)
    const legal: { date: string; score: number }[] = []
    const rejected: { date: string; violations: PlacementViolation[] }[] = []
    for (const date of dates) {
      const violations = validatePlacement(state, stats, assignment, group, date, request, originalDate)
      if (violations.some(item => item.hard)) {
        rejected.push({ date, violations })
        continue
      }
      const preferredShift = originalDate ? preferredShiftByOrigin.get(originalDate) : undefined
      legal.push({ date, score: candidateScore(state, stats, assignment, group, date, strategy, originalDate, baseline, preferredShift) })
    }
    legal.sort((a, b) => a.score - b.score || a.date.localeCompare(b.date))
    const radius = Math.max(1, request.localRadius ?? state.settings.localRepairRadius)
    const localLegal = request.mode === 'repair' && originalDate
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
    addToStats(stats, selected, assignment, group, originalDate)
    if (originalDate && !preferredShiftByOrigin.has(originalDate) && originalDate !== selected) {
      preferredShiftByOrigin.set(originalDate, differenceInCalendarDays(parseISO(selected), parseISO(originalDate)))
    }
  }

  const warnings: string[] = []
  for (const assignment of unresolved) {
    const group = groups.get(assignment.groupId)!
    warnings.push(`${group.subject}「${assignment.title}」暂无合法安排位置，系统没有强行制造新的冲突。`)
  }

  const analyzed = analyzePlan(state, planningStart(request))
  warnings.push(...analyzed.filter(issue => issue.level !== 'info').map(issue => issue.message))

  const moves: ReplanMove[] = state.assignments
    .filter(assignment => oldDates.get(assignment.id) !== assignment.scheduledDate)
    .map(assignment => {
      const group = groups.get(assignment.groupId)!
      const from = oldDates.get(assignment.id)
      const to = assignment.scheduledDate
      const explanation = explainMove(input, state, assignment, group, from, to, scenarioRepair.hardRequired.has(assignment.id))
      const alternatives = dateRange(planningStart(request), before(group.dueDate, state.settings.endDate) ? group.dueDate : state.settings.endDate)
        .filter(date => date !== to)
        .map(date => ({ date, violations: validatePlacement(state, statsMap(state, new Set([assignment.id])), assignment, group, date, request, from) }))
        .filter(item => !item.violations.some(violation => violation.hard))
        .slice(0, 3)
        .map(item => ({ date: item.date, label: item.date, impact: after(item.date, group.targetDate) ? '会晚于阶段目标' : '不晚于阶段目标' }))
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
        wasManual: input.assignments.find(item => item.id === assignment.id)?.intentStrength === 'manual',
        hardRequired: scenarioRepair.hardRequired.has(assignment.id)
      }
    })

  const beforeStats = statsMap(input)
  const afterStats = statsMap(state)
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

  const disturbance = calculateDisturbance(input, state)
  const coreBefore = predictCompletion(input, group => group.priority === 5 && !group.recurring && group.targetDate <= input.settings.coreTargetDate)
  const coreAfter = predictCompletion(state, group => group.priority === 5 && !group.recurring && group.targetDate <= state.settings.coreTargetDate)
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
    unresolved.length ? `仍有 ${unresolved.length} 项没有合法位置，已保留为待决定，不会强塞。` : '所有候选任务都通过了来源日与目标日完整验算。'
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
      unresolved: unresolved.length,
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
    todayExtraMinutes: Math.max(0, request.todayExtraMinutes ?? 0),
    localRadius: request.localRadius ?? input.settings.localRepairRadius,
    allowBufferUseDates: request.allowBufferUseDates ?? [],
    limitOverrides: request.limitOverrides ?? []
  }
}

export function generateReplanScenario(input: AppState, request: ReplanRequest, strategy: ReplanStrategy): ReplanResult {
  const normalized = normalizeReplanRequest(input, { ...request, strategy })
  const repair = identifyRepairCandidates(input, normalized)
  return buildScenario(input, normalized, strategy, repair)
}

export function generateReplanBundle(input: AppState, request: ReplanRequest): ReplanBundle {
  const normalized = normalizeReplanRequest(input, request)
  const repair = identifyRepairCandidates(input, normalized)
  const actual = assignmentActualBreakdown(input)
  const today = todayISO()
  const todayStats = statsMap(input).get(today) ?? blankStats()
  const actualToday = todayStats.actualMinutes
  const inferredToday = todayStats.inferredMinutes
  const baseCapacity = getCapacity(input, today)
  const automaticRemaining = Math.max(0, baseCapacity - actualToday - inferredToday)
  const allowedIncoming = Math.max(0, normalized.todayExtraMinutes ?? 0)
  const strategies: ReplanStrategy[] = ['preserve', 'balanced', 'goal', 'rest']
  void actual
  return {
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

export function analyzePlan(state: AppState, fromDate = state.settings.startDate): PlanIssue[] {
  const groups = groupMap(state)
  const stats = statsMap(state)
  const issues: PlanIssue[] = []
  let highStreak = 0
  const start = before(fromDate, todayISO()) ? fromDate : fromDate
  for (const date of dateRange(start, state.settings.endDate)) {
    const day = stats.get(date) ?? blankStats()
    const capacity = getCapacity(state, date)
    const config = getDayConfig(state, date)
    if (day.totalMinutes > capacity) issues.push({ level: 'danger', date, message: `${date} 的真实执行与剩余任务合计约 ${Math.round(day.totalMinutes)} 分钟，超过容量 ${Math.round(day.totalMinutes - capacity)} 分钟。` })
    else if (capacity > 0 && day.totalMinutes / capacity > state.settings.nearFullThreshold) issues.push({ level: 'warning', date, message: `${date} 已接近满载（${Math.round(day.totalMinutes / capacity * 100)}%），建议保留缓冲。` })
    const maxTasks = config.type === 'study' ? state.settings.studyMaxTasks : state.settings.regularMaxTasks
    if (day.taskCount > maxTasks) issues.push({ level: 'warning', date, message: `${date} 有 ${day.taskCount} 项活动，超过建议上限 ${maxTasks}。` })

    const keys = new Set(day.counts.keys())
    for (const key of keys) {
      const sample = state.assignments.find(item => {
        const group = groups.get(item.groupId)
        return Boolean(group && activityKeys(group, item).includes(key))
      })
      const group = sample ? groups.get(sample.groupId) : undefined
      const limit = defaultLimit(state, date, key, group)
      if (limit !== undefined && (day.counts.get(key) ?? 0) > limit) {
        issues.push({ level: 'danger', date, message: `${date} 的${limitLabel(key, group)}为 ${day.counts.get(key)}，超过默认上限 ${limit}。` })
      }
    }

    const subjectOver = [...day.subjectMinutes.entries()].find(([, minutes]) => day.totalMinutes > 90 && minutes / day.totalMinutes > state.settings.subjectShareLimit)
    if (subjectOver) issues.push({ level: 'info', date, message: `${date} 的${subjectOver[0]}占比偏高，建议与其他科目搭配。` })
    if (config.type === 'travel') {
      const ordinary = state.assignments.filter(item => item.scheduledDate === date && item.status !== 'done' && !groups.get(item.groupId)?.recurring)
      if (ordinary.length) issues.push({ level: 'warning', date, message: `${date} 是旅游日，但仍有 ${ordinary.length} 项普通任务。` })
    }
    if (config.isBufferDay && day.totalMinutes > capacity) issues.push({ level: 'danger', date, message: `${date} 是缓冲日，但任务超过你设置的可用时间。` })
    const ratio = capacity > 0 ? day.totalMinutes / capacity : 0
    highStreak = ratio >= state.settings.highLoadThreshold ? highStreak + 1 : 0
    if (highStreak >= state.settings.highLoadStreak) {
      issues.push({ level: 'info', date, message: `截至 ${date} 已连续 ${highStreak} 天高负载，建议下一天设置为轻量缓冲日。` })
      highStreak = 0
    }
  }
  for (const assignment of state.assignments.filter(item => item.status !== 'done' && item.scheduledDate)) {
    const group = groups.get(assignment.groupId)
    if (group && after(assignment.scheduledDate!, group.dueDate)) issues.push({ level: 'danger', date: assignment.scheduledDate, message: `${group.subject}「${assignment.title}」晚于截止日期 ${group.dueDate}。` })
  }
  return [...new Map(issues.map(issue => [`${issue.date ?? ''}:${issue.message}`, issue])).values()]
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
  return dateRange(todayISO(), before(group.dueDate, state.settings.endDate) ? group.dueDate : state.settings.endDate)
    .filter(date => !validatePlacement(state, stats, assignment, group, date, request, assignment.scheduledDate).some(item => item.hard))
    .map(date => ({ date, score: candidateScore(state, stats, assignment, group, date, 'balanced', assignment.scheduledDate, baseline) }))
    .sort((a, b) => a.score - b.score || a.date.localeCompare(b.date))
    .slice(0, limit)
    .map(item => item.date)
}

export function moveOneDay(date: string, direction: -1 | 1) {
  return shiftDate(date, direction)
}

export interface DurationSuggestion {
  groupId: string
  minutes: number
  sampleSize: number
  currentMinutes: number
  differenceMinutes: number
}

export function getDurationSuggestion(state: AppState, groupId: string): DurationSuggestion | undefined {
  const group = state.taskGroups.find(item => item.id === groupId)
  if (!group) return undefined
  const completed = state.assignments
    .filter(item => item.groupId === groupId && item.status === 'done' && item.actualMinutes > 0)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  const sampleCount = group.memoryTask ? 5 : 3
  if (completed.length < 3) return undefined
  const values = completed.slice(0, sampleCount).map(item => item.actualMinutes).sort((a, b) => a - b)
  const minutes = group.memoryTask
    ? values[Math.floor(values.length / 2)]
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const differenceMinutes = minutes - group.unitMinutes
  const ratio = group.unitMinutes > 0 ? Math.abs(differenceMinutes) / group.unitMinutes : 1
  if (Math.abs(differenceMinutes) < 10 || ratio < 0.15) return undefined
  return { groupId, minutes, sampleSize: values.length, currentMinutes: group.unitMinutes, differenceMinutes }
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

export function planningDayLoad(state: AppState, date: string) {
  return Math.round(statsMap(state).get(date)?.totalMinutes ?? 0)
}

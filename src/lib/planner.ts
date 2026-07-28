import { differenceInCalendarDays, isAfter, isBefore, parseISO } from 'date-fns'
import type {
  AppState, Assignment, DayTypeSuggestion, LoadChange, ReplanBundle, ReplanMove,
  ReplanRequest, ReplanResult, ReplanStrategy, TaskGroup
} from '../types'
import { dateRange, getCapacity, getDayConfig, shiftDate, todayISO } from './date'
import { uid } from './id'

const ts = (date?: string) => date ? Date.parse(date) : Number.NaN
const before = (a: string, b: string) => isBefore(parseISO(a), parseISO(b))
const after = (a: string, b: string) => isAfter(parseISO(a), parseISO(b))
const between = (date: string, start: string, end: string) => !before(date, start) && !after(date, end)

function groupMap(state: AppState) {
  return new Map(state.taskGroups.map(g => [g.id, g]))
}

export function effectiveMinutes(a: Assignment) {
  if (a.status === 'done') return 0
  if (typeof a.remainingMinutes === 'number' && a.remainingMinutes >= 0) return Math.max(1, Math.round(a.remainingMinutes))
  const remainingRatio = Math.max(0, 1 - a.progress / 100)
  return Math.max(1, Math.round(a.estimatedMinutes * remainingRatio))
}

function countsInLoad(state: AppState, group: TaskGroup) {
  return group.countInStats || state.settings.countWordsTime
}

function allowedOverbook(state: AppState, date: string) {
  const type = getDayConfig(state, date).type
  if (type === 'study') return state.settings.studyOverbookMinutes
  if (type === 'regular' || type === 'custom') return state.settings.regularOverbookMinutes
  return 0
}

function softCapacity(state: AppState, date: string) {
  return getCapacity(state, date) + allowedOverbook(state, date)
}

function maxTaskCount(state: AppState, date: string) {
  return getDayConfig(state, date).type === 'study' ? state.settings.studyMaxTasks : state.settings.regularMaxTasks
}

function isRecentManualMove(a: Assignment) {
  if (!a.lastManualMoveAt) return false
  return Date.now() - ts(a.lastManualMoveAt) < 72 * 60 * 60 * 1000
}

function frozenDates(request: ReplanRequest) {
  const days = Math.max(0, request.freezeDays ?? 2)
  return new Set(days ? dateRange(request.fromDate, shiftDate(request.fromDate, days - 1)) : [])
}

interface DayStats {
  load: number
  taskCount: number
  subjectMinutes: Map<string, number>
  groupCounts: Map<string, number>
  memoryCount: number
  memoryByGroup: Map<string, number>
  longCount: number
}

function blankStats(): DayStats {
  return { load: 0, taskCount: 0, subjectMinutes: new Map(), groupCounts: new Map(), memoryCount: 0, memoryByGroup: new Map(), longCount: 0 }
}

function statsMap(state: AppState, groups: Map<string, TaskGroup>, excluded = new Set<string>()) {
  const map = new Map<string, DayStats>()
  for (const a of state.assignments) {
    if (!a.scheduledDate || excluded.has(a.id) || a.status === 'done') continue
    const g = groups.get(a.groupId)
    if (!g) continue
    const day = map.get(a.scheduledDate) ?? blankStats()
    day.taskCount += g.recurring ? 0 : 1
    const minutes = countsInLoad(state, g) ? effectiveMinutes(a) : 0
    day.load += minutes
    day.subjectMinutes.set(g.subject, (day.subjectMinutes.get(g.subject) ?? 0) + minutes)
    day.groupCounts.set(g.id, (day.groupCounts.get(g.id) ?? 0) + 1)
    if (g.memoryTask) {
      day.memoryCount += 1
      day.memoryByGroup.set(g.id, (day.memoryByGroup.get(g.id) ?? 0) + 1)
    }
    if (effectiveMinutes(a) >= 90) day.longCount += 1
    map.set(a.scheduledDate, day)
  }
  return map
}

function addToStats(state: AppState, stats: Map<string, DayStats>, date: string, a: Assignment, g: TaskGroup) {
  const day = stats.get(date) ?? blankStats()
  day.taskCount += g.recurring ? 0 : 1
  const minutes = countsInLoad(state, g) ? effectiveMinutes(a) : 0
  day.load += minutes
  day.subjectMinutes.set(g.subject, (day.subjectMinutes.get(g.subject) ?? 0) + minutes)
  day.groupCounts.set(g.id, (day.groupCounts.get(g.id) ?? 0) + 1)
  if (g.memoryTask) {
    day.memoryCount += 1
    day.memoryByGroup.set(g.id, (day.memoryByGroup.get(g.id) ?? 0) + 1)
  }
  if (effectiveMinutes(a) >= 90) day.longCount += 1
  stats.set(date, day)
}

function loadMap(state: AppState) {
  const groups = groupMap(state)
  const map = new Map<string, number>()
  for (const a of state.assignments) {
    if (!a.scheduledDate || a.status === 'done') continue
    const g = groups.get(a.groupId)
    if (!g || !countsInLoad(state, g)) continue
    map.set(a.scheduledDate, (map.get(a.scheduledDate) ?? 0) + effectiveMinutes(a))
  }
  return map
}

export function autoConfigureDayTypes(state: AppState): AppState {
  const next = structuredClone(state)
  for (const date of dateRange(next.settings.startDate, next.settings.endDate)) {
    if (!next.dayConfigs[date]) next.dayConfigs[date] = { date, type: 'regular', userSet: false }
  }
  const groups = groupMap(next)
  const coreRequired = next.assignments
    .filter(a => {
      const g = groups.get(a.groupId)
      return g && g.priority === 5 && !g.recurring && a.status !== 'done' && !after(g.targetDate, next.settings.coreTargetDate)
    })
    .reduce((sum, a) => sum + effectiveMinutes(a), 0)
  const dailyLimitedReserve = next.taskGroups
    .filter(g => g.priority === 5 && !g.recurring && g.dailyMax && after(g.targetDate, next.settings.coreTargetDate))
    .reduce((sum, g) => {
      const remaining = next.assignments.filter(a => a.groupId === g.id && a.status !== 'done').length
      const postCoreDays = dateRange(shiftDate(next.settings.coreTargetDate, 1), g.targetDate).length
      const mustFinishByCore = Math.max(0, remaining - postCoreDays * (g.dailyMax ?? 1))
      return sum + mustFinishByCore * g.unitMinutes
    }, 0)
  const required = coreRequired + dailyLimitedReserve
  const dates = dateRange(next.settings.startDate, next.settings.coreTargetDate)
  const current = dates.reduce((sum, date) => sum + getCapacity(next, date), 0)
  let shortfall = Math.max(0, required - current)
  const gain = Math.max(1, next.settings.studyMinutes - next.settings.regularMinutes)
  for (const date of dates) {
    if (shortfall <= 0) break
    const cfg = next.dayConfigs[date]
    if (cfg.type === 'regular' && !cfg.userSet) {
      cfg.type = 'study'
      shortfall -= gain
    }
  }
  next.updatedAt = new Date().toISOString()
  return next
}

function identifyRepairCandidates(state: AppState, request: ReplanRequest) {
  const groups = groupMap(state)
  const candidateIds = new Set<string>()
  const softManualIds = new Set<string>()
  const hardRequired = new Set<string>()
  const issues: string[] = []
  const frozen = frozenDates(request)
  const start = request.fromDate

  for (const a of state.assignments) {
    const g = groups.get(a.groupId)
    if (!g || g.recurring || a.status === 'done' || a.locked || state.timer.assignmentId === a.id) continue
    if (!a.scheduledDate) {
      candidateIds.add(a.id)
      issues.push(`${g.subject}「${a.title}」尚未安排。`)
      continue
    }
    if (before(a.scheduledDate, start)) continue
    const cfg = getDayConfig(state, a.scheduledDate)
    if (cfg.type === 'travel' && a.scheduleSource !== 'manual') {
      candidateIds.add(a.id)
      hardRequired.add(a.id)
      issues.push(`${a.scheduledDate} 是旅游日，${g.subject}「${a.title}」需要迁移。`)
    }
    if (after(a.scheduledDate, g.dueDate)) {
      candidateIds.add(a.id)
      hardRequired.add(a.id)
      issues.push(`${g.subject}「${a.title}」已经越过截止日期。`)
    }
  }

  // 每日数量硬约束，例如化学预习每天最多 1 个。
  for (const g of state.taskGroups.filter(x => x.dailyMax && !x.recurring)) {
    for (const date of dateRange(start, state.settings.endDate)) {
      const items = state.assignments
        .filter(a => a.groupId === g.id && a.scheduledDate === date && a.status !== 'done' && !a.locked)
        .sort((a, b) => Number(b.intentStrength === 'manual') - Number(a.intentStrength === 'manual') || a.index - b.index)
      const excess = items.slice(g.dailyMax)
      for (const a of excess) {
        candidateIds.add(a.id)
        hardRequired.add(a.id)
        issues.push(`${date} 的「${g.title}」超过每日上限 ${g.dailyMax}。`)
      }
    }
  }

  // 对超载日、任务过多日和记忆任务堆积日，只移动自动安排项，优先保留用户手动决定。
  for (const date of dateRange(start, state.settings.endDate)) {
    const cfg = getDayConfig(state, date)
    const items = state.assignments.filter(a => a.scheduledDate === date && a.status !== 'done')
    if (!items.length) continue
    const movableAuto = items.filter(a => {
      const g = groups.get(a.groupId)
      return Boolean(g && !g.recurring && !a.locked && state.timer.assignmentId !== a.id && !candidateIds.has(a.id) && a.intentStrength !== 'manual')
    })
    const movableManual = items.filter(a => {
      const g = groups.get(a.groupId)
      return Boolean(g && !g.recurring && !a.locked && state.timer.assignmentId !== a.id && !candidateIds.has(a.id) && a.intentStrength === 'manual' && !frozen.has(date))
    })
    const movable = [...movableAuto, ...movableManual]
    let currentLoad = items.reduce((sum, a) => {
      const g = groups.get(a.groupId)
      return sum + (g && countsInLoad(state, g) ? effectiveMinutes(a) : 0)
    }, 0)
    let currentCount = items.filter(a => !groups.get(a.groupId)?.recurring).length
    const cap = softCapacity(state, date)
    const maxCount = maxTaskCount(state, date)
    const memoryGroups = new Map<string, Assignment[]>()
    for (const a of items) {
      const g = groups.get(a.groupId)
      if (g?.memoryTask) memoryGroups.set(g.id, [...(memoryGroups.get(g.id) ?? []), a])
    }
    const forcedMemoryMoves = new Set<string>()
    for (const [groupId, memoryItems] of memoryGroups) {
      if (memoryItems.length <= 2) continue
      const extras = memoryItems
        .filter(a => movable.some(x => x.id === a.id))
        .sort((a, b) => Number(a.intentStrength === 'manual') - Number(b.intentStrength === 'manual') || b.index - a.index)
        .slice(0, memoryItems.length - 2)
      extras.forEach(a => {
        forcedMemoryMoves.add(a.id)
        if (a.intentStrength === 'manual') softManualIds.add(a.id)
      })
      if (extras.length) issues.push(`${date} 同类记忆任务过于集中，建议分散 ${extras.length} 项。`)
    }

    const displacementOrder = [...movable].sort((a, b) => {
      const ga = groups.get(a.groupId)!
      const gb = groups.get(b.groupId)!
      const aForced = forcedMemoryMoves.has(a.id) ? 1 : 0
      const bForced = forcedMemoryMoves.has(b.id) ? 1 : 0
      if (aForced !== bForced) return bForced - aForced
      if (ga.priority !== gb.priority) return ga.priority - gb.priority
      const aManual = a.intentStrength === 'manual' ? 1 : 0
      const bManual = b.intentStrength === 'manual' ? 1 : 0
      if (aManual !== bManual) return aManual - bManual
      if (ga.targetDate !== gb.targetDate) return gb.targetDate.localeCompare(ga.targetDate)
      return effectiveMinutes(b) - effectiveMinutes(a)
    })

    for (const a of displacementOrder) {
      if (currentLoad <= cap && currentCount <= maxCount && !forcedMemoryMoves.has(a.id)) continue
      const isManual = a.intentStrength === 'manual'
      if (isManual) {
        // 用户手动安排仅作为高影响候选；“最少改动”方案不会采用，其他方案会在预览中说明。
        softManualIds.add(a.id)
      } else {
        candidateIds.add(a.id)
      }
      const g = groups.get(a.groupId)!
      if (countsInLoad(state, g)) currentLoad -= effectiveMinutes(a)
      currentCount -= 1
    }
    if (currentLoad > cap) issues.push(`${date} 仍超载 ${currentLoad - cap} 分钟；冻结期内的手动安排或锁定任务占用了主要容量。`)
    if (cfg.type === 'travel' && items.some(a => !groups.get(a.groupId)?.recurring)) issues.push(`${date} 为旅游日，存在用户手动保留的普通任务。`)
  }

  return { candidateIds, softManualIds, hardRequired, issues }
}

function daysFrom(start: string, date: string) {
  return Math.max(0, differenceInCalendarDays(parseISO(date), parseISO(start)))
}

function candidateScore(
  state: AppState,
  stats: Map<string, DayStats>,
  a: Assignment,
  g: TaskGroup,
  date: string,
  strategy: ReplanStrategy,
  originalDate?: string
) {
  const day = stats.get(date) ?? blankStats()
  const minutes = countsInLoad(state, g) ? effectiveMinutes(a) : 0
  const projectedLoad = day.load + minutes
  const capacity = getCapacity(state, date)
  const soft = softCapacity(state, date)
  const projectedCount = day.taskCount + (g.recurring ? 0 : 1)
  const subjectMinutes = (day.subjectMinutes.get(g.subject) ?? 0) + minutes
  const subjectShare = projectedLoad > 0 ? subjectMinutes / projectedLoad : 0
  const projectedMemoryByGroup = (day.memoryByGroup.get(g.id) ?? 0) + (g.memoryTask ? 1 : 0)
  const projectedLong = day.longCount + (effectiveMinutes(a) >= 90 ? 1 : 0)
  const maxLong = getDayConfig(state, date).type === 'study' ? 2 : 1
  const distance = originalDate ? Math.abs(differenceInCalendarDays(parseISO(date), parseISO(originalDate))) : daysFrom(state.settings.startDate, date)

  let score = 0
  const moveWeight = strategy === 'preserve' ? 180 : strategy === 'balanced' ? 55 : 25
  score += distance * moveWeight
  if (originalDate && date !== originalDate) score += moveWeight * 2
  if (a.intentStrength === 'manual') score += date === originalDate ? -12000 : 9000
  if (after(date, g.targetDate)) score += (g.priority === 5 ? 30000 : 6000) + daysFrom(g.targetDate, date) * (g.priority === 5 ? 4000 : 900)
  if (after(date, g.dueDate)) score += 100000
  if (projectedLoad > soft) score += 18000 + (projectedLoad - soft) * 200
  else if (projectedLoad > capacity) score += 1800 + (projectedLoad - capacity) * 35
  const ratio = capacity ? projectedLoad / capacity : 2
  score += Math.pow(Math.max(0, ratio), 2) * (strategy === 'balanced' ? 900 : 500)
  if (projectedCount > maxTaskCount(state, date)) score += (projectedCount - maxTaskCount(state, date)) * 2400
  if (subjectShare > state.settings.subjectShareLimit && projectedLoad > 90) score += (subjectShare - state.settings.subjectShareLimit) * 5200
  if (g.memoryTask && projectedMemoryByGroup > 2) score += 16000 * (projectedMemoryByGroup - 2)
  else if (g.memoryTask && projectedMemoryByGroup > 1) score += 900
  const projectedMemoryCount = day.memoryCount + (g.memoryTask ? 1 : 0)
  const memoryLimit = getDayConfig(state, date).type === 'study' ? 4 : 3
  if (projectedMemoryCount > memoryLimit) score += (projectedMemoryCount - memoryLimit) * 3000
  if (projectedLong > maxLong) score += (projectedLong - maxLong) * 4200

  const precedingHigh = Array.from({ length: Math.max(1, state.settings.highLoadStreak - 1) }, (_, i) => shiftDate(date, -(i + 1)))
    .every(previousDate => {
      const previousCapacity = getCapacity(state, previousDate)
      const previousLoad = stats.get(previousDate)?.load ?? 0
      return previousCapacity > 0 && previousLoad / previousCapacity >= state.settings.highLoadThreshold
    })
  if (precedingHigh && ratio >= state.settings.highLoadThreshold) score += strategy === 'balanced' ? 5200 : strategy === 'goal' ? 1500 : 3200
  if (precedingHigh && ratio < 0.65) score -= 1200

  // 高优先级在目标内尽量前置；“保目标”方案更激进。
  const earlyWeight = strategy === 'goal' ? 100 : strategy === 'balanced' ? 38 : 8
  if (g.priority === 5) score += daysFrom(state.settings.startDate, date) * earlyWeight
  else score += Math.max(0, 5 - g.priority) * Math.max(0, daysFrom(date, state.settings.endDate))
  if (a.status === 'partial') score -= 1200
  return score
}

function chooseAlternatives(state: AppState, _stats: Map<string, DayStats>, a: Assignment, g: TaskGroup, strategy: ReplanStrategy, originalDate?: string) {
  const start = state.settings.startDate
  const stats = statsMap(state, groupMap(state), new Set([a.id]))
  return dateRange(start, state.settings.endDate)
    .filter(date => !after(date, g.dueDate))
    .filter(date => getDayConfig(state, date).type !== 'travel')
    .filter(date => !g.dailyMax || (stats.get(date)?.groupCounts.get(g.id) ?? 0) < g.dailyMax)
    .filter(date => !g.memoryTask || (stats.get(date)?.memoryByGroup.get(g.id) ?? 0) < 2)
    .map(date => ({ date, score: candidateScore(state, stats, a, g, date, strategy, originalDate) }))
    .sort((x, y) => x.score - y.score || x.date.localeCompare(y.date))
    .slice(0, 3)
    .map(x => ({ date: x.date, label: x.date, impact: x.date === originalDate ? '保持原安排' : after(x.date, g.targetDate) ? '会晚于阶段目标' : '不晚于阶段目标' }))
}

function sortCandidates(state: AppState, assignments: Assignment[]) {
  const groups = groupMap(state)
  return [...assignments].sort((a, b) => {
    const ga = groups.get(a.groupId)!
    const gb = groups.get(b.groupId)!
    if (a.intentStrength !== b.intentStrength) return a.intentStrength === 'manual' ? -1 : b.intentStrength === 'manual' ? 1 : 0
    if (ga.priority !== gb.priority) return gb.priority - ga.priority
    if (a.status !== b.status) return a.status === 'partial' ? -1 : b.status === 'partial' ? 1 : 0
    if (ga.targetDate !== gb.targetDate) return ga.targetDate.localeCompare(gb.targetDate)
    if (effectiveMinutes(a) !== effectiveMinutes(b)) return effectiveMinutes(b) - effectiveMinutes(a)
    return a.index - b.index
  })
}

function explainMove(a: Assignment, g: TaskGroup, from: string | undefined, to: string | undefined, hard: boolean) {
  if (!to) return { reason: '没有找到同时满足硬约束与截止日期的可用日期。', impact: '任务会保持未安排，需要用户决定增加容量、调整日期类型或接受延期。' }
  if (!from) return { reason: '任务此前尚未安排，系统选择了负载和截止日期较合适的日期。', impact: after(to, g.targetDate) ? `会晚于阶段目标 ${g.targetDate}。` : `不晚于阶段目标 ${g.targetDate}。` }
  if (hard) return { reason: '原日期违反旅游日、每日上限或硬截止约束，因此必须提出迁移。', impact: after(to, g.targetDate) ? '消除硬冲突，但阶段目标可能顺延。' : '消除硬冲突，阶段目标不变。' }
  if (a.intentStrength === 'manual') return { reason: '为了缓解明显超载，系统提出移动用户手动安排；不会未经确认直接执行。', impact: '这是高影响变更，可以保持原日期、改选日期或锁定。' }
  return { reason: '原日期负载过高、任务数量过多或同类任务过于集中。', impact: after(to, g.targetDate) ? '负载更均衡，但会晚于阶段目标。' : '降低原日期负载，不影响阶段目标。' }
}

function buildScenario(input: AppState, request: ReplanRequest, strategy: ReplanStrategy, repairInfo: ReturnType<typeof identifyRepairCandidates>): ReplanResult {
  const state = structuredClone(input)
  const groups = groupMap(state)
  const oldDates = new Map(state.assignments.map(a => [a.id, a.scheduledDate]))
  const hardRequired = repairInfo.hardRequired
  const frozen = frozenDates(request)
  const start = before(request.fromDate, state.settings.startDate) ? state.settings.startDate : request.fromDate
  const candidates = new Set<string>()

  for (const a of state.assignments) {
    const g = groups.get(a.groupId)
    if (!g || g.recurring || a.status === 'done' || a.locked || state.timer.assignmentId === a.id) continue
    const inPast = a.scheduledDate && before(a.scheduledDate, start)
    if (inPast) continue
    if (request.mode === 'repair') {
      if (repairInfo.candidateIds.has(a.id)) candidates.add(a.id)
      if (strategy !== 'preserve' && repairInfo.softManualIds.has(a.id)) candidates.add(a.id)
    } else {
      const frozenManual = a.intentStrength === 'manual' && a.scheduledDate && frozen.has(a.scheduledDate)
      if (!frozenManual) candidates.add(a.id)
    }
  }

  // 用户刚从某天移走的任务不能被系统拉回原日期。
  const forbiddenReturn = new Map<string, string>()
  for (const a of state.assignments) {
    if (candidates.has(a.id) && a.previousDate && isRecentManualMove(a)) forbiddenReturn.set(a.id, a.previousDate)
  }

  for (const a of state.assignments) if (candidates.has(a.id)) a.scheduledDate = undefined
  const stats = statsMap(state, groups)
  const unresolved: Assignment[] = []

  for (const a of sortCandidates(state, state.assignments.filter(x => candidates.has(x.id)))) {
    const g = groups.get(a.groupId)!
    const originalDate = oldDates.get(a.id)
    const rangeStart = start
    const hardTaskEnd = g.subject === '化学' && g.title === '预习' ? g.targetDate : g.dueDate
    const rangeEnd = before(hardTaskEnd, state.settings.endDate) ? hardTaskEnd : state.settings.endDate
    const dates = between(rangeStart, state.settings.startDate, state.settings.endDate) && !after(rangeStart, rangeEnd)
      ? dateRange(rangeStart, rangeEnd)
      : dateRange(state.settings.startDate, rangeEnd).filter(d => !before(d, rangeStart))
    const basePossible = dates.filter(date => {
      if (getDayConfig(state, date).type === 'travel') return false
      if (forbiddenReturn.get(a.id) === date) return false
      if (g.dailyMax && (stats.get(date)?.groupCounts.get(g.id) ?? 0) >= g.dailyMax) return false
      return true
    })
    // 同类记忆任务默认每天不超过 2 项；只有整个剩余日期都无空间时才允许突破，并在预览中告警。
    const memoryBalanced = g.memoryTask ? basePossible.filter(date => (stats.get(date)?.memoryByGroup.get(g.id) ?? 0) < 2) : basePossible
    const possible = memoryBalanced.length ? memoryBalanced : basePossible
    if (!possible.length) {
      unresolved.push(a)
      continue
    }
    const ranked = possible
      .map(date => ({ date, score: candidateScore(state, stats, a, g, date, strategy, originalDate) }))
      .sort((x, y) => x.score - y.score || x.date.localeCompare(y.date))
    const selected = ranked[0]?.date
    if (!selected) {
      unresolved.push(a)
      continue
    }
    a.scheduledDate = selected
    a.scheduleSource = 'replan'
    if (a.intentStrength !== 'locked') a.intentStrength = a.intentStrength === 'manual' ? 'manual' : 'normal'
    addToStats(state, stats, selected, a, g)
  }

  const warnings: string[] = []
  for (const a of unresolved) {
    const g = groups.get(a.groupId)!
    warnings.push(`${g.subject}「${a.title}」无法在 ${g.dueDate} 前安排。`)
  }
  const bufferSuggestions: string[] = []
  let highStreak = 0
  for (const date of dateRange(start, state.settings.endDate)) {
    const load = stats.get(date)?.load ?? 0
    const cap = getCapacity(state, date)
    const ratio = cap > 0 ? load / cap : 0
    if (load > softCapacity(state, date)) warnings.push(`${date} 仍严重超载 ${load - cap} 分钟。`)
    else if (load > cap) warnings.push(`${date} 轻度超载 ${load - cap} 分钟。`)
    const memoryCounts = stats.get(date)?.memoryByGroup
    if (memoryCounts && [...memoryCounts.values()].some(x => x > 2)) warnings.push(`${date} 仍有同类记忆任务集中。`)
    highStreak = ratio >= state.settings.highLoadThreshold ? highStreak + 1 : 0
    if (highStreak >= state.settings.highLoadStreak) {
      const candidate = shiftDate(date, 1)
      if (!after(candidate, state.settings.endDate)) {
        const candidateLoad = stats.get(candidate)?.load ?? 0
        const candidateCap = getCapacity(state, candidate)
        if (candidateCap > 0 && candidateLoad / candidateCap > 0.65 && getDayConfig(state, candidate).type !== 'travel') {
          bufferSuggestions.push(candidate)
          warnings.push(`连续 ${highStreak} 天负载较高，建议把 ${candidate} 调整为轻量缓冲日。`)
        }
      }
      highStreak = 0
    }
  }

  const moves: ReplanMove[] = state.assignments
    .filter(a => oldDates.get(a.id) !== a.scheduledDate)
    .map(a => {
      const g = groups.get(a.groupId)!
      const from = oldDates.get(a.id)
      const to = a.scheduledDate
      const hard = hardRequired.has(a.id)
      const explanation = explainMove(a, g, from, to, hard)
      return {
        assignmentId: a.id,
        title: a.title,
        subject: g.subject,
        from,
        to,
        reason: explanation.reason,
        impact: explanation.impact,
        alternatives: chooseAlternatives(state, stats, a, g, strategy, from),
        wasManual: input.assignments.find(x => x.id === a.id)?.intentStrength === 'manual',
        hardRequired: hard
      }
    })

  const beforeLoads = loadMap(input)
  const afterLoads = loadMap(state)
  const loadChanges: LoadChange[] = dateRange(start, state.settings.endDate)
    .map(date => ({ date, beforeMinutes: beforeLoads.get(date) ?? 0, afterMinutes: afterLoads.get(date) ?? 0, capacity: getCapacity(state, date) }))
    .filter(x => x.beforeMinutes !== x.afterMinutes)

  const dayTypeSuggestions: DayTypeSuggestion[] = []
  for (const date of dateRange(start, state.settings.endDate)) {
    const cfg = getDayConfig(state, date)
    const load = afterLoads.get(date) ?? 0
    if (cfg.type === 'regular' && load > state.settings.regularMinutes && load <= state.settings.studyMinutes + state.settings.studyOverbookMinutes) {
      dayTypeSuggestions.push({ date, from: 'regular', to: 'study', reason: `该日计划 ${load} 分钟，改为学习日可减少超载。`, capacityGain: state.settings.studyMinutes - state.settings.regularMinutes })
    }
  }

  const coreBefore = predictCompletion(input, g => g.priority === 5 && !g.recurring && g.targetDate <= input.settings.coreTargetDate)
  const coreAfter = predictCompletion(state, g => g.priority === 5 && !g.recurring && g.targetDate <= state.settings.coreTargetDate)
  const chemistryBefore = predictCompletion(input, g => g.subject === '化学' && g.title === '预习')
  const chemistryAfter = predictCompletion(state, g => g.subject === '化学' && g.title === '预习')
  const allBefore = predictCompletion(input, g => !g.recurring && g.priority > 0)
  const allAfter = predictCompletion(state, g => !g.recurring && g.priority > 0)
  const titles: Record<ReplanStrategy, string> = { preserve: '最少改动', balanced: '均衡负载', goal: '优先保目标' }
  const descriptions: Record<ReplanStrategy, string> = {
    preserve: '尽量保留现有安排，只修复最明显的冲突。',
    balanced: '兼顾用户安排、每日负载、科目分布和缓冲节奏。',
    goal: '更积极地前置高优先级任务，优先保障阶段目标。'
  }
  const consequences = [
    repairInfo.issues.length ? `本次检测到 ${repairInfo.issues.length} 个待处理问题。` : '当前计划没有明显硬冲突。',
    moves.length ? `将移动 ${moves.length} 项任务。` : '无需移动任务。',
    dayTypeSuggestions.length ? `建议将 ${dayTypeSuggestions.length} 天改为学习日，但不会自动修改。` : '不需要改变日期类型。',
    bufferSuggestions.length ? `检测到连续高负载，建议把 ${[...new Set(bufferSuggestions)].join('、')} 作为轻量缓冲日。` : '当前没有必须插入的缓冲日建议。',
    unresolved.length ? `仍有 ${unresolved.length} 项无法排入，需要增加容量或接受延期。` : '所有候选任务均已找到日期。'
  ]
  state.updatedAt = new Date().toISOString()
  return {
    id: uid('scenario'),
    strategy,
    title: titles[strategy],
    description: descriptions[strategy],
    request,
    nextState: state,
    moves,
    warnings: [...new Set(warnings)],
    consequences,
    dayTypeSuggestions,
    loadChanges,
    summary: {
      moved: moves.length,
      preservedManual: state.assignments.filter(a => a.intentStrength === 'manual' && oldDates.get(a.id) === a.scheduledDate).length,
      locked: state.assignments.filter(a => a.locked).length,
      unresolved: unresolved.length,
      coreBefore, coreAfter, chemistryBefore, chemistryAfter, allBefore, allAfter
    }
  }
}

export function generateReplanBundle(input: AppState, request: ReplanRequest): ReplanBundle {
  const normalized: ReplanRequest = {
    ...request,
    fromDate: request.fromDate || todayISO(),
    freezeDays: request.freezeDays ?? input.settings.freezeDays
  }
  const repairInfo = identifyRepairCandidates(input, normalized)
  const strategies: ReplanStrategy[] = ['preserve', 'balanced', 'goal']
  return {
    request: normalized,
    issues: [...new Set(repairInfo.issues)],
    scenarios: strategies.map(strategy => buildScenario(input, normalized, strategy, repairInfo))
  }
}

// 兼容旧调用：默认返回“均衡负载”方案。
export function replanState(input: AppState, fromDate = todayISO()): ReplanResult {
  const bundle = generateReplanBundle(input, { mode: 'repair', fromDate, freezeDays: input.settings.freezeDays })
  return bundle.scenarios.find(x => x.strategy === 'balanced') ?? bundle.scenarios[0]
}

export interface PlanIssue {
  level: 'info' | 'warning' | 'danger'
  date?: string
  message: string
}

export function analyzePlan(state: AppState, fromDate = state.settings.startDate): PlanIssue[] {
  const groups = groupMap(state)
  const stats = statsMap(state, groups)
  const issues: PlanIssue[] = []
  let highStreak = 0
  for (const date of dateRange(fromDate, state.settings.endDate)) {
    const day = stats.get(date) ?? blankStats()
    const capacity = getCapacity(state, date)
    const soft = softCapacity(state, date)
    const cfg = getDayConfig(state, date)
    if (day.load > soft) issues.push({ level: 'danger', date, message: `${date} 严重超载 ${day.load - capacity} 分钟。` })
    else if (day.load > capacity) issues.push({ level: 'warning', date, message: `${date} 轻度超载 ${day.load - capacity} 分钟。` })
    if (day.taskCount > maxTaskCount(state, date)) issues.push({ level: 'warning', date, message: `${date} 有 ${day.taskCount} 项普通任务，超过建议上限 ${maxTaskCount(state, date)} 项。` })
    if ([...day.memoryByGroup.values()].some(value => value > 2)) issues.push({ level: 'warning', date, message: `${date} 同类记忆任务安排超过 2 项。` })
    const subjectOver = [...day.subjectMinutes.entries()].find(([, minutes]) => day.load > 90 && minutes / day.load > state.settings.subjectShareLimit)
    if (subjectOver) issues.push({ level: 'info', date, message: `${date} 的${subjectOver[0]}占比偏高，建议与其他科目搭配。` })
    if (cfg.type === 'travel') {
      const ordinary = state.assignments.filter(a => a.scheduledDate === date && a.status !== 'done' && !groups.get(a.groupId)?.recurring)
      if (ordinary.length) issues.push({ level: 'warning', date, message: `${date} 是旅游日，但仍有 ${ordinary.length} 项普通任务。` })
    }
    const ratio = capacity > 0 ? day.load / capacity : 0
    highStreak = ratio >= state.settings.highLoadThreshold ? highStreak + 1 : 0
    if (highStreak >= state.settings.highLoadStreak) {
      issues.push({ level: 'info', date, message: `截至 ${date} 已连续 ${highStreak} 天高负载，建议下一天设置为轻量缓冲日。` })
      highStreak = 0
    }
  }
  for (const group of state.taskGroups.filter(g => g.dailyMax && !g.recurring)) {
    for (const date of dateRange(fromDate, state.settings.endDate)) {
      const count = state.assignments.filter(a => a.groupId === group.id && a.scheduledDate === date && a.status !== 'done').length
      if (count > (group.dailyMax ?? Infinity)) issues.push({ level: 'danger', date, message: `${date} 的「${group.title}」超过每日上限 ${group.dailyMax}。` })
    }
  }
  for (const assignment of state.assignments.filter(a => a.status !== 'done' && a.scheduledDate)) {
    const group = groups.get(assignment.groupId)
    if (group && after(assignment.scheduledDate!, group.dueDate)) issues.push({ level: 'danger', date: assignment.scheduledDate, message: `${group.subject}「${assignment.title}」晚于截止日期 ${group.dueDate}。` })
  }
  return issues
}

export function predictCompletion(state: AppState, predicate?: (group: TaskGroup) => boolean): string | undefined {
  const groups = groupMap(state)
  const remaining = state.assignments.filter(a => {
    const g = groups.get(a.groupId)
    return g && a.status !== 'done' && (!predicate || predicate(g))
  })
  if (!remaining.length) return '已完成'
  const scheduled = remaining.map(a => a.scheduledDate).filter(Boolean) as string[]
  if (scheduled.length !== remaining.length) return undefined
  return [...scheduled].sort().at(-1)
}

export function suggestMoveDates(state: AppState, assignmentId: string, limit = 5): string[] {
  const a = state.assignments.find(item => item.id === assignmentId)
  if (!a) return []
  const g = state.taskGroups.find(item => item.id === a.groupId)
  if (!g) return []
  const groups = groupMap(state)
  const excluded = new Set([a.id])
  const stats = statsMap(state, groups, excluded)
  return dateRange(state.settings.startDate, state.settings.endDate)
    .filter(date => !after(date, g.dueDate))
    .filter(date => getDayConfig(state, date).type !== 'travel')
    .filter(date => !g.dailyMax || (stats.get(date)?.groupCounts.get(g.id) ?? 0) < g.dailyMax)
    .map(date => ({ date, score: candidateScore(state, stats, a, g, date, 'balanced', a.scheduledDate) }))
    .sort((x, y) => x.score - y.score || x.date.localeCompare(y.date))
    .slice(0, limit)
    .map(x => x.date)
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
  const group = state.taskGroups.find(g => g.id === groupId)
  if (!group) return undefined
  const completed = state.assignments
    .filter(a => a.groupId === groupId && a.status === 'done' && a.actualMinutes > 0)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  const sampleCount = group.memoryTask ? 5 : 3
  if (completed.length < 3) return undefined
  const values = completed.slice(0, sampleCount).map(a => a.actualMinutes).sort((a, b) => a - b)
  const minutes = group.memoryTask
    ? values[Math.floor(values.length / 2)]
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const differenceMinutes = minutes - group.unitMinutes
  const ratio = group.unitMinutes > 0 ? Math.abs(differenceMinutes) / group.unitMinutes : 1
  if (Math.abs(differenceMinutes) < 10 || ratio < 0.15) return undefined
  return { groupId, minutes, sampleSize: values.length, currentMinutes: group.unitMinutes, differenceMinutes }
}

import { isAfter, isBefore, parseISO } from 'date-fns'
import type { AppState, Assignment, ReplanResult, TaskGroup } from '../types'
import { dateRange, getCapacity, getDayConfig, shiftDate, todayISO } from './date'

function groupMap(state: AppState) {
  return new Map(state.taskGroups.map(g => [g.id, g]))
}

function effectiveMinutes(a: Assignment) {
  const remainingRatio = Math.max(0, 1 - a.progress / 100)
  return Math.max(1, Math.round(a.estimatedMinutes * remainingRatio))
}

export function autoConfigureDayTypes(state: AppState): AppState {
  const next = structuredClone(state)
  const start = state.settings.startDate
  const coreEnd = state.settings.coreTargetDate
  const groups = groupMap(state)
  const coreTaskMinutes = state.assignments
    .filter(a => {
      const g = groups.get(a.groupId)
      return g && g.priority === 5 && !g.recurring && g.targetDate <= coreEnd && a.status !== 'done'
    })
    .reduce((sum, a) => sum + effectiveMinutes(a), 0)

  // 对“每天最多 N 个、目标晚于核心日期”的必做任务，预留必须提前完成的份额。
  // 例如化学预习 15 个、8.20 截止，而 8.9—8.20 只有 12 天，因此至少 3 个必须在 8.8 前完成。
  const dailyLimitedReserve = state.taskGroups
    .filter(g => g.priority === 5 && !g.recurring && g.dailyMax && g.targetDate > coreEnd)
    .reduce((sum, g) => {
      const remainingCount = state.assignments.filter(a => a.groupId === g.id && a.status !== 'done').length
      const postCoreDays = dateRange(shiftDate(coreEnd, 1), g.targetDate).length
      const mustFinishByCore = Math.max(0, remainingCount - postCoreDays * (g.dailyMax ?? 1))
      return sum + mustFinishByCore * g.unitMinutes
    }, 0)
  const coreMinutes = coreTaskMinutes + dailyLimitedReserve

  const dates = dateRange(start, coreEnd)
  for (const date of dateRange(state.settings.startDate, state.settings.endDate)) {
    if (!next.dayConfigs[date]) next.dayConfigs[date] = { date, type: 'regular' }
  }

  const regularCapacity = dates.reduce((sum, date) => {
    const cfg = next.dayConfigs[date]
    if (cfg?.type === 'travel') return sum + state.settings.travelMinutes
    if (cfg?.type === 'custom') return sum + (cfg.customMinutes ?? state.settings.regularMinutes)
    return sum + state.settings.regularMinutes
  }, 0)

  let shortfall = Math.max(0, coreMinutes - regularCapacity)
  const upgradeGain = Math.max(1, state.settings.studyMinutes - state.settings.regularMinutes)
  for (const date of dates) {
    if (shortfall <= 0) break
    const cfg = next.dayConfigs[date]
    if (cfg.type === 'regular') {
      cfg.type = 'study'
      shortfall -= upgradeGain
    }
  }
  next.updatedAt = new Date().toISOString()
  return next
}

function sortAssignments(state: AppState, assignments: Assignment[], reservedByCore: Set<string>) {
  const groups = groupMap(state)
  return [...assignments].sort((a, b) => {
    const ga = groups.get(a.groupId)!
    const gb = groups.get(b.groupId)!
    if (ga.priority !== gb.priority) return gb.priority - ga.priority
    const aReserved = reservedByCore.has(a.id) ? 1 : 0
    const bReserved = reservedByCore.has(b.id) ? 1 : 0
    if (aReserved !== bReserved) return bReserved - aReserved
    if (ga.targetDate !== gb.targetDate) return ga.targetDate.localeCompare(gb.targetDate)
    const aDaily = ga.dailyMax ? 1 : 0
    const bDaily = gb.dailyMax ? 1 : 0
    if (aDaily !== bDaily) return aDaily - bDaily
    if (a.estimatedMinutes !== b.estimatedMinutes) return b.estimatedMinutes - a.estimatedMinutes
    return a.index - b.index
  })
}

export function replanState(input: AppState, fromDate = todayISO()): ReplanResult {
  const state = structuredClone(input)
  const groups = groupMap(state)
  const start = isBefore(parseISO(fromDate), parseISO(state.settings.startDate)) ? state.settings.startDate : fromDate
  const allDates = dateRange(state.settings.startDate, state.settings.endDate)
  const futureDates = allDates.filter(d => !isBefore(parseISO(d), parseISO(start)))
  const used = new Map<string, number>()
  const dailyGroupCounts = new Map<string, number>()
  const oldDates = new Map(state.assignments.map(a => [a.id, a.scheduledDate]))

  for (const a of state.assignments) {
    const g = groups.get(a.groupId)
    if (!g) continue
    const fixedRecurring = g.recurring
    const fixedPast = a.scheduledDate && isBefore(parseISO(a.scheduledDate), parseISO(start))
    const fixed = a.status === 'done' || a.locked || fixedRecurring || fixedPast
    if (!fixed) a.scheduledDate = undefined
    if (a.scheduledDate) {
      const countIt = g.countInStats || state.settings.countWordsTime
      if (countIt) used.set(a.scheduledDate, (used.get(a.scheduledDate) ?? 0) + effectiveMinutes(a))
      const key = `${a.scheduledDate}|${g.id}`
      dailyGroupCounts.set(key, (dailyGroupCounts.get(key) ?? 0) + 1)
    }
  }

  const reservedByCore = new Set<string>()
  for (const g of state.taskGroups.filter(g => g.priority === 5 && !g.recurring && g.dailyMax && g.targetDate > state.settings.coreTargetDate)) {
    const remaining = state.assignments.filter(a => a.groupId === g.id && a.status !== 'done' && !a.locked).sort((a, b) => a.index - b.index)
    const postCoreDays = dateRange(shiftDate(state.settings.coreTargetDate, 1), g.targetDate).length
    const mustFinishByCore = Math.max(0, remaining.length - postCoreDays * (g.dailyMax ?? 1))
    remaining.slice(0, mustFinishByCore).forEach(a => reservedByCore.add(a.id))
  }

  const candidates = sortAssignments(state, state.assignments.filter(a => {
    const g = groups.get(a.groupId)
    return g && !g.recurring && a.status !== 'done' && !a.locked && !a.scheduledDate
  }), reservedByCore)

  const warnings: string[] = []

  for (const a of candidates) {
    const g = groups.get(a.groupId)!
    const minutes = effectiveMinutes(a)
    const target = g.targetDate || g.dueDate
    const permitted = futureDates.filter(date => {
      const cfg = getDayConfig(state, date)
      if (cfg.type === 'travel') return false
      if (g.dailyMax) {
        const key = `${date}|${g.id}`
        if ((dailyGroupCounts.get(key) ?? 0) >= g.dailyMax) return false
      }
      return true
    })

    const beforeTarget = permitted.filter(date => !isAfter(parseISO(date), parseISO(target)))
    const fit = beforeTarget.find(date => (used.get(date) ?? 0) + minutes <= getCapacity(state, date))
      ?? permitted.find(date => !isAfter(parseISO(date), parseISO(g.dueDate)) && (used.get(date) ?? 0) + minutes <= getCapacity(state, date))

    let selected = fit
    if (!selected && permitted.length) {
      const fallbackPool = beforeTarget.length ? beforeTarget : permitted.filter(date => !isAfter(parseISO(date), parseISO(g.dueDate)))
      selected = [...fallbackPool].sort((aDate, bDate) => {
        const aOver = (used.get(aDate) ?? 0) + minutes - getCapacity(state, aDate)
        const bOver = (used.get(bDate) ?? 0) + minutes - getCapacity(state, bDate)
        return aOver - bOver || aDate.localeCompare(bDate)
      })[0]
    }

    if (!selected) {
      warnings.push(`${g.subject}「${a.title}」无法在计划日期范围内安排。`)
      continue
    }

    a.scheduledDate = selected
    if (g.countInStats || state.settings.countWordsTime) used.set(selected, (used.get(selected) ?? 0) + minutes)
    const key = `${selected}|${g.id}`
    dailyGroupCounts.set(key, (dailyGroupCounts.get(key) ?? 0) + 1)
    if (isAfter(parseISO(selected), parseISO(target))) {
      warnings.push(`${g.subject}「${a.title}」预计延后至 ${selected}，超过目标 ${target}。`)
    }
  }

  for (const date of futureDates) {
    const planned = used.get(date) ?? 0
    const capacity = getCapacity(state, date)
    if (planned > capacity) warnings.push(`${date} 计划 ${planned} 分钟，超过容量 ${capacity} 分钟。`)
  }

  const moves = state.assignments
    .filter(a => oldDates.get(a.id) !== a.scheduledDate)
    .map(a => ({ assignmentId: a.id, from: oldDates.get(a.id), to: a.scheduledDate }))

  state.updatedAt = new Date().toISOString()
  return { nextState: state, moves, warnings: [...new Set(warnings)] }
}

export function predictCompletion(state: AppState, predicate?: (group: TaskGroup) => boolean): string | undefined {
  const groups = groupMap(state)
  const remaining = state.assignments.filter(a => {
    const g = groups.get(a.groupId)
    return g && a.status !== 'done' && (!predicate || predicate(g))
  })
  const scheduled = remaining.map(a => a.scheduledDate).filter(Boolean) as string[]
  if (!remaining.length) return '已完成'
  if (scheduled.length !== remaining.length) return undefined
  return scheduled.sort().at(-1)
}

export function suggestMoveDates(state: AppState, assignmentId: string, limit = 5): string[] {
  const a = state.assignments.find(item => item.id === assignmentId)
  if (!a) return []
  const g = state.taskGroups.find(item => item.id === a.groupId)
  if (!g) return []
  const dates = dateRange(state.settings.startDate, state.settings.endDate)
  const used = new Map<string, number>()
  for (const item of state.assignments) {
    if (!item.scheduledDate || item.id === assignmentId) continue
    const itemGroup = state.taskGroups.find(x => x.id === item.groupId)
    if (itemGroup?.countInStats || state.settings.countWordsTime) used.set(item.scheduledDate, (used.get(item.scheduledDate) ?? 0) + effectiveMinutes(item))
  }
  return dates
    .filter(date => getDayConfig(state, date).type !== 'travel')
    .filter(date => !g.dailyMax || state.assignments.filter(x => x.id !== a.id && x.groupId === g.id && x.scheduledDate === date).length < g.dailyMax)
    .sort((d1, d2) => {
      const slack1 = getCapacity(state, d1) - (used.get(d1) ?? 0) - effectiveMinutes(a)
      const slack2 = getCapacity(state, d2) - (used.get(d2) ?? 0) - effectiveMinutes(a)
      const score1 = slack1 >= 0 ? slack1 : 10000 + Math.abs(slack1)
      const score2 = slack2 >= 0 ? slack2 : 10000 + Math.abs(slack2)
      return score1 - score2 || d1.localeCompare(d2)
    })
    .slice(0, limit)
}

export function moveOneDay(date: string, direction: -1 | 1) {
  return shiftDate(date, direction)
}

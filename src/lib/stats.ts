import type { Assignment, DailyPlanBaseline, TaskGroup, TimeEntry } from '../types'
import { nowDate } from './date'

type EntrySource = NonNullable<TimeEntry['source']> | 'legacy'

function isoToday() {
  const now = nowDate()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function dateRangeLocal(start: string, end: string) {
  const result: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

function dailyLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 · ${weekdays[parsed.getUTCDay()]}`
}

export interface DailyRow {
  date: string
  label: string
  shortLabel: string
  planned: number
  actual: number
  extraActual: number
  timerActual: number
  manualActual: number
  legacyActual: number
  movingAverage: number
  plannedTasks: number
  doneTasks: number
  partialTasks: number
  completedEquivalent: number
  taskCompletion: number
  workloadCompletion: number
  lateTasks: number
  focusSessions: number
}

function safeDate(value?: string) {
  if (!value) return undefined
  const date = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function progressFraction(assignment: Assignment) {
  if (assignment.status === 'done') return 1
  if (assignment.status === 'partial') return Math.max(0, Math.min(1, assignment.progress / 100))
  return 0
}

function isActiveGroup(group?: TaskGroup) {
  return Boolean(group && !group.hidden)
}

function isCountedGroup(group: TaskGroup | undefined, countWordsTime: boolean) {
  return Boolean(group && !group.hidden && (group.countInStats || countWordsTime))
}

function within(date: string | undefined, start: string, end: string) {
  return Boolean(date && date >= start && date <= end)
}

/**
 * Build daily statistics from immutable execution records.
 * Time-entry minutes are counted first; only the positive residual between
 * assignment.actualMinutes and recorded entries is assigned once as legacy data.
 */
export function aggregateDaily(
  assignments: Assignment[],
  groups: Map<string, TaskGroup>,
  countWordsTime: boolean,
  start: string,
  end: string,
  baselines: DailyPlanBaseline[] = []
): DailyRow[] {
  const rows = new Map<string, DailyRow>()
  for (const date of dateRangeLocal(start, end)) {
    rows.set(date, {
      date,
      label: dailyLabel(date),
      shortLabel: date.slice(5).replace('-', '.'),
      planned: 0,
      actual: 0,
      extraActual: 0,
      timerActual: 0,
      manualActual: 0,
      legacyActual: 0,
      movingAverage: 0,
      plannedTasks: 0,
      doneTasks: 0,
      partialTasks: 0,
      completedEquivalent: 0,
      taskCompletion: 0,
      workloadCompletion: 0,
      lateTasks: 0,
      focusSessions: 0
    })
  }

  const completedWork = new Map<string, number>()
  const plannedWork = new Map<string, number>()
  const today = isoToday()
  const baselineByDate = new Map(baselines.filter(item => within(item.date, start, end)).map(item => [item.date, item]))
  const assignmentById = new Map(assignments.map(item => [item.id, item]))

  const addActual = (date: string | undefined, minutes: number, counted: boolean, source: EntrySource) => {
    if (!date || minutes <= 0 || !within(date, start, end)) return
    const row = rows.get(date)
    if (!row) return
    if (!counted) {
      row.extraActual += minutes
      return
    }
    row.actual += minutes
    if (source === 'timer') {
      row.timerActual += minutes
      if (minutes >= 1) row.focusSessions += 1
    } else if (source === 'manual' || source === 'finish') {
      row.manualActual += minutes
    } else {
      row.legacyActual += minutes
    }
  }

  for (const assignment of assignments) {
    const group = groups.get(assignment.groupId)
    if (!isActiveGroup(group)) continue
    const counted = isCountedGroup(group, countWordsTime)
    const scheduled = assignment.scheduledDate
    if (scheduled && within(scheduled, start, end) && !baselineByDate.has(scheduled)) {
      const row = rows.get(scheduled)!
      row.plannedTasks += 1
      row.completedEquivalent += progressFraction(assignment)
      if (assignment.status === 'done') row.doneTasks += 1
      if (assignment.status === 'partial') row.partialTasks += 1
      if (scheduled < today && assignment.status !== 'done') row.lateTasks += 1
      if (counted) {
        row.planned += assignment.estimatedMinutes
        plannedWork.set(scheduled, (plannedWork.get(scheduled) ?? 0) + assignment.estimatedMinutes)
        completedWork.set(scheduled, (completedWork.get(scheduled) ?? 0) + assignment.estimatedMinutes * progressFraction(assignment))
      }
    }

    let recorded = 0
    for (const entry of assignment.timeEntries ?? []) {
      const minutes = Math.max(0, Number(entry.minutes) || 0)
      recorded += minutes
      addActual(safeDate(entry.createdAt), minutes, counted, entry.source ?? 'legacy')
    }
    const residual = Math.max(0, assignment.actualMinutes - recorded)
    if (residual > 0) addActual(safeDate(assignment.completedAt) ?? scheduled, residual, counted, 'legacy')
  }

  for (const baseline of baselineByDate.values()) {
    const row = rows.get(baseline.date)
    if (!row) continue
    row.plannedTasks = baseline.assignments.length
    row.doneTasks = 0
    row.partialTasks = 0
    row.completedEquivalent = 0
    row.lateTasks = 0
    row.planned = 0
    plannedWork.set(baseline.date, 0)
    completedWork.set(baseline.date, 0)
    for (const planned of baseline.assignments) {
      const assignment = assignmentById.get(planned.assignmentId)
      const group = groups.get(planned.groupId)
      const progress = assignment ? progressFraction(assignment) : 0
      row.completedEquivalent += progress
      if (assignment?.status === 'done') row.doneTasks += 1
      if (assignment?.status === 'partial') row.partialTasks += 1
      if (baseline.date < today && assignment?.status !== 'done') row.lateTasks += 1
      if (!isCountedGroup(group, countWordsTime)) continue
      row.planned += planned.estimatedMinutes
      plannedWork.set(baseline.date, (plannedWork.get(baseline.date) ?? 0) + planned.estimatedMinutes)
      completedWork.set(baseline.date, (completedWork.get(baseline.date) ?? 0) + planned.estimatedMinutes * progress)
    }
  }

  const result = [...rows.values()]
  for (const row of result) {
    row.taskCompletion = row.plannedTasks ? row.completedEquivalent / row.plannedTasks * 100 : 0
    const planned = plannedWork.get(row.date) ?? 0
    row.workloadCompletion = planned ? (completedWork.get(row.date) ?? 0) / planned * 100 : 0
  }
  for (let index = 0; index < result.length; index += 1) {
    const slice = result.slice(Math.max(0, index - 6), index + 1)
    result[index].movingAverage = Math.round(slice.reduce((sum, item) => sum + item.actual, 0) / slice.length)
  }
  return result
}

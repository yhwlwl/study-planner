import type { Assignment, AssignmentStatusEvent, DailyPlanBaselineAssignment, TaskStatus, TimeEntry } from '../types'
import { uid } from './id'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function safeExecutionDate(value?: string): string | undefined {
  if (!value) return undefined
  const date = value.slice(0, 10)
  return ISO_DATE.test(date) ? date : undefined
}

/** The natural day a ledger entry belongs to. */
export function timeEntryDate(entry: TimeEntry): string | undefined {
  return safeExecutionDate(entry.date) ?? safeExecutionDate(entry.createdAt)
}

export function isInferredTimeEntry(entry: TimeEntry) {
  return entry.source === 'inferred'
}

export function realRecordedMinutes(assignment: Assignment) {
  return (assignment.timeEntries ?? []).reduce((sum, entry) => (
    isInferredTimeEntry(entry) ? sum : sum + Math.max(0, Number(entry.minutes) || 0)
  ), 0)
}

export function inferredRecordedMinutes(assignment: Assignment) {
  return (assignment.timeEntries ?? []).reduce((sum, entry) => (
    isInferredTimeEntry(entry) ? sum + Math.max(0, Number(entry.minutes) || 0) : sum
  ), 0)
}

export function appendStatusEvent(
  assignment: Assignment,
  status: TaskStatus,
  progress: number,
  date: string,
  source: AssignmentStatusEvent['source'],
  createdAt = new Date().toISOString(),
) {
  const normalizedProgress = status === 'done' ? 100 : Math.max(0, Math.min(99, Math.round(progress)))
  const previous = assignment.statusHistory?.at(-1)
  if (previous && previous.status === status && previous.progress === normalizedProgress && previous.date === date) return
  assignment.statusHistory = [...(assignment.statusHistory ?? []), {
    id: uid('status'), date, createdAt, status, progress: normalizedProgress, source,
  }].slice(-500)
}

export interface HistoricalAssignmentState {
  status: TaskStatus
  progress: number
  exact: boolean
}

/**
 * Reconstruct execution state at the end of a natural day.
 * New states use the baseline capture plus append-only events. Legacy fallbacks are
 * deliberately marked inexact so the UI/report layer can disclose estimation.
 */
export function assignmentStateAtDate(
  assignment: Assignment | undefined,
  date: string,
  baseline?: DailyPlanBaselineAssignment,
): HistoricalAssignmentState {
  if (!assignment) return { status: baseline?.statusAtCapture ?? 'todo', progress: baseline?.progressAtCapture ?? 0, exact: false }

  let status: TaskStatus = baseline?.statusAtCapture ?? 'todo'
  let progress = baseline?.progressAtCapture ?? 0
  let exact = baseline?.statusAtCapture !== undefined
  const events = [...(assignment.statusHistory ?? [])]
    .filter(event => event.date <= date)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt))

  if (events.length) {
    const latest = events.at(-1)!
    status = latest.status
    progress = latest.progress
    exact = true
  } else if (assignment.completedAt) {
    const completedDate = safeExecutionDate(assignment.completedAt)
    if (completedDate && completedDate <= date) {
      status = 'done'
      progress = 100
      exact = true
    }
  } else if (!baseline && safeExecutionDate(assignment.updatedAt) && safeExecutionDate(assignment.updatedAt)! <= date) {
    status = assignment.status
    progress = assignment.progress
  }

  return { status, progress, exact }
}

export function addInferredCompletionEntry(assignment: Assignment, date: string, createdAt = new Date().toISOString()) {
  if ((assignment.timeEntries ?? []).some(entry => entry.source === 'inferred' && timeEntryDate(entry) === date)) return
  assignment.timeEntries.push({
    id: uid('time'),
    minutes: Math.max(1, assignment.remainingMinutes ?? assignment.estimatedMinutes),
    date,
    createdAt,
    source: 'inferred',
    countInStatistics: false,
  })
}

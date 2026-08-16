import { describe, expect, it } from 'vitest'
import { aggregateDaily } from '../src/lib/stats'
import { assignmentStateAtDate, isInferredTimeEntry } from '../src/lib/execution'
import { buildBlankState, buildGuestDemoState, normalizeState } from '../src/lib/seed'
import { validateStateInput } from '../src/lib/state-schema'
import { buildStatisticsCsv, buildStatisticsReportHtml, buildTaskTableSvg } from '../src/lib/exports'
import { generateReplanBundle } from '../src/lib/planner'
import { shiftDate, todayISO } from '../src/lib/date'
import type { Assignment, TaskGroup } from '../src/types'

function fixture() {
  const group: TaskGroup = {
    id: 'group-history', subject: '数学', title: '历史口径测试', priority: 3, quantity: 1, unitMinutes: 100,
    targetDate: '2026-08-11', dueDate: '2026-08-15', countInStats: true, status: 'active', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
  }
  const assignment: Assignment = {
    id: 'task-history', groupId: group.id, index: 1, title: group.title, scheduledDate: '2026-08-11', estimatedMinutes: 100,
    actualMinutes: 100, progress: 100, status: 'done', locked: false, timeEntries: [
      { id: 'entry-yesterday', minutes: 50, date: '2026-08-10', createdAt: '2026-08-10T23:00:00.000Z', source: 'manual' },
      { id: 'entry-today', minutes: 50, date: '2026-08-11', createdAt: '2026-08-11T23:00:00.000Z', source: 'manual' },
    ],
    statusHistory: [{ id: 'status-today', date: '2026-08-11', createdAt: '2026-08-11T23:30:00.000Z', status: 'done', progress: 100, source: 'completion' }],
    scheduleSource: 'system', intentStrength: 'normal', createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-11T23:30:00.000Z',
  }
  return { group, assignment }
}

describe('execution ledger and historical state', () => {
  it('keeps yesterday todo after the task is completed today', () => {
    const { assignment } = fixture()
    const baseline = { assignmentId: assignment.id, groupId: assignment.groupId, title: assignment.title, estimatedMinutes: 100, statusAtCapture: 'todo' as const, progressAtCapture: 0 }
    expect(assignmentStateAtDate(assignment, '2026-08-10', baseline)).toMatchObject({ status: 'todo', progress: 0 })
    expect(assignmentStateAtDate(assignment, '2026-08-11', baseline)).toMatchObject({ status: 'done', progress: 100 })
  })

  it('attributes manual execution to the selected natural day', () => {
    const { group, assignment } = fixture()
    const rows = aggregateDaily([assignment], new Map([[group.id, group]]), false, '2026-08-10', '2026-08-11', [
      { id: 'baseline-10', date: '2026-08-10', capturedAt: '2026-08-10T23:59:00.000Z', assignments: [{ assignmentId: assignment.id, groupId: group.id, title: group.title, estimatedMinutes: 100, statusAtCapture: 'todo', progressAtCapture: 0 }] },
      { id: 'baseline-11', date: '2026-08-11', capturedAt: '2026-08-11T23:59:00.000Z', assignments: [{ assignmentId: assignment.id, groupId: group.id, title: group.title, estimatedMinutes: 100, statusAtCapture: 'done', progressAtCapture: 100 }] },
    ])
    expect(rows.map(row => row.actual)).toEqual([50, 50])
    expect(rows[0].doneTasks).toBe(0)
    expect(rows[1].doneTasks).toBe(1)
  })

  it('separates inferred completion from real execution', () => {
    const { assignment } = fixture()
    assignment.actualMinutes = 0
    assignment.timeEntries = [{ id: 'inferred', minutes: 100, date: '2026-08-11', createdAt: '2026-08-11T23:30:00.000Z', source: 'inferred', countInStatistics: false }]
    expect(isInferredTimeEntry(assignment.timeEntries[0])).toBe(true)
    const row = aggregateDaily([assignment], new Map([[fixture().group.id, fixture().group]]), false, '2026-08-11', '2026-08-11')[0]
    expect(row.actual).toBe(0)
    expect(row.inferred).toBe(100)
  })

  it('keeps exports aligned with the selected execution date and evidence labels', () => {
    const { group, assignment } = fixture()
    const state = buildBlankState()
    state.settings.startDate = '2026-08-10'
    state.settings.endDate = '2026-08-11'
    state.taskGroups = [group]
    state.assignments = [assignment]
    const csv = buildStatisticsCsv(state, { start: '2026-08-10', end: '2026-08-11' })
    expect(csv).toContain('真实实际分钟')
    expect(csv).toContain('推断时间分钟')
    expect(csv).toContain('2026-08-10')
    const imageState = { ...state, assignments: [{ ...assignment, scheduledDate: '2026-08-10' }] }
    expect(buildTaskTableSvg(imageState, { start: '2026-08-10', end: '2026-08-10' }, ['date', 'task', 'actual'])).toContain('50 分')

    const noRecord = { ...assignment, id: 'task-no-record', actualMinutes: 0, timeEntries: [], status: 'done' as const }
    state.assignments = [assignment, noRecord]
    expect(buildStatisticsReportHtml(state, { start: '2026-08-10', end: '2026-08-11' })).toContain('无记录完成')
  })
})

describe('state ingress validation', () => {
  it('accepts current blank and demo states before normalization', () => {
    expect(validateStateInput(buildBlankState(), 'snapshot').success).toBe(true)
    expect(validateStateInput(buildGuestDemoState(), 'snapshot').success).toBe(true)
  })

  it('rejects malformed top-level data without throwing', () => {
    const result = validateStateInput({ version: 11, taskGroups: 'not-an-array' }, 'json')
    expect(result.success).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('normalizes legacy states while retaining a usable revision', () => {
    const state = normalizeState({ ...buildBlankState(), version: 10, schemaVersion: 10, dataRevision: undefined })
    expect(state.schemaVersion).toBe(11)
    expect(state.dataRevision).toBeGreaterThan(0)
  })
})

describe('planner cache safety', () => {
  it('does not reuse a legacy preview for a different state with the same timestamp', () => {
    const today = todayISO()
    const group: TaskGroup = {
      id: 'group-cache', subject: '鏁板', title: '缂撳瓨閿佸畾', priority: 3, quantity: 1, unitMinutes: 30,
      targetDate: shiftDate(today, 5), dueDate: shiftDate(today, 7), countInStats: true,
      status: 'active', createdAt: 'same', updatedAt: 'same',
    }
    const assignment: Assignment = {
      id: 'task-cache', groupId: group.id, index: 1, title: group.title, scheduledDate: shiftDate(today, 1),
      estimatedMinutes: 30, actualMinutes: 0, progress: 0, status: 'todo', locked: false, timeEntries: [],
      scheduleSource: 'system', intentStrength: 'normal', createdAt: 'same', updatedAt: 'same',
    }
    const first = { ...buildBlankState(), updatedAt: 'same', dataRevision: undefined, taskGroups: [group], assignments: [assignment] }
    const second = { ...first, assignments: [{ ...assignment, scheduledDate: shiftDate(today, 2) }] }
    const request = { mode: 'repair' as const, fromDate: today }
    const firstDate = generateReplanBundle(first, request, ['preserve']).scenarios[0]?.nextState.assignments[0]?.scheduledDate
    const secondDate = generateReplanBundle(second, request, ['preserve']).scenarios[0]?.nextState.assignments[0]?.scheduledDate
    expect(firstDate).toBe(shiftDate(today, 1))
    expect(secondDate).toBe(shiftDate(today, 2))
  })
})

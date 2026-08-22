import { describe, expect, it } from 'vitest'
import { buildBlankState, createAssignmentsForGroup } from '../src/lib/seed'
import { currentConflictsScope } from '../src/components/AdjustmentIntentDialog'
import type { AppState, TaskGroup } from '../src/types'

function withTasks(): AppState {
  const base = buildBlankState()
  const now = new Date().toISOString()
  const group: TaskGroup = {
    id: 'group-1', subject: '数学', title: '测试组', priority: 3,
    quantity: 5, sourceQuantity: 5, unitMinutes: 40,
    targetDate: base.settings.endDate, dueDate: base.settings.endDate,
    recurring: false, countInStats: true, activityType: 'normal',
    highIntensity: false, allowSplit: false, prerequisiteGroupIds: [],
    status: 'active', createdAt: now, updatedAt: now,
  }
  const assignments = createAssignmentsForGroup(group).map((item, index) => ({
    ...item,
    createdAt: now,
    updatedAt: now,
    scheduledDate: index === 0 ? '2026-08-01' : index === 1 ? '2026-08-25' : undefined,
  }))
  return { ...base, taskGroups: [group], assignments, goals: [], intakeBatches: [] }
}

describe('currentConflictsScope（修复当前计划问题必须纳入未安排任务）', () => {
  it('包含逾期任务与全部未安排任务，且每次都返回稳定集合', () => {
    const state = withTasks()
    const scope = currentConflictsScope(state)
    const overdue = state.assignments.find(item => item.scheduledDate === '2026-08-01')!
    const unscheduled = state.assignments.filter(item => item.scheduledDate === undefined).map(item => item.id)
    expect(scope).toContain(overdue.id)
    for (const id of unscheduled) expect(scope).toContain(id)
    expect(new Set(scope).size).toBe(scope.length)
    // 无危险问题日期时，正常已排任务不进入修复范围
    const scheduledFuture = state.assignments.find(item => item.scheduledDate === '2026-08-25')!
    expect(scope).not.toContain(scheduledFuture.id)
  })

  it('没有未安排任务时只包含逾期与危险日期上的任务', () => {
    const base = buildBlankState()
    const now = new Date().toISOString()
    const group: TaskGroup = {
      id: 'group-2', subject: '语文', title: '测试组2', priority: 3,
      quantity: 2, sourceQuantity: 2, unitMinutes: 30,
      targetDate: base.settings.endDate, dueDate: base.settings.endDate,
      recurring: false, countInStats: true, activityType: 'normal',
      highIntensity: false, allowSplit: false, prerequisiteGroupIds: [],
      status: 'active', createdAt: now, updatedAt: now,
    }
    const assignments = createAssignmentsForGroup(group).map(item => ({ ...item, createdAt: now, updatedAt: now, scheduledDate: '2026-08-25' }))
    const state: AppState = { ...base, taskGroups: [group], assignments, goals: [], intakeBatches: [] }
    const scope = currentConflictsScope(state)
    expect(scope.length).toBe(0)
  })
})
import { describe, expect, it } from 'vitest'
import { buildBlankState, createAssignmentsForGroup } from '../src/lib/seed'
import { generateSchedulingProposals } from '../src/lib/planner'
import { uid } from '../src/lib/id'
import type { AppState, Goal, PlanChangeEvent, TaskGroup } from '../src/types'

const NOW = '2026-08-21'
const END = '2026-08-30'
// 90 分钟长任务合计 21 个（数学套卷 3 + 化学套题 12 + 语文卷 6），其余为短任务。
const ROWS: Array<[string, string, number, number]> = [
  ['数学套卷', '数学', 3, 90],
  ['数学订正', '数学', 4, 30],
  ['物理作业', '物理', 18, 40],
  ['化学套题', '化学', 12, 90],
  ['生物作业', '生物', 12, 60],
  ['语文卷', '语文', 6, 90],
  ['英语卷', '英语', 10, 50],
  ['英语专项', '英语', 40, 10],
]

function buildPrepared(settingsPatch: Partial<AppState['settings']>): AppState {
  const base = buildBlankState()
  const next: AppState = {
    ...base,
    settings: {
      ...base.settings,
      startDate: NOW,
      endDate: END,
      coreTargetDate: END,
      chemistryTargetDate: END,
      ...settingsPatch,
    },
    dayConfigs: Object.fromEntries(['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'].map(date => [date, { date, type: 'study' as const, availableMinutes: 1440, userSet: true }])),
    taskGroups: [],
    assignments: [],
    goals: [],
    intakeBatches: [],
  }
  for (const [title, subject, quantity, unitMinutes] of ROWS) {
    const group: TaskGroup = {
      id: uid('group'), subject: subject as TaskGroup['subject'], title, priority: 3,
      quantity, sourceQuantity: quantity, unitMinutes,
      targetDate: END, dueDate: END, dailyMax: undefined,
      recurring: false, countInStats: true, activityType: 'normal',
      highIntensity: false, allowSplit: false, prerequisiteGroupIds: [],
      status: 'active', createdAt: NOW, updatedAt: NOW,
    }
    next.taskGroups.push(group)
    next.assignments.push(...createAssignmentsForGroup(group).map(item => ({ ...item, createdAt: NOW, updatedAt: NOW })))
    const goal: Goal = {
      id: uid('goal'), title: `${title}完成目标`, description: '由录入批次创建。', priority: 3,
      latestDate: END, status: 'active',
      completionConditions: [{ id: uid('condition'), groupId: group.id, mode: 'all' }],
      linkedTaskGroupIds: [group.id], linkedAssignmentIds: [],
      createdAt: NOW, updatedAt: NOW,
    }
    next.goals.push(goal)
  }
  return next
}

function buildEvent(prepared: AppState): PlanChangeEvent {
  return {
    id: uid('event'), type: 'new-task-insertion', action: 'insert',
    title: '安排录入批次：课堂清单', description: '统一加入录入内容并生成任务；确认方案前不会改变正式计划。',
    affectedGoalIds: prepared.goals.map(goal => goal.id),
    affectedGroupIds: prepared.taskGroups.map(group => group.id),
    affectedAssignmentIds: prepared.assignments.map(item => item.id),
    affectedDates: [END], createdAt: NOW,
    metadata: { intakeBatchId: uid('batch'), intakeItemIds: [], preferredPreferences: ['preserve', 'balanced'] },
  }
}

function run(label: string, settingsPatch: Partial<AppState['settings']>) {
  const prepared = buildPrepared(settingsPatch)
  const event = buildEvent(prepared)
  const proposals = generateSchedulingProposals(prepared, event, { baseline: buildBlankState(), expansionLevel: 0 })
  const picked = proposals[0]
  const unscheduled = prepared.assignments.filter(item => picked?.stateAfter.assignments.find(a => a.id === item.id)?.scheduledDate === undefined && event.affectedAssignmentIds.includes(item.id)).length
  const goalRisks = (picked?.goalImpacts ?? []).filter(impact => impact.latestRiskAfter || impact.desiredRiskAfter).length
  return { label, infeasible: picked?.infeasible === true, unscheduled, goalRisks, reason: picked?.infeasibleReason ?? '' }
}

describe('可配置长任务阈值与每日上限', () => {
  it('默认 90 分钟 / 学习日 2 个：10 天 21 个长任务有任务无法安排并产生目标风险', () => {
    const result = run('default', {})
    expect(result.infeasible).toBe(true)
    expect(result.unscheduled).toBeGreaterThan(0)
    expect(result.goalRisks).toBeGreaterThan(0)
  })

  it('放宽为学习日每天 4 个长任务后全部排下（10x4=40 >= 21）', () => {
    const result = run('max-4', { longTaskMaxPerDay: 4, longTaskMaxPerDayLight: 4 })
    expect(result.infeasible).toBe(false)
    expect(result.unscheduled).toBe(0)
    expect(result.goalRisks).toBe(0)
  })

  it('阈值提高到 120 分钟后 90 分钟任务不再算长任务，全部排下', () => {
    const result = run('threshold-120', { longTaskThresholdMinutes: 120 })
    expect(result.infeasible).toBe(false)
    expect(result.unscheduled).toBe(0)
    expect(result.goalRisks).toBe(0)
  })
})
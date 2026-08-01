import type { AppState, PlanChangeEvent, PlanVersion, SchedulingProposal } from '../types'
import { uid } from './id'
import { portableState } from './state'
import { normalizeState } from './seed'

function affectedDates(before: AppState, after: AppState): string[] {
  const dates = new Set<string>()
  const beforeById = new Map(before.assignments.map(item => [item.id, item]))
  for (const item of after.assignments) {
    const previous = beforeById.get(item.id)
    if (previous?.scheduledDate !== item.scheduledDate) {
      if (previous?.scheduledDate) dates.add(previous.scheduledDate)
      if (item.scheduledDate) dates.add(item.scheduledDate)
    }
  }
  return [...dates].sort()
}

function scheduledMinutes(state: AppState): number {
  return state.assignments.filter(item => item.scheduledDate && item.status !== 'done').reduce((sum, item) => sum + Math.max(0, item.remainingMinutes ?? item.estimatedMinutes), 0)
}

export function createPlanVersion(before: AppState, after: AppState, event: PlanChangeEvent, reason: string): PlanVersion {
  const changedDates = affectedDates(before, after)
  return {
    id: uid('version'), timestamp: new Date().toISOString(), reason, eventType: event.type,
    affectedGoalIds: event.affectedGoalIds,
    affectedGroupIds: event.affectedGroupIds,
    affectedAssignmentIds: event.affectedAssignmentIds,
    affectedDates: Array.from(new Set([...event.affectedDates, ...changedDates])).sort(),
    summary: {
      goalCount: after.goals.length,
      groupCount: after.taskGroups.length,
      assignmentCount: after.assignments.length,
      completedCount: after.assignments.filter(item => item.status === 'done').length,
      scheduledMinutes: scheduledMinutes(after),
      movedTaskCount: after.assignments.filter(item => before.assignments.find(previous => previous.id === item.id)?.scheduledDate !== item.scheduledDate).length,
      affectedDateCount: changedDates.length,
    },
    beforeState: JSON.stringify(portableState(before)),
    afterState: JSON.stringify(portableState(after)),
    schemaVersion: after.schemaVersion,
    localOnly: true,
  }
}

export function createVersionFromProposal(before: AppState, after: AppState, event: PlanChangeEvent, proposal: SchedulingProposal): PlanVersion {
  return {
    ...createPlanVersion(before, after, event, `${event.title} · ${proposal.title}`),
    preference: proposal.preference,
    proposalTitle: proposal.title,
    proposalDescription: proposal.description,
    exceptionSummaries: proposal.exceptions.map(item => `${item.date} · ${item.label}${item.overrideLimit != null ? ` → ${item.overrideLimit}` : ''}`),
    manualOverrideCount: proposal.metrics.manualTaskMoveCount,
  }
}


/** 某项任务是否已经形成不能被旧快照抹掉的真实执行事实。 */
function hasImmutableExecution(state: AppState, assignmentId: string) {
  const item = state.assignments.find(candidate => candidate.id === assignmentId)
  if (!item) return false
  return item.actualMinutes > 0 || item.progress > 0 || item.status !== 'todo'
    || Boolean(item.completedAt) || (item.timeEntries?.length ?? 0) > 0
    || state.timer.assignmentId === item.id
}

/**
 * 把旧计划结构恢复为当前草稿，同时保留所有真实执行事实。
 * 旧快照中不存在、但之后已经执行过的任务也必须继续存在，不能“恢复”掉历史。
 */
export function restoreSnapshotState(current: AppState, snapshot: string): AppState {
  const portable = JSON.parse(snapshot) as AppState
  const restored = normalizeState({
    ...portable,
    replanHistory: current.replanHistory,
    conflictBackups: current.conflictBackups,
    planVersions: current.planVersions,
  })
  const currentById = new Map(current.assignments.map(item => [item.id, item]))
  restored.assignments = restored.assignments.map(item => {
    const execution = currentById.get(item.id)
    if (!execution) return item
    return {
      ...item,
      actualMinutes: execution.actualMinutes,
      progress: execution.progress,
      status: execution.status,
      completedAt: execution.completedAt,
      timeEntries: execution.timeEntries,
      remainingMinutes: execution.remainingMinutes,
    }
  })

  const restoredIds = new Set(restored.assignments.map(item => item.id))
  const restoredGroupIds = new Set(restored.taskGroups.map(item => item.id))
  for (const currentTask of current.assignments) {
    if (restoredIds.has(currentTask.id) || !hasImmutableExecution(current, currentTask.id)) continue
    const group = current.taskGroups.find(item => item.id === currentTask.groupId)
    if (group && !restoredGroupIds.has(group.id)) {
      restored.taskGroups.push(structuredClone(group))
      restoredGroupIds.add(group.id)
    }
    restored.assignments.push(structuredClone(currentTask))
    restoredIds.add(currentTask.id)
  }

  restored.timer = current.timer
  restored.reviewRecords = current.reviewRecords
  restored.lastCloudSyncAt = current.lastCloudSyncAt
  restored.templateKind = current.templateKind
  restored.updatedAt = new Date().toISOString()
  return normalizeState(restored)
}

/**
 * 恢复旧计划时，计时记录、实际分钟、完成状态和完成日期属于不可逆执行事实，始终取当前值。
 */
export function restoreVersionState(current: AppState, version: PlanVersion, side: 'before' | 'after' = 'after'): AppState {
  return restoreSnapshotState(current, side === 'after' ? version.afterState : version.beforeState)
}

export interface VersionDiffSummary {
  moved: Array<{ id: string; title: string; from?: string; to?: string }>
  added: Array<{ id: string; title: string }>
  removed: Array<{ id: string; title: string }>
  goalChanges: Array<{ id: string; title: string; before?: string; after?: string }>
}

export function previewVersionDiff(current: AppState, version: PlanVersion, side: 'before' | 'after' = 'after'): VersionDiffSummary {
  const target = normalizeState({
    ...(JSON.parse(side === 'after' ? version.afterState : version.beforeState) as AppState),
    replanHistory: [], conflictBackups: [], planVersions: [],
  })
  const currentById = new Map(current.assignments.map(item => [item.id, item]))
  const targetById = new Map(target.assignments.map(item => [item.id, item]))
  const moved = target.assignments.flatMap(item => {
    const before = currentById.get(item.id)
    return before && before.scheduledDate !== item.scheduledDate ? [{ id: item.id, title: item.title, from: before.scheduledDate, to: item.scheduledDate }] : []
  })
  const added = target.assignments.filter(item => !currentById.has(item.id)).map(item => ({ id: item.id, title: item.title }))
  const removed = current.assignments.filter(item => !targetById.has(item.id)).map(item => ({ id: item.id, title: item.title }))
  const currentGoals = new Map(current.goals.map(goal => [goal.id, goal]))
  const goalChanges: VersionDiffSummary['goalChanges'] = target.goals.flatMap<VersionDiffSummary['goalChanges'][number]>(goal => {
    const before = currentGoals.get(goal.id)
    if (!before) return [{ id: goal.id, title: goal.title, before: undefined, after: `${goal.desiredDate ?? '无希望日期'} / ${goal.latestDate}` }]
    const oldText = `${before.desiredDate ?? '无希望日期'} / ${before.latestDate}`
    const newText = `${goal.desiredDate ?? '无希望日期'} / ${goal.latestDate}`
    return oldText === newText ? [] : [{ id: goal.id, title: goal.title, before: oldText, after: newText }]
  })
  return { moved, added, removed, goalChanges }
}

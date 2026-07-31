import type { AppState, Assignment, Goal, GoalCondition, GoalProgress } from '../types'

function groupAssignments(state: AppState, groupId: string): Assignment[] {
  return state.assignments
    .filter(item => item.groupId === groupId)
    .sort((a, b) => a.index - b.index || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}


function completionTimestampForIds(state: AppState, ids: Iterable<string>): string | undefined {
  const timestamps = [...ids].flatMap(id => {
    const item = state.assignments.find(candidate => candidate.id === id)
    if (!item || item.status !== 'done') return []
    return [item.completedAt ?? (item.scheduledDate ? `${item.scheduledDate}T23:59:59.999Z` : '')].filter(Boolean)
  }).sort()
  return timestamps.at(-1)
}

export function requiredCount(condition: GoalCondition, total: number): number {
  if (condition.mode === 'all') return total
  if (condition.mode === 'count') return Math.min(total, Math.max(0, Math.ceil(condition.value ?? 0)))
  return Math.min(total, Math.max(0, Math.ceil(total * Math.max(0, Math.min(100, condition.value ?? 0)) / 100)))
}

/**
 * 目标进度按条件分别计算，再用 assignment id 去重形成解释性集合。
 * 条件进度不会因同一任务同时被“组条件”和“直接任务链接”而重复计数。
 */
export function goalProgress(state: AppState, goal: Goal): GoalProgress {
  const counted = new Set<string>()
  const remaining = new Set<string>()
  const conditionDetails: GoalProgress['conditionDetails'] = []
  let requiredTotal = 0
  let completedTotal = 0

  for (const condition of goal.completionConditions) {
    const assignments = groupAssignments(state, condition.groupId)
    const required = requiredCount(condition, assignments.length)
    const completedAssignments = assignments.filter(item => item.status === 'done')
    const selectedCompleted = completedAssignments.slice(0, required)
    const selectedRemaining = assignments
      .filter(item => item.status !== 'done')
      .slice(0, Math.max(0, required - selectedCompleted.length))
    const selected = [...selectedCompleted, ...selectedRemaining]
    selected.forEach(item => counted.add(item.id))
    selectedRemaining.forEach(item => remaining.add(item.id))
    requiredTotal += required
    completedTotal += Math.min(required, completedAssignments.length)
    conditionDetails.push({
      conditionId: condition.id,
      groupId: condition.groupId,
      mode: condition.mode,
      required,
      completed: Math.min(required, completedAssignments.length),
      countedAssignmentIds: selected.map(item => item.id),
    })
  }

  for (const assignmentId of goal.linkedAssignmentIds) {
    const item = state.assignments.find(candidate => candidate.id === assignmentId)
    if (!item || counted.has(item.id)) continue
    counted.add(item.id)
    requiredTotal += 1
    if (item.status === 'done') completedTotal += 1
    else remaining.add(item.id)
  }

  const remainingAssignments = state.assignments.filter(item => remaining.has(item.id))
  const hasUnscheduledRemaining = remainingAssignments.some(item => !item.scheduledDate)
  const expectedCompletion = hasUnscheduledRemaining
    ? undefined
    : remainingAssignments
      .map(item => item.scheduledDate)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1)
  // 没有任何有效完成条件的目标不能自动变成“已完成”。
  const completed = requiredTotal > 0 && completedTotal >= requiredTotal
  const progress = requiredTotal === 0 ? 0 : Math.min(1, completedTotal / requiredTotal)
  const actualCompletionTimestamp = completed ? completionTimestampForIds(state, counted) : undefined
  const actualCompletionDate = actualCompletionTimestamp?.slice(0, 10)
  return {
    goalId: goal.id,
    progress,
    completed,
    requiredCount: requiredTotal,
    completedCount: completedTotal,
    remainingAssignmentIds: [...remaining],
    countedAssignmentIds: [...counted],
    estimatedRemainingMinutes: remainingAssignments.reduce((sum, item) => sum + Math.max(0, item.remainingMinutes ?? (item.estimatedMinutes - item.actualMinutes)), 0),
    expectedCompletion,
    actualCompletionDate,
    desiredRisk: Boolean(goal.desiredDate && (!expectedCompletion || expectedCompletion > goal.desiredDate) && !completed),
    latestRisk: Boolean((!expectedCompletion || expectedCompletion > goal.latestDate) && !completed),
    desiredMet: completed && goal.desiredDate ? Boolean(actualCompletionDate && actualCompletionDate <= goal.desiredDate) : undefined,
    latestMet: completed ? Boolean(actualCompletionDate && actualCompletionDate <= goal.latestDate) : undefined,
    conditionDetails,
  }
}

export function allGoalProgress(state: AppState): GoalProgress[] {
  return state.goals.map(goal => goalProgress(state, goal))
}

export function updateGoalAndGroupLifecycle(state: AppState): AppState {
  const now = new Date().toISOString()
  const goals = state.goals.map(goal => {
    if (goal.status === 'archived') return goal
    const progress = goalProgress(state, goal)
    const completionTimestamp = progress.completed ? completionTimestampForIds(state, progress.countedAssignmentIds) ?? now : undefined
    if (progress.completed && goal.status !== 'completed') return { ...goal, status: 'completed' as const, completedAt: completionTimestamp, updatedAt: now }
    if (!progress.completed && goal.status === 'completed') return { ...goal, status: 'active' as const, completedAt: undefined, updatedAt: now }
    if (progress.completed && goal.status === 'completed' && goal.completedAt !== completionTimestamp) return { ...goal, completedAt: completionTimestamp, updatedAt: now }
    return goal
  })
  const taskGroups = state.taskGroups.map(group => {
    if (group.status === 'archived') return group
    const items = state.assignments.filter(item => item.groupId === group.id)
    const complete = items.length > 0 && items.every(item => item.status === 'done')
    const quantity = items.length
    const completionTimestamp = complete ? completionTimestampForIds(state, items.map(item => item.id)) ?? now : undefined
    if (complete && group.status !== 'completed') return { ...group, status: 'completed' as const, completedAt: completionTimestamp, updatedAt: now, quantity }
    if (!complete && group.status === 'completed') return { ...group, status: 'active' as const, completedAt: undefined, updatedAt: now, quantity }
    if (complete && group.status === 'completed' && group.completedAt !== completionTimestamp) return { ...group, completedAt: completionTimestamp, updatedAt: now, quantity }
    return group.quantity === quantity ? group : { ...group, quantity }
  })
  return { ...state, goals, taskGroups }
}

function conditionCountedAssignmentIds(state: AppState, condition: GoalCondition): Set<string> {
  const assignments = groupAssignments(state, condition.groupId)
  const required = requiredCount(condition, assignments.length)
  const completed = assignments.filter(item => item.status === 'done').slice(0, required)
  const remaining = assignments
    .filter(item => item.status !== 'done')
    .slice(0, Math.max(0, required - completed.length))
  return new Set([...completed, ...remaining].map(item => item.id))
}

/**
 * 部分完成目标只约束为达到条件所需的那部分任务。
 * 例如“8 月 15 日前完成化学组 50%”不会把该组剩余 50% 也强行提前。
 */
function goalAppliesToAssignment(state: AppState, goal: Goal, assignment: Assignment): boolean {
  if (goal.linkedAssignmentIds.includes(assignment.id)) return true
  const conditions = goal.completionConditions.filter(condition => condition.groupId === assignment.groupId)
  if (conditions.length > 0) return conditions.some(condition => conditionCountedAssignmentIds(state, condition).has(assignment.id))
  return goal.linkedTaskGroupIds.includes(assignment.groupId)
}

export function nearestRelevantGoalDate(state: AppState, assignment: Assignment): string | undefined {
  return relevantGoalsForAssignment(state, assignment)
    .filter(goal => goal.status === 'active')
    .map(goal => goal.desiredDate ?? goal.latestDate)
    .sort()[0]
}

export function relevantGoalsForAssignment(state: AppState, assignment: Assignment): Goal[] {
  return state.goals.filter(goal => goalAppliesToAssignment(state, goal, assignment))
}

export function goalNamesForAssignment(state: AppState, assignment: Assignment): string[] {
  return relevantGoalsForAssignment(state, assignment).map(goal => goal.title)
}

export function nearestRelevantLatestDate(state: AppState, assignment: Assignment): string | undefined {
  return relevantGoalsForAssignment(state, assignment)
    .filter(goal => goal.status === 'active')
    .map(goal => goal.latestDate)
    .sort()[0]
}

/**
 * 目标数量不会叠加权重：先选最近的有效目标期限，只有期限相同的目标才用优先级打破平局。
 */
export function relevantGoalPriority(state: AppState, assignment: Assignment): number {
  const active = relevantGoalsForAssignment(state, assignment).filter(goal => goal.status === 'active')
  if (!active.length) return 0
  const nearest = active.map(goal => goal.desiredDate ?? goal.latestDate).sort()[0]
  return Math.max(0, ...active
    .filter(goal => (goal.desiredDate ?? goal.latestDate) === nearest)
    .map(goal => goal.priority ?? 0))
}


import type { AppState, Assignment, Goal, GoalCondition, GoalProgress } from '../types'

function groupAssignments(state: AppState, groupId: string): Assignment[] {
  return state.assignments
    .filter(item => item.groupId === groupId)
    .sort((a, b) => a.index - b.index || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
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
  const expectedCompletion = remainingAssignments
    .map(item => item.scheduledDate)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)
  const completed = requiredTotal === 0 || completedTotal >= requiredTotal
  const progress = requiredTotal === 0 ? 1 : Math.min(1, completedTotal / requiredTotal)
  return {
    goalId: goal.id,
    progress,
    completed,
    requiredCount: requiredTotal,
    completedCount: completedTotal,
    remainingAssignmentIds: [...remaining],
    countedAssignmentIds: [...counted],
    estimatedRemainingMinutes: remainingAssignments.reduce((sum, item) => sum + Math.max(0, (item.remainingMinutes ?? item.estimatedMinutes) - item.actualMinutes), 0),
    expectedCompletion,
    desiredRisk: Boolean(goal.desiredDate && (!expectedCompletion || expectedCompletion > goal.desiredDate) && !completed),
    latestRisk: Boolean((!expectedCompletion || expectedCompletion > goal.latestDate) && !completed),
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
    const complete = goalProgress(state, goal).completed
    if (complete && goal.status !== 'completed') return { ...goal, status: 'completed' as const, completedAt: now, updatedAt: now }
    if (!complete && goal.status === 'completed') return { ...goal, status: 'active' as const, completedAt: undefined, updatedAt: now }
    return goal
  })
  const taskGroups = state.taskGroups.map(group => {
    if (group.status === 'archived') return group
    const items = state.assignments.filter(item => item.groupId === group.id)
    const complete = items.length > 0 && items.every(item => item.status === 'done')
    const quantity = items.length
    if (complete && group.status !== 'completed') return { ...group, status: 'completed' as const, completedAt: now, updatedAt: now, quantity }
    if (!complete && group.status === 'completed') return { ...group, status: 'active' as const, completedAt: undefined, updatedAt: now, quantity }
    return group.quantity === quantity ? group : { ...group, quantity }
  })
  return { ...state, goals, taskGroups }
}

export function nearestRelevantGoalDate(state: AppState, assignment: Assignment): string | undefined {
  const dates = state.goals
    .filter(goal => goal.status === 'active')
    .filter(goal => goal.linkedAssignmentIds.includes(assignment.id)
      || goal.linkedTaskGroupIds.includes(assignment.groupId)
      || goal.completionConditions.some(condition => condition.groupId === assignment.groupId))
    .map(goal => goal.desiredDate ?? goal.latestDate)
    .sort()
  return dates[0]
}

export function relevantGoalsForAssignment(state: AppState, assignment: Assignment): Goal[] {
  return state.goals.filter(goal => goal.linkedAssignmentIds.includes(assignment.id)
    || goal.linkedTaskGroupIds.includes(assignment.groupId)
    || goal.completionConditions.some(condition => condition.groupId === assignment.groupId))
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

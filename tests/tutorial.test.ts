import { describe, expect, it } from 'vitest'
import { analyzePlan, generateSchedulingProposals, suggestMoveDates } from '../src/lib/planner'
import { parsePastedText } from '../src/lib/intake'
import { hydratePortableState } from '../src/lib/state'
import { resetNowProvider, setNowProvider, shiftDate, todayISO } from '../src/lib/date'
import {
  TUTORIAL_EXECUTE_ASSIGNMENT_ID,
  TUTORIAL_GOAL_ID,
  TUTORIAL_INTAKE_BATCH_ID,
  TUTORIAL_PARTIAL_ASSIGNMENT_ID,
  TUTORIAL_STEPS,
  TUTORIAL_UNFINISHED_ASSIGNMENT_ID,
  TUTORIAL_VERSION,
  advanceTutorialSession,
  buildTutorialCheckpoint,
  buildTutorialState,
  clearTutorialSession,
  createTutorialSession,
  recoverTutorialSession,
  tutorialAcceptsEvent,
  tutorialAllowsCommit,
  tutorialIssueCount,
  tutorialNaturalLanguageText,
  tutorialPageForStep,
  tutorialStateHealth,
  type TutorialSession,
  type TutorialStep,
} from '../src/lib/tutorial'
import type { PlanChangeEvent, SchedulingPreference } from '../src/types'

const anchor = '2026-08-17'

function session(step: TutorialStep): TutorialSession {
  return {
    version: TUTORIAL_VERSION,
    anchorDate: anchor,
    step,
    returnNamespace: 'guest',
    returnHadData: false,
    returnPage: 'today',
    startedAt: `${anchor}T08:00:00.000Z`,
    updatedAt: `${anchor}T08:00:00.000Z`,
  }
}

function repairEvent(before = buildTutorialState(anchor)): PlanChangeEvent {
  const overdue = before.assignments.filter(item => item.status !== 'done' && item.scheduledDate && item.scheduledDate < anchor)
  const hard = analyzePlan(before, anchor).filter(issue => issue.level === 'danger')
  const affectedDates = Array.from(new Set([
    ...overdue.flatMap(item => item.scheduledDate ? [item.scheduledDate] : []),
    ...hard.flatMap(issue => issue.date ? [issue.date] : []),
  ]))
  const affectedAssignmentIds = Array.from(new Set([
    ...overdue.map(item => item.id),
    ...before.assignments.filter(item => item.status !== 'done' && item.scheduledDate && affectedDates.includes(item.scheduledDate)).map(item => item.id),
  ]))
  const affectedGroupIds = Array.from(new Set(before.assignments.filter(item => affectedAssignmentIds.includes(item.id)).map(item => item.groupId)))
  const affectedGoalIds = before.goals.filter(goal => goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id))
    || goal.linkedTaskGroupIds.some(id => affectedGroupIds.includes(id))
    || goal.completionConditions.some(condition => affectedGroupIds.includes(condition.groupId))).map(goal => goal.id)
  return {
    id: 'tutorial-real-repair', type: 'execution-difference', action: 'repair', title: '修复当前计划问题',
    description: '教程真实调度修复', affectedGoalIds, affectedGroupIds, affectedAssignmentIds, affectedDates,
    createdAt: `${anchor}T12:00:00.000Z`, metadata: { requestedOutcome: 'fix-current', sourceDate: anchor, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
  }
}

function futureEvent(state: ReturnType<typeof buildTutorialCheckpoint>, preference: SchedulingPreference): PlanChangeEvent {
  const from = shiftDate(anchor, 1)
  const ids = state.assignments.filter(item => item.status !== 'done' && !item.locked && item.scheduledDate && item.scheduledDate >= from).map(item => item.id)
  return {
    id: `tutorial-future-${preference}`,
    type: 'future-replanning', action: 'rebuild', title: '重新安排剩余计划', description: `教程未来重排：${preference}`,
    affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: ids, affectedDates: [from], createdAt: `${anchor}T21:00:00.000Z`,
    metadata: { preferredPreference: preference, preferredPreferences: [preference, ...(['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]).filter(item => item !== preference)], requestedOutcome: preference, fromDate: from, includeToday: false, todayExtraMinutes: 0 },
  }
}

const stableSteps: TutorialStep[] = [
  'repair-entry', 'repair-calendar', 'goal-existing', 'intake-entry',
  'intake-schedule', 'intake-calendar', 'execute-complete', 'execute-partial', 'review-entry', 'review-calendar',
  'stats', 'stats-detail', 'future-entry', 'future-calendar', 'complete', 'free',
]

describe('tutorial v2 flow and checkpoints', () => {
  it('keeps the exact guided route in the required order', () => {
    expect(TUTORIAL_STEPS).toEqual([
      'repair-entry','repair-action','repair-preview','repair-calendar','goal-existing',
      'intake-entry','intake-source','intake-parse','intake-schedule','intake-preview','intake-calendar',
      'execute-complete','execute-partial','review-entry','review-carry','review-preview','review-calendar',
      'stats','stats-detail','future-entry','future-action','future-preview','future-calendar','complete','free',
    ])
    expect(tutorialPageForStep('repair-calendar')).toBe('calendar')
    expect(tutorialPageForStep('goal-existing')).toBe('goals')
    expect(tutorialPageForStep('intake-entry')).toBe('intake')
    expect(tutorialPageForStep('stats')).toBe('stats')
  })

  it('builds a healthy deterministic checkpoint for every stable stage', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    for (const step of stableSteps) {
      const state = buildTutorialCheckpoint(step, anchor)
      expect(tutorialStateHealth(state, session(step)), step).toEqual({ ok: true })
    }
    resetNowProvider()
  })

  it('opens with exactly the three teaching problems plus completed/locked protection', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const state = buildTutorialState(anchor)
    expect(tutorialIssueCount(state, anchor)).toBe(3)
    expect(state.assignments.find(item => item.id === 'tutorial-task-done')?.status).toBe('done')
    expect(state.assignments.find(item => item.id === 'tutorial-task-locked')).toMatchObject({ locked: true, status: 'done', scheduledDate: anchor })
    expect(state.assignments.find(item => item.id === 'tutorial-task-overdue')?.scheduledDate).toBe(shiftDate(anchor, -1))
    expect((state.assignments.find(item => item.id === 'tutorial-task-goal-risk')?.scheduledDate ?? '') > state.goals.find(item => item.id === TUTORIAL_GOAL_ID)!.latestDate).toBe(true)
    expect(analyzePlan(state, anchor).some(issue => issue.level === 'danger')).toBe(true)
    resetNowProvider()
  })

  it('parses the fixed natural-language demo into the four intended structured groups', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const text = tutorialNaturalLanguageText(anchor)
    const result = parsePastedText(text)
    expect(result.issues).toEqual([])
    expect(result.drafts).toHaveLength(4)
    expect(result.drafts.map(item => [item.title, item.subject, item.quantity, item.unitMinutes])).toEqual([
      ['数学卷子', '数学', 2, 60],
      ['英语阅读', '英语', 3, 30],
      ['读书报告', '其他', 1, 90],
      ['整理物理错题', '物理', 1, 45],
    ])
    expect(result.drafts[2].latestDate).toBe(shiftDate(anchor, 7))
    resetNowProvider()
  })

  it('repairs through the real scheduler, moves work, improves the goal signal, and preserves completed/locked work', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const before = buildTutorialState(anchor)
    const event = repairEvent(before)
    const prepared = structuredClone(before)
    prepared.changeEvents = [...prepared.changeEvents, event]
    const proposals = generateSchedulingProposals(prepared, event, { baseline: before, expansionLevel: 0 })
    const teaching = proposals.filter(item => !item.infeasible && item.movements.length > 0 && item.goalImpacts.some(goal =>
      (goal.latestRiskBefore && !goal.latestRiskAfter)
      || (goal.desiredRiskBefore && !goal.desiredRiskAfter)
      || Boolean(goal.beforeExpectedCompletion && goal.afterExpectedCompletion && goal.afterExpectedCompletion < goal.beforeExpectedCompletion)))
    expect(teaching.length).toBeGreaterThan(0)
    const next = hydratePortableState(teaching[0].stateAfter, { replanHistory: before.replanHistory, conflictBackups: before.conflictBackups, planVersions: before.planVersions })
    expect(tutorialStateHealth(next, session('repair-calendar'))).toEqual({ ok: true })
    for (const id of ['tutorial-task-done', 'tutorial-task-locked']) {
      expect(next.assignments.find(item => item.id === id)).toEqual(before.assignments.find(item => item.id === id))
    }
    expect(next.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)?.scheduledDate).toBe(anchor)
    resetNowProvider()
  })

  it('keeps parsed intake, formal scheduling, execution, review and stats checkpoints distinct', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const parsed = buildTutorialCheckpoint('intake-schedule', anchor)
    const batch = parsed.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)!
    expect(batch.taskGroups).toHaveLength(4)
    expect(batch.taskGroups.every(item => !item.appliedAt && item.goalIds.length === 0)).toBe(true)

    const scheduled = buildTutorialCheckpoint('intake-calendar', anchor)
    expect(scheduled.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)?.status).toBe('applied')
    expect(scheduled.assignments.filter(item => item.groupId.startsWith('tutorial-added-'))).toHaveLength(7)
    expect(scheduled.goals.some(item => item.title === '读书报告完成目标')).toBe(true)

    const complete = buildTutorialCheckpoint('execute-partial', anchor)
    expect(complete.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)).toMatchObject({ status: 'done', actualMinutes: 52 })

    const reviewed = buildTutorialCheckpoint('review-entry', anchor)
    expect(reviewed.assignments.find(item => item.id === TUTORIAL_PARTIAL_ASSIGNMENT_ID)).toMatchObject({ status: 'partial', progress: 50, actualMinutes: 12 })
    expect(reviewed.assignments.find(item => item.id === TUTORIAL_UNFINISHED_ASSIGNMENT_ID)?.status).toBe('todo')
    expect(reviewed.reviewRecords).toHaveLength(0)

    const stats = buildTutorialCheckpoint('stats', anchor)
    expect(stats.reviewRecords.some(item => item.date === anchor)).toBe(true)
    expect(stats.assignments.some(item => item.scheduledDate === anchor && item.status !== 'done' && !item.locked)).toBe(false)
    resetNowProvider()
  })

  it('always leaves a legal review carry target for the two unfinished teaching tasks', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const state = buildTutorialCheckpoint('review-entry', anchor)
    const unfinished = state.assignments.filter(item => item.scheduledDate === anchor && item.status !== 'done' && !item.locked)
    expect(unfinished.map(item => item.id).sort()).toEqual([TUTORIAL_PARTIAL_ASSIGNMENT_ID, TUTORIAL_UNFINISHED_ASSIGNMENT_ID].sort())
    for (const item of unfinished) expect(suggestMoveDates(state, item.id, 8).some(date => date > anchor)).toBe(true)
    resetNowProvider()
  })

  it('supports all four visible future preferences and can produce a real future movement', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00`))
    const baseline = buildTutorialCheckpoint('future-entry', anchor)
    for (const preference of ['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]) {
      const event = futureEvent(baseline, preference)
      const prepared = structuredClone(baseline)
      prepared.changeEvents = [...prepared.changeEvents, event]
      const feasible = generateSchedulingProposals(prepared, event, { baseline, expansionLevel: 0 }).filter(item => !item.infeasible)
      expect(feasible.length, preference).toBeGreaterThan(0)
    }
    const goalEvent = futureEvent(baseline, 'goal')
    const goalPrepared = structuredClone(baseline)
    goalPrepared.changeEvents = [...goalPrepared.changeEvents, goalEvent]
    const moved = generateSchedulingProposals(goalPrepared, goalEvent, { baseline, expansionLevel: 0 }).filter(item => !item.infeasible && item.movements.length > 0)
    expect(moved.length).toBeGreaterThan(0)
    resetNowProvider()
  })
})

describe('tutorial v2 recovery and action gates', () => {
  it('pins tutorial today to entry day and recovers every transient step safely', () => {
    clearTutorialSession()
    const created = createTutorialSession('guest', false, anchor, 'today')
    expect(todayISO()).toBe(anchor)
    const recoveries: Array<[TutorialStep, TutorialStep]> = [
      ['repair-action', 'repair-entry'], ['repair-preview', 'repair-entry'], ['intake-source', 'intake-entry'], ['intake-parse', 'intake-entry'], ['intake-preview', 'intake-schedule'],
      ['review-carry', 'review-entry'], ['review-preview', 'review-entry'], ['future-action', 'future-entry'], ['future-preview', 'future-entry'],
    ]
    for (const [from, to] of recoveries) expect(recoverTutorialSession({ ...created, step: from }).step).toBe(to)
    const next = advanceTutorialSession(created, 'repair-entry', 'repair-action')
    expect(advanceTutorialSession(next, 'repair-entry', 'repair-action')).toBe(next)
    clearTutorialSession()
    resetNowProvider()
  })

  it('accepts only the expected smart event at repair/intake/review/future steps', () => {
    const repair = { type: 'execution-difference', metadata: { requestedOutcome: 'fix-current' } } as PlanChangeEvent
    const intake = { type: 'new-task-insertion', metadata: { intakeBatchId: TUTORIAL_INTAKE_BATCH_ID } } as PlanChangeEvent
    const review = { type: 'execution-difference', metadata: { reviewDate: anchor } } as PlanChangeEvent
    const future = { type: 'future-replanning', metadata: {} } as PlanChangeEvent
    expect(tutorialAcceptsEvent(session('repair-action'), repair)).toBe(true)
    expect(tutorialAcceptsEvent(session('repair-action'), intake)).toBe(false)
    expect(tutorialAcceptsEvent(session('intake-schedule'), intake)).toBe(true)
    expect(tutorialAcceptsEvent(session('review-carry'), review)).toBe(true)
    expect(tutorialAcceptsEvent(session('future-action'), future)).toBe(true)
  })

  it('allows only the explicit tutorial mutations before free exploration', () => {
    expect(tutorialAllowsCommit(session('intake-parse'), 'intake-import')).toBe(true)
    expect(tutorialAllowsCommit(session('goal-create'), 'goal-create')).toBe(false)
    expect(tutorialAllowsCommit(session('goal-link'), 'goal-link')).toBe(false)
    expect(tutorialAllowsCommit(session('execute-complete'), 'execute-task', TUTORIAL_EXECUTE_ASSIGNMENT_ID)).toBe(true)
    expect(tutorialAllowsCommit(session('execute-complete'), 'execute-task', TUTORIAL_PARTIAL_ASSIGNMENT_ID)).toBe(false)
    expect(tutorialAllowsCommit(session('execute-partial'), 'execute-task', TUTORIAL_PARTIAL_ASSIGNMENT_ID)).toBe(true)
    expect(tutorialAllowsCommit(session('free'), 'anything', TUTORIAL_GOAL_ID)).toBe(true)
  })
})

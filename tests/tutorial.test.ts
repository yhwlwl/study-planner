import { describe, expect, it } from 'vitest'
import { analyzePlan, generateSchedulingProposals, suggestMoveDates } from '../src/lib/planner'
import { hydratePortableState } from '../src/lib/state'
import { resetNowProvider, setNowProvider, shiftDate, todayISO } from '../src/lib/date'
import {
  TUTORIAL_EXECUTE_ASSIGNMENT_ID,
  TUTORIAL_GOAL_ID,
  TUTORIAL_VERSION,
  advanceTutorialSession,
  buildTutorialCheckpoint,
  buildTutorialFutureFrom,
  buildTutorialRepairedFrom,
  buildTutorialScheduledFrom,
  buildTutorialState,
  clearTutorialSession,
  createTutorialSession,
  recoverTutorialSession,
  tutorialAcceptsEvent,
  tutorialAllowsCommit,
  tutorialIssueCount,
  tutorialStateHealth,
  type TutorialSession,
  type TutorialStep,
} from '../src/lib/tutorial'
import type { PlanChangeEvent } from '../src/types'

const anchor = '2026-08-16'

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

describe('interactive tutorial checkpoints', () => {
  it('keeps every stable checkpoint healthy and deterministic', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00Z`))
    const stable: TutorialStep[] = ['repair-entry', 'goal', 'intake', 'execute', 'review-entry', 'future-entry', 'complete', 'free']
    for (const step of stable) {
      const state = buildTutorialCheckpoint(step, anchor)
      expect(tutorialStateHealth(state, session(step))).toEqual({ ok: true })
    }
  })

  it('starts with exactly three understandable problems and repairs them without touching history protection', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00Z`))
    const before = buildTutorialState(anchor)
    expect(tutorialIssueCount(before, anchor)).toBe(3)
    expect(analyzePlan(before, anchor).filter(issue => issue.level === 'danger')).toHaveLength(2)

    const historicalBefore = structuredClone(before.assignments.find(item => item.id === 'tutorial-task-done'))
    const lockedBefore = structuredClone(before.assignments.find(item => item.id === 'tutorial-task-locked'))
    const after = buildTutorialRepairedFrom(before, anchor)

    expect(after.assignments.find(item => item.id === 'tutorial-task-done')).toEqual(historicalBefore)
    expect(after.assignments.find(item => item.id === 'tutorial-task-locked')).toEqual(lockedBefore)
    expect(after.assignments.find(item => item.id === 'tutorial-task-overdue')?.scheduledDate).toBe(shiftDate(anchor, 1))
    expect(after.assignments.find(item => item.id === 'tutorial-task-goal-risk')?.scheduledDate).toBe(shiftDate(anchor, 4))
    expect(analyzePlan(after, anchor).some(issue => issue.level === 'danger')).toBe(false)
  })

  it('real repair scheduling can pass the first tutorial checkpoint without a forced recovery', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00Z`))
    const before = buildTutorialState(anchor)
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
    const event: PlanChangeEvent = {
      id: 'tutorial-real-repair', type: 'execution-difference', action: 'repair', title: '修复当前计划问题',
      description: '教程真实调度修复', affectedGoalIds, affectedGroupIds, affectedAssignmentIds, affectedDates,
      createdAt: `${anchor}T12:00:00.000Z`, metadata: { requestedOutcome: 'fix-current', sourceDate: anchor, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    }
    const prepared = structuredClone(before)
    prepared.changeEvents = [...prepared.changeEvents, event]
    const proposals = generateSchedulingProposals(prepared, event, { baseline: before, expansionLevel: 0 })
    const feasible = proposals.filter(item => !item.infeasible)
    expect(feasible.length).toBeGreaterThan(0)
    const next = hydratePortableState(feasible[0].stateAfter, { replanHistory: before.replanHistory, conflictBackups: before.conflictBackups, planVersions: before.planVersions })
    expect(tutorialStateHealth(next, session('goal'))).toEqual({ ok: true })
    expect(next.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)?.scheduledDate).toBe(anchor)
    expect(next.assignments.find(item => item.id === 'tutorial-task-review-leftover')?.scheduledDate).toBe(anchor)
  })

  it('adds one canonical intake batch and applies five new tasks exactly once', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00Z`))
    const repaired = buildTutorialCheckpoint('intake', anchor)
    const once = buildTutorialScheduledFrom(repaired, anchor)
    const twice = buildTutorialScheduledFrom(once, anchor)

    expect(once.assignments).toHaveLength(13)
    expect(twice.assignments).toHaveLength(13)
    expect(once.intakeBatches.find(item => item.id === 'tutorial-intake-batch')?.status).toBe('applied')
    expect(once.intakeBatches.find(item => item.id === 'tutorial-intake-batch')?.taskGroups.every(item => Boolean(item.appliedAt))).toBe(true)
    expect(tutorialStateHealth(once, session('execute'))).toEqual({ ok: true })
  })

  it('keeps review and future replanning deterministic while preserving completed and locked work', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00Z`))
    const reviewed = buildTutorialCheckpoint('future-entry', anchor)
    expect(reviewed.reviewRecords.some(item => item.date === anchor)).toBe(true)
    expect(reviewed.assignments.some(item => item.scheduledDate === anchor && item.status !== 'done' && !item.locked)).toBe(false)

    const protectedIds = ['tutorial-task-done', 'tutorial-task-locked', TUTORIAL_EXECUTE_ASSIGNMENT_ID]
    const protectedBefore = new Map(protectedIds.map(id => [id, structuredClone(reviewed.assignments.find(item => item.id === id))]))
    const future = buildTutorialFutureFrom(reviewed, anchor)

    for (const id of protectedIds) expect(future.assignments.find(item => item.id === id)).toEqual(protectedBefore.get(id))
    expect(future.assignments.find(item => item.id === 'tutorial-task-english-future')?.scheduledDate).toBe(shiftDate(anchor, 5))
    expect(future.assignments.find(item => item.id === 'tutorial-added-reading-1')?.scheduledDate).toBe(shiftDate(anchor, 3))
    expect(tutorialStateHealth(future, session('complete'))).toEqual({ ok: true })
  })


  it('keeps the review carry target fixed to the next legal day and bounds execution time', () => {
    setNowProvider(() => new Date(`${anchor}T12:00:00Z`))
    const review = buildTutorialCheckpoint('review-entry', anchor)
    const leftover = review.assignments.find(item => item.id === 'tutorial-task-review-leftover')!
    expect(suggestMoveDates(review, leftover.id, 8)).toContain(shiftDate(anchor, 1))

    const tooLong = structuredClone(review)
    const executed = tooLong.assignments.find(item => item.id === TUTORIAL_EXECUTE_ASSIGNMENT_ID)!
    executed.actualMinutes = 66
    executed.timeEntries = [{ id: 'too-long', minutes: 66, createdAt: `${anchor}T12:00:00.000Z`, source: 'manual', countInStatistics: true }]
    expect(tutorialStateHealth(tooLong, session('review-entry')).ok).toBe(false)
  })

  it('pins tutorial today to the entry date and recovers transient steps safely', () => {
    clearTutorialSession()
    const created = createTutorialSession('guest', false, anchor, 'today')
    expect(todayISO()).toBe(anchor)

    const transient = advanceTutorialSession(created, 'repair-entry', 'repair-action')
    expect(transient.step).toBe('repair-action')
    const duplicate = advanceTutorialSession(transient, 'repair-entry', 'repair-action')
    expect(duplicate).toBe(transient)
    expect(recoverTutorialSession(transient).step).toBe('repair-entry')
    clearTutorialSession()
    resetNowProvider()
  })
})

describe('interactive tutorial action gates', () => {
  it('only accepts the expected business event for the active tutorial step', () => {
    const repairEvent = {
      type: 'execution-difference',
      metadata: { requestedOutcome: 'fix-current' },
    } as PlanChangeEvent
    const intakeEvent = {
      type: 'new-task-insertion',
      metadata: { intakeBatchId: 'tutorial-intake-batch' },
    } as PlanChangeEvent
    const reviewEvent = {
      type: 'execution-difference',
      metadata: { reviewDate: anchor },
    } as PlanChangeEvent
    const futureEvent = { type: 'future-replanning', metadata: {} } as PlanChangeEvent

    expect(tutorialAcceptsEvent(session('repair-action'), repairEvent)).toBe(true)
    expect(tutorialAcceptsEvent(session('repair-action'), intakeEvent)).toBe(false)
    expect(tutorialAcceptsEvent(session('intake'), intakeEvent)).toBe(true)
    expect(tutorialAcceptsEvent(session('review-carry'), reviewEvent)).toBe(true)
    expect(tutorialAcceptsEvent(session('future-action'), futureEvent)).toBe(true)
  })

  it('allows only the designated execution mutation before free exploration', () => {
    expect(tutorialAllowsCommit(session('execute'), 'execute-task', TUTORIAL_EXECUTE_ASSIGNMENT_ID)).toBe(true)
    expect(tutorialAllowsCommit(session('execute'), 'execute-task', 'other-task')).toBe(false)
    expect(tutorialAllowsCommit(session('goal'), 'execute-task', TUTORIAL_EXECUTE_ASSIGNMENT_ID)).toBe(false)
    expect(tutorialAllowsCommit(session('free'), 'anything', TUTORIAL_GOAL_ID)).toBe(true)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repairTutorialGoalLinkRace } from '../src/components/TutorialRuntimeGuard'
import {
  TUTORIAL_INTAKE_BATCH_ID,
  TUTORIAL_NEW_GOAL_ID,
  TUTORIAL_VERSION,
  buildTutorialCheckpoint,
  tutorialAllowsCommit,
  type TutorialSession,
} from '../src/lib/tutorial'

function sessionAt(step: TutorialSession['step']): TutorialSession {
  return {
    version: TUTORIAL_VERSION,
    anchorDate: '2026-08-18',
    step,
    returnNamespace: 'guest',
    returnHadData: false,
    returnPage: 'intake',
    startedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }
}

describe('教程目标关联竞态保护', () => {
  it('教程已经进入排期阶段时会补齐被 React 写保护竞态丢掉的最后一次目标关联', () => {
    const state = buildTutorialCheckpoint('intake-schedule', '2026-08-18')
    const batch = state.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)
    expect(batch).toBeTruthy()
    const last = batch!.taskGroups.at(-1)!
    last.goalIds = []

    const repaired = repairTutorialGoalLinkRace(state, 'intake-schedule')
    const repairedBatch = repaired?.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)

    expect(repaired).toBeTruthy()
    expect(repairedBatch?.taskGroups.every(item => item.kind === 'single' || (item.goalIds.length === 1 && item.goalIds[0] === TUTORIAL_NEW_GOAL_ID))).toBe(true)
    expect(last.goalIds).toEqual([])
  })

  it('还在加入目标步骤时不代替用户完成操作', () => {
    const state = buildTutorialCheckpoint('goal-link', '2026-08-18')
    expect(repairTutorialGoalLinkRace(state, 'goal-link')).toBeUndefined()
  })

  it('最后一次合法的目标保存即使 updater 在 intake-schedule 才执行也不会被写保护拒绝', () => {
    expect(tutorialAllowsCommit(sessionAt('goal-link'), 'tutorial-goal-link', TUTORIAL_INTAKE_BATCH_ID)).toBe(true)
    expect(tutorialAllowsCommit(sessionAt('intake-schedule'), 'tutorial-goal-link', TUTORIAL_INTAKE_BATCH_ID)).toBe(true)
    expect(tutorialAllowsCommit(sessionAt('intake-preview'), 'tutorial-goal-link', TUTORIAL_INTAKE_BATCH_ID)).toBe(false)
  })

  it('目标关联未进入 React state 前必须拦截生成排期，修复后才重放点击', () => {
    const source = readFileSync(new URL('../src/components/TutorialRuntimeGuard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('[data-tutorial-action="schedule-intake"]')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain('event.stopPropagation()')
    expect(source).toContain('pending.button.click()')
    expect(source).toContain('if (repairTutorialGoalLinkRace(state, session.step)) return')
  })
})

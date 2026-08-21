import { describe, expect, it } from 'vitest'
import { isBlockingDecisionIssue, preferredAutoResolution } from '../src/lib/conflicts'
import type { ProposalIssue } from '../src/types'

function issue(partial: Partial<ProposalIssue>): ProposalIssue {
  return {
    id: 'issue-1',
    type: 'unscheduled',
    title: 't',
    detail: 'd',
    assignmentIds: ['assignment-1'],
    consequence: 'c',
    resolution: 'r',
    ...partial,
  }
}

describe('isBlockingDecisionIssue（未安排不阻塞，真实硬冲突阻塞）', () => {
  it('汇总“仍有任务未安排”问题（无 rawConstraintKey）不阻塞', () => {
    expect(isBlockingDecisionIssue(issue({ type: 'unscheduled', title: '仍有任务未安排' }))).toBe(false)
  })

  it('bundle“计划影响”类说明问题（无 rawConstraintKey）不阻塞', () => {
    expect(isBlockingDecisionIssue(issue({ type: 'unscheduled', title: '计划影响' }))).toBe(false)
  })

  it('真实容量硬冲突（capacity + rawConstraintKey）阻塞', () => {
    expect(isBlockingDecisionIssue(issue({
      type: 'capacity', rawConstraintKey: 'capacity', conflictCategory: 'waivable-rule',
      allowedResolutions: ['accept-once', 'system-find-another-date', 'leave-unscheduled'],
    }))).toBe(true)
  })

  it('日期保护冲突阻塞', () => {
    expect(isBlockingDecisionIssue(issue({ type: 'date-protection', rawConstraintKey: 'date-protection' }))).toBe(true)
  })

  it('目标风险阻塞', () => {
    expect(isBlockingDecisionIssue(issue({ type: 'goal-risk', rawConstraintKey: 'goal-latest' }))).toBe(true)
  })

  it('锁定/计时等绝对阻塞阻塞', () => {
    expect(isBlockingDecisionIssue(issue({ type: 'active-timer' }))).toBe(true)
  })

  it('fallback 映射为 unscheduled 但带 rawConstraintKey 的真实硬事实仍阻塞', () => {
    expect(isBlockingDecisionIssue(issue({ type: 'unscheduled', rawConstraintKey: 'weekly-capacity' }))).toBe(true)
  })
})

describe('preferredAutoResolution（一次豁免全部的自动决策）', () => {
  it('容量/长任务等可豁免冲突优先接受一次性例外', () => {
    expect(preferredAutoResolution(issue({
      type: 'capacity', rawConstraintKey: 'capacity', conflictCategory: 'waivable-rule',
      allowedResolutions: ['accept-once', 'system-find-another-date', 'leave-unscheduled'],
    }))).toBe('accept-once')
  })

  it('没有 accept-once 时退回暂不安排', () => {
    expect(preferredAutoResolution(issue({
      type: 'goal-risk', rawConstraintKey: 'goal-latest',
      allowedResolutions: ['system-find-another-date', 'leave-unscheduled', 'change-goal', 'cancel-change'],
    }))).toBe('leave-unscheduled')
  })

  it('绝对阻塞（已完成/锁定/计时）不可自动豁免', () => {
    expect(preferredAutoResolution(issue({
      type: 'active-timer',
      allowedResolutions: ['keep-original', 'cancel-change'],
    }))).toBeUndefined()
  })
})
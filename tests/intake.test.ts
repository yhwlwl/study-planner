import { describe, expect, it } from 'vitest'
import { buildIntakeCsvTemplate, parseTableRows, remapIntakeTable, splitSessionCount } from '../src/lib/intake'
import { createAssignmentsForGroup } from '../src/lib/seed'
import type { TaskGroup } from '../src/types'

describe('intake import last mile', () => {
  it('keeps invalid rows in place and exposes editable mappings', () => {
    const result = parseTableRows([
      ['任务组名称', '科目', '数量', '单项分钟', '偏好排期日'],
      ['数学卷', '数学', 'not-a-number', '90', '2026-08-12'],
      ['英语阅读', '英语', '2', '30', '2026-08-13'],
    ])
    expect(result.reviewRows).toHaveLength(2)
    expect(result.reviewRows?.[0].sourceRow).toBe(2)
    expect(result.reviewRows?.[0].issues.length).toBeGreaterThan(0)
    expect(result.drafts).toHaveLength(1)
    expect(result.table?.mapping).toContain('preferredDate')

    const remapped = remapIntakeTable(result.table!, result.table!.mapping.map((field, index) => index === 2 ? 'ignore' : index === 3 ? 'quantity' : field))
    expect(remapped.reviewRows?.[0].issues.length).toBe(0)
    expect(remapped.drafts[0].quantity).toBe(90)
  })

  it('distinguishes preferred and fixed dates and counts real split sessions', () => {
    const result = parseTableRows([
      ['任务组名称', '单项分钟', '数量', '偏好排期日', '固定排期日', '允许拆分', '每段分钟'],
      ['论文整理', '125', '2', '2026-08-12', '', '是', '45'],
    ])
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].preferredDate).toBe('2026-08-12')
    expect(result.drafts[0].fixedDate).toBeUndefined()
    expect(splitSessionCount(result.drafts[0])).toBe(6)
  })

  it('ships a complete UTF-8 CSV template', () => {
    const template = buildIntakeCsvTemplate()
    expect(template.startsWith('\uFEFF')).toBe(true)
    expect(template).toContain('偏好排期日')
    expect(template).toContain('固定排期日')
    expect(template).toContain('重复星期')
    expect(template).toContain('前置任务组')
  })

  it('creates independently schedulable assignments for split work', () => {
    const assignments = createAssignmentsForGroup({
      id: 'split-group', title: '论文整理', subject: '语文', priority: 3, quantity: 6, sourceQuantity: 2,
      unitMinutes: 125, dailyMax: 3, activityType: 'normal', highIntensity: false, countInStats: true,
      allowSplit: true, splitSessionMinutes: 45, status: 'active', createdAt: '', updatedAt: '',
    } as TaskGroup)
    expect(assignments).toHaveLength(6)
    expect(assignments.map(item => item.estimatedMinutes)).toEqual([45, 45, 35, 45, 45, 35])
    expect(assignments.every(item => item.splitSourceIndex && item.splitPart && item.splitTotal === 3)).toBe(true)
  })
})

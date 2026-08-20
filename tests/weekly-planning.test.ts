import { describe, expect, it } from 'vitest'
import type { TaskGroup } from '../src/types'
import { dateRange, getCapacity } from '../src/lib/date'
import { weeklyOccurrenceDates, weeklyOccurrenceRange } from '../src/lib/frequency'
import { buildBlankState, createAssignmentsForGroup } from '../src/lib/seed'
import { applyWeekdayWeekendCapacityTemplate } from '../src/lib/weekly-capacity'

function weeklyState() {
  const state = buildBlankState()
  state.settings.startDate = '2026-08-17'
  state.settings.endDate = '2026-08-23'
  state.settings.regularMinutes = 210
  state.settings.studyMinutes = 360
  state.dayConfigs = Object.fromEntries(dateRange(state.settings.startDate, state.settings.endDate).map(date => [date, { date, type: 'regular' as const, userSet: false }]))
  return state
}

describe('工作日 / 周末容量模板', () => {
  it('把未手动设置的周一至周五设为常规日，周六周日设为学习日', () => {
    const state = weeklyState()
    const result = applyWeekdayWeekendCapacityTemplate(state, 180, 420)

    expect(result.state.dayConfigs['2026-08-17'].type).toBe('regular')
    expect(getCapacity(result.state, '2026-08-17')).toBe(180)
    expect(result.state.dayConfigs['2026-08-22'].type).toBe('study')
    expect(result.state.dayConfigs['2026-08-23'].type).toBe('study')
    expect(getCapacity(result.state, '2026-08-22')).toBe(420)
    expect(getCapacity(result.state, '2026-08-23')).toBe(420)
  })

  it('保留用户手动指定的特殊日期类型，不被周末模板覆盖', () => {
    const state = weeklyState()
    state.dayConfigs['2026-08-22'] = { date: '2026-08-22', type: 'travel', userSet: true, note: '比赛' }

    const result = applyWeekdayWeekendCapacityTemplate(state, 180, 420)

    expect(result.state.dayConfigs['2026-08-22']).toMatchObject({ type: 'travel', userSet: true, note: '比赛' })
    expect(getCapacity(result.state, '2026-08-22')).toBe(state.settings.travelMinutes)
    expect(result.preservedManualDates).toContain('2026-08-22')
    expect(result.state.dayConfigs['2026-08-23'].type).toBe('study')
  })
})

describe('有限次数 · 每周 1 项', () => {
  it('从开始日之后的第一个目标星期起，严格生成指定次数', () => {
    expect(weeklyOccurrenceDates('2026-08-20', 6, 4)).toEqual([
      '2026-08-22',
      '2026-08-29',
      '2026-09-05',
      '2026-09-12',
    ])
  })

  it('开始日本身就是目标星期时包含当天', () => {
    expect(weeklyOccurrenceDates('2026-08-22', 6, 3)).toEqual(['2026-08-22', '2026-08-29', '2026-09-05'])
  })

  it('计算出的重复日期范围与现有 recurring 生成器组合后仍只生成总数量', () => {
    const range = weeklyOccurrenceRange('2026-08-20', 6, 4)
    const group: TaskGroup = {
      id: 'group-weekly-paper',
      subject: '数学',
      title: '数学套卷',
      priority: 5,
      quantity: 4,
      sourceQuantity: 4,
      unitMinutes: 120,
      targetDate: '2026-09-30',
      dueDate: '2026-09-30',
      recurring: true,
      recurrenceStart: range.firstDate,
      recurrenceEnd: range.lastDate,
      recurrenceWeekdays: [6],
      countInStats: true,
      activityType: 'recurring',
    }

    const assignments = createAssignmentsForGroup(group)
    expect(assignments).toHaveLength(4)
    expect(assignments.map(item => item.scheduledDate)).toEqual(range.dates)
    expect(assignments.every(item => item.locked && item.scheduleSource === 'recurring')).toBe(true)
  })
})

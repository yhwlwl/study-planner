import type { AppState, DayConfig } from '../types'
import { dateRange, getCapacity } from './date'

export interface WeeklyCapacityDelta {
  date: string
  before: number
  after: number
}

export interface WeeklyCapacityTemplateResult {
  state: AppState
  changedDates: string[]
  capacityDeltas: WeeklyCapacityDelta[]
  preservedManualDates: string[]
}

function isWeekend(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function comparableConfig(config: DayConfig | undefined) {
  return {
    type: config?.type ?? 'regular',
    customMinutes: config?.customMinutes,
    userSet: Boolean(config?.userSet),
  }
}

/**
 * 把当前计划日期范围批量套用为“工作日=常规日、周末=学习日”。
 *
 * 已由用户单独设置过的日期类型不会被模板覆盖；但常规日/学习日的全局分钟数
 * 会按本次输入更新，因此用户手动指定为这两种类型的日期仍会跟随相应档位。
 */
export function applyWeekdayWeekendCapacityTemplate(
  state: AppState,
  weekdayMinutes: number,
  weekendMinutes: number,
): WeeklyCapacityTemplateResult {
  const next = structuredClone(state) as AppState
  const normalizedWeekday = Math.max(0, Math.min(1440, Math.round(weekdayMinutes)))
  const normalizedWeekend = Math.max(0, Math.min(1440, Math.round(weekendMinutes)))
  const dates = dateRange(state.settings.startDate, state.settings.endDate)
  const beforeCapacity = new Map(dates.map(date => [date, getCapacity(state, date)]))
  const beforeConfigs = new Map(dates.map(date => [date, comparableConfig(state.dayConfigs[date])]))
  const preservedManualDates: string[] = []

  next.settings.regularMinutes = normalizedWeekday
  next.settings.studyMinutes = normalizedWeekend

  for (const date of dates) {
    const existing = next.dayConfigs[date] ?? { date, type: 'regular' as const, userSet: false }
    if (existing.userSet) {
      preservedManualDates.push(date)
      continue
    }
    next.dayConfigs[date] = {
      ...existing,
      date,
      type: isWeekend(date) ? 'study' : 'regular',
      customMinutes: undefined,
      userSet: false,
    }
  }

  const capacityDeltas: WeeklyCapacityDelta[] = []
  const changedDates: string[] = []
  for (const date of dates) {
    const before = beforeCapacity.get(date) ?? 0
    const after = getCapacity(next, date)
    const beforeConfig = beforeConfigs.get(date)
    const afterConfig = comparableConfig(next.dayConfigs[date])
    const configChanged = beforeConfig?.type !== afterConfig.type
      || beforeConfig?.customMinutes !== afterConfig.customMinutes
      || beforeConfig?.userSet !== afterConfig.userSet
    if (before !== after || configChanged) changedDates.push(date)
    if (before !== after) capacityDeltas.push({ date, before, after })
  }

  return { state: next, changedDates, capacityDeltas, preservedManualDates }
}

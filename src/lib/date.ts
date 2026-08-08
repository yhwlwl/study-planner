import { addDays, eachDayOfInterval, format, isAfter, isBefore, parseISO } from 'date-fns'
import type { AppState, DayConfig, DayType } from '../types'

export const todayISO = () => format(new Date(), 'yyyy-MM-dd')

/**
 * Create a stable timestamp for a calendar date.
 *
 * Actual-time aggregation reads the date portion of timestamps. Using UTC
 * noon keeps that date stable across local time zones and around midnight.
 */
export const timestampForDate = (date: string) => `${date}T12:00:00.000Z`
export const fmtDate = (date: string, pattern = 'M月d日') => format(parseISO(date), pattern)
export const fmtWeekday = (date: string) => ['周日','周一','周二','周三','周四','周五','周六'][parseISO(date).getDay()]
export const dateRange = (start: string, end: string) => eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map(d => format(d, 'yyyy-MM-dd'))
export const shiftDate = (date: string, amount: number) => format(addDays(parseISO(date), amount), 'yyyy-MM-dd')
export const clampDate = (date: string, start: string, end: string) => isBefore(parseISO(date), parseISO(start)) ? start : isAfter(parseISO(date), parseISO(end)) ? end : date

export const dayTypeLabel: Record<DayType, string> = {
  regular: '常规日',
  study: '学习日',
  travel: '旅游日',
  custom: '自定义'
}

export function getDayConfig(state: AppState, date: string): DayConfig {
  return state.dayConfigs[date] ?? { date, type: 'regular' }
}

export function getBaseCapacity(state: AppState, date: string): number {
  const config = getDayConfig(state, date)
  if (config.type === 'study') return state.settings.studyMinutes
  if (config.type === 'travel') return state.settings.travelMinutes
  if (config.type === 'custom') return config.customMinutes ?? state.settings.regularMinutes
  return state.settings.regularMinutes
}

export function constraintsForDate(state: AppState, date: string) {
  return state.calendarConstraints.filter(item => item.startDate <= date && item.endDate >= date)
}

export function getCapacity(state: AppState, date: string): number {
  const config = getDayConfig(state, date)
  let capacity = typeof config.availableMinutes === 'number' ? Math.max(0, Math.round(config.availableMinutes)) : getBaseCapacity(state, date)
  for (const constraint of constraintsForDate(state, date)) {
    if (constraint.kind === 'unavailable') capacity = 0
    else if (constraint.kind === 'reduced-capacity' || constraint.kind === 'special-capacity' || constraint.kind === 'protected-buffer') {
      if (typeof constraint.capacityMinutes === 'number') capacity = Math.max(0, Math.round(constraint.capacityMinutes))
    }
  }
  return capacity
}

export function isDateProtected(state: AppState, date: string): boolean {
  const config = getDayConfig(state, date)
  return Boolean(config.bufferProtected || constraintsForDate(state, date).some(item => item.protected))
}

export function minutesText(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes))
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (!h) return `${m}分钟`
  if (!m) return `${h}小时`
  return `${h}小时${m}分钟`
}

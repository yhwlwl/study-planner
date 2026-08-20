import { addDays, format, getDay, parseISO } from 'date-fns'

export interface WeeklyOccurrenceRange {
  dates: string[]
  firstDate?: string
  lastDate?: string
}

/**
 * 从 startDate 起（包含当天）寻找第一个目标星期，然后按每 7 天生成固定次数。
 * 0-6 对应周日到周六，与现有 recurrenceWeekdays 数据模型保持一致。
 */
export function weeklyOccurrenceDates(startDate: string, weekday: number, count: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return []
  const normalizedWeekday = Math.max(0, Math.min(6, Math.round(weekday)))
  const normalizedCount = Math.max(0, Math.round(count))
  if (!normalizedCount) return []
  const start = parseISO(startDate)
  if (Number.isNaN(start.getTime())) return []
  const offset = (normalizedWeekday - getDay(start) + 7) % 7
  const first = addDays(start, offset)
  return Array.from({ length: normalizedCount }, (_, index) => format(addDays(first, index * 7), 'yyyy-MM-dd'))
}

export function weeklyOccurrenceRange(startDate: string, weekday: number, count: number): WeeklyOccurrenceRange {
  const dates = weeklyOccurrenceDates(startDate, weekday, count)
  return { dates, firstDate: dates[0], lastDate: dates.at(-1) }
}

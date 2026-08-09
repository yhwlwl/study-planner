import { describe, expect, it } from 'vitest'
import { timestampForDate, todayISO, withNowProvider } from '../src/lib/date'

describe('deterministic date semantics', () => {
  it('uses an injectable clock for today', () => {
    expect(withNowProvider(() => new Date('2026-08-09T23:30:00+08:00'), () => todayISO())).toBe('2026-08-09')
    expect(withNowProvider(() => new Date('2026-08-10T00:30:00+08:00'), () => todayISO())).toBe('2026-08-10')
  })

  it('keeps a recorded calendar date stable across timezone parsing', () => {
    const timestamp = timestampForDate('2026-08-09')
    expect(timestamp.startsWith('2026-08-09T12:00:00')).toBe(true)
    expect(timestamp.slice(0, 10)).toBe('2026-08-09')
  })
})

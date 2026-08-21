// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { lockPageScroll } from '../src/lib/scroll-lock'

afterEach(() => {
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
})

describe('lockPageScroll', () => {
  it('locks and restores the page scroll', () => {
    const unlock = lockPageScroll()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    unlock()
    expect(document.body.style.overflow).toBe('')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('keeps scrolling locked while any overlapping lock remains (stack order close)', () => {
    const a = lockPageScroll()
    const b = lockPageScroll()
    b()
    expect(document.body.style.overflow).toBe('hidden')
    a()
    expect(document.body.style.overflow).toBe('')
  })

  it('regression: overlapping locks closed OUT of order must not leave body locked', () => {
    // 旧实现：A 开 -> 记 prev='' -> hidden；B 开 -> 记 prev='hidden'；
    // A 先关则恢复成 ''，B 再关恢复成 'hidden'，导致页面永久锁死。
    const a = lockPageScroll()
    const b = lockPageScroll()
    a()
    expect(document.body.style.overflow).toBe('hidden')
    b()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores the pre-existing overflow value', () => {
    document.body.style.overflow = 'scroll'
    const unlock = lockPageScroll()
    expect(document.body.style.overflow).toBe('hidden')
    unlock()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('is safe to release more than once', () => {
    const a = lockPageScroll()
    const b = lockPageScroll()
    a()
    a()
    b()
    b()
    expect(document.body.style.overflow).toBe('')
  })
})

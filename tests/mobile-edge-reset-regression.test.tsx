// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isGuestResetButton } from '../src/components/DataResetCompatibilityGuard'
import { nativeTaskDragAvailable } from '../src/components/TaskCard'

function matchMediaFor(flags: { hover: boolean; fine: boolean; coarse: boolean }): typeof window.matchMedia {
  return ((query: string) => {
    const wantsHover = query.includes('(hover: hover)')
    const wantsFine = query.includes('(pointer: fine)')
    const wantsNoCoarse = query.includes('not (any-pointer: coarse)')
    const matches = (!wantsHover || flags.hover) && (!wantsFine || flags.fine) && (!wantsNoCoarse || !flags.coarse)
    return { matches, media: query } as MediaQueryList
  }) as unknown as typeof window.matchMedia
}

describe('Android Edge / PWA 移动端交互回归', () => {
  it('触屏/粗指针环境不启用 HTML5 原生任务拖拽，避免抢占纵向滚动', () => {
    expect(nativeTaskDragAvailable(matchMediaFor({ hover: false, fine: false, coarse: true }))).toBe(false)
  })

  it('纯鼠标 fine pointer 桌面环境仍保留任务拖拽', () => {
    expect(nativeTaskDragAvailable(matchMediaFor({ hover: true, fine: true, coarse: false }))).toBe(true)
  })

  it('触屏笔记本（hover+fine 但同时存在粗指针）不启用原生拖拽，避免 Edge 滑动被抢占', () => {
    expect(nativeTaskDragAvailable(matchMediaFor({ hover: true, fine: true, coarse: true }))).toBe(false)
  })

  it('只识别设置页危险区的“重置计划”，不会误拦截恢复演示按钮', () => {
    const reset = document.createElement('button')
    reset.className = 'danger-button'
    reset.innerHTML = '<span>重置计划</span>'
    const restore = document.createElement('button')
    restore.className = 'secondary-button'
    restore.textContent = '恢复演示计划'

    expect(isGuestResetButton(reset.querySelector('span'))).toBe(true)
    expect(isGuestResetButton(restore)).toBe(false)
  })
})

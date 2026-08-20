import { describe, expect, it } from 'vitest'
import { isGuestResetButton } from '../src/components/DataResetCompatibilityGuard'
import { nativeTaskDragAvailable } from '../src/components/TaskCard'

describe('Android Edge / PWA 移动端交互回归', () => {
  it('触屏/粗指针环境不启用 HTML5 原生任务拖拽，避免抢占纵向滚动', () => {
    const touchMatchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia
    expect(nativeTaskDragAvailable(touchMatchMedia)).toBe(false)
  })

  it('鼠标 fine pointer 桌面环境仍保留任务拖拽', () => {
    const desktopMatchMedia = ((query: string) => ({ matches: query === '(hover: hover) and (pointer: fine)', media: query })) as unknown as typeof window.matchMedia
    expect(nativeTaskDragAvailable(desktopMatchMedia)).toBe(true)
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

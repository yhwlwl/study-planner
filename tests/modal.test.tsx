// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '../src/components/Modal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
  document.documentElement.style.overflow = ''
})

describe('Modal viewport portal', () => {
  it('renders the modal at document.body so transformed page ancestors cannot trap fixed positioning', () => {
    const host = document.createElement('div')
    host.style.transform = 'translateY(1px)'
    document.body.appendChild(host)
    const view = render(<Modal open title="测试弹窗" onClose={() => undefined} mobileFullscreen><div>正文</div><div className="modal-actions"><button>底部动作</button></div></Modal>, { container: host })
    const dialog = screen.getByRole('dialog')
    expect(dialog.parentElement).toBe(document.body.querySelector('.modal-backdrop'))
    expect(document.body.querySelector('.modal-footer')).not.toBeNull()
    view.unmount()
    host.remove()
  })

  it('mobile fullscreen opens at the viewport origin and restores the previous page position on close', async () => {
    const originalInnerWidth = window.innerWidth
    const originalScrollX = window.scrollX
    const originalScrollY = window.scrollY
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1240 })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'scroll'

    const view = render(<Modal open title="覆盖当前计划前预览" onClose={() => undefined} mobileFullscreen><div>从云端恢复当前计划</div></Modal>)

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0))
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(screen.getByRole('dialog').querySelector('.modal-body')?.scrollTop).toBe(0)

    view.rerender(<Modal open={false} title="覆盖当前计划前预览" onClose={() => undefined} mobileFullscreen><div>从云端恢复当前计划</div></Modal>)

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 1240))
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'scrollX', { configurable: true, value: originalScrollX })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: originalScrollY })
  })
})

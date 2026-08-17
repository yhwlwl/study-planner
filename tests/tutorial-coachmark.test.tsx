// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TutorialCoachmark } from '../src/components/TutorialCoachmark'
import type { TutorialStep } from '../src/lib/tutorial'

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
})

afterEach(() => cleanup())

const calendarTransitions: Array<[TutorialStep, TutorialStep, string]> = [
  ['repair-preview', 'repair-calendar', '高亮日期就是刚才实际改动的位置'],
  ['intake-preview', 'intake-calendar', '新任务已经进入正式计划'],
  ['review-preview', 'review-calendar', '未完成任务已经接到后面的日期'],
  ['future-preview', 'future-calendar', '主动重排已经生效'],
]

function visibleRect(width = 120, height = 40) {
  return {
    width, height, top: 120, right: 240, bottom: 160, left: 120, x: 120, y: 120, toJSON: () => ({}),
  } as DOMRect
}

describe('TutorialCoachmark portal 生命周期', () => {
  it.each(calendarTransitions)('%s → %s 后立即回到页面文档流', async (previewStep, calendarStep, expectedCopy) => {
    const modal = document.createElement('section')
    modal.className = 'modal-card'
    const slot = document.createElement('div')
    slot.className = 'tutorial-modal-coachmark-slot'
    const target = document.createElement('button')
    target.dataset.tutorialTarget = 'proposal-primary'
    target.getBoundingClientRect = () => visibleRect()
    modal.append(slot, target)
    document.body.appendChild(modal)

    const { rerender } = render(
      <TutorialCoachmark
        step={previewStep}
        config={{ target: 'proposal-primary', text: '先确认方案' }}
        onRestart={() => undefined}
        onExit={() => undefined}
      />,
    )

    await waitFor(() => expect(slot.textContent).toBeTruthy())

    // 模拟用户应用方案：Proposal 弹窗被卸载，同时教程步骤切到月历。
    modal.remove()
    rerender(
      <TutorialCoachmark
        step={calendarStep}
        config={{ text: '月历结果已经显示', actionLabel: '下一步' }}
        onRestart={() => undefined}
        onExit={() => undefined}
      />,
    )

    // 不刷新页面也必须立即在当前 document 中找到新提示，不能继续 portal 到已卸载节点。
    await waitFor(() => {
      const coachmark = document.querySelector<HTMLElement>('.tutorial-coachmark')
      expect(coachmark).toBeTruthy()
      expect(coachmark?.textContent).toContain(expectedCopy)
      expect(screen.getByRole('button', { name: '下一步' })).toBeTruthy()
    })
    expect(modal.isConnected).toBe(false)
  })

  it('修复方案先引导查看移动任务，再引导应用方案', async () => {
    const modal = document.createElement('section')
    modal.className = 'modal-card'
    const slot = document.createElement('div')
    slot.className = 'tutorial-modal-coachmark-slot'
    const summary = document.createElement('div')
    summary.className = 'proposal-summary-grid'
    const moveButton = document.createElement('button')
    moveButton.innerHTML = '<strong>3</strong><span>移动任务</span><small>展开查看</small>'
    moveButton.getBoundingClientRect = () => visibleRect()
    summary.appendChild(moveButton)
    const primary = document.createElement('button')
    primary.dataset.tutorialTarget = 'proposal-primary'
    primary.textContent = '应用预览中的改动'
    primary.getBoundingClientRect = () => visibleRect()
    modal.append(slot, summary, primary)
    document.body.appendChild(modal)

    render(
      <TutorialCoachmark
        step="repair-preview"
        config={{ target: 'proposal-primary', text: '旧提示' }}
        onRestart={() => undefined}
        onExit={() => undefined}
      />,
    )

    await waitFor(() => expect(slot.textContent).toContain('先看哪些任务会移动'))
    expect(moveButton.classList.contains('tutorial-highlight')).toBe(true)

    fireEvent.click(moveButton)

    await waitFor(() => expect(slot.textContent).toContain('应用预览中的改动'))
    expect(primary.classList.contains('tutorial-highlight')).toBe(true)
  })
})

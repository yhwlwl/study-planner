// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Modal } from '../src/components/Modal'

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
})

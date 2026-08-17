// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  pendingSignupInfo: vi.fn(),
  recordSignupConfirmedIfPending: vi.fn(),
  subscribePendingSignup: vi.fn(() => () => undefined),
  resendSignupConfirmation: vi.fn(),
}))

vi.mock('../src/lib/analytics', () => ({
  pendingSignupInfo: mocks.pendingSignupInfo,
  recordSignupConfirmedIfPending: mocks.recordSignupConfirmedIfPending,
  subscribePendingSignup: mocks.subscribePendingSignup,
}))

vi.mock('../src/lib/supabase', () => ({
  supabase: undefined,
  resendSignupConfirmation: mocks.resendSignupConfirmation,
}))

import { EmailVerificationBanner } from '../src/components/EmailVerificationBanner'

beforeEach(() => {
  mocks.pendingSignupInfo.mockReset()
  mocks.pendingSignupInfo.mockReturnValue({
    email: 'student@example.com',
    startedAt: new Date().toISOString(),
  })
  mocks.recordSignupConfirmedIfPending.mockReset()
  mocks.subscribePendingSignup.mockReset()
  mocks.subscribePendingSignup.mockImplementation(() => () => undefined)
  mocks.resendSignupConfirmation.mockReset()
})

afterEach(() => cleanup())

describe('EmailVerificationBanner', () => {
  it('另一个标签页完成邮箱验证并清除 pending 状态后自动消失', () => {
    render(<EmailVerificationBanner />)
    expect(screen.getByText('还差一步：必须验证邮箱')).toBeTruthy()

    fireEvent(window, new StorageEvent('storage', {
      key: 'study-planner:pending-signup-v1',
      newValue: null,
    }))

    expect(screen.queryByText('还差一步：必须验证邮箱')).toBeNull()
  })

  it('用户可以通过右上角关闭按钮立即隐藏提示', () => {
    render(<EmailVerificationBanner />)
    fireEvent.click(screen.getByRole('button', { name: '暂时关闭邮箱验证提示' }))
    expect(screen.queryByText('还差一步：必须验证邮箱')).toBeNull()
  })
})

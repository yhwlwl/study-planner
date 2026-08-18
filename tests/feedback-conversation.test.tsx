// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const feedbackMocks = vi.hoisted(() => ({
  getFeedbackSessionContext: vi.fn(),
  getUnreadFeedbackReplyCount: vi.fn(),
  listFeedback: vi.fn(),
  markFeedbackRepliesRead: vi.fn(),
  markAdminFollowupsRead: vi.fn(),
  appendFeedbackReply: vi.fn(),
  replyToFeedback: vi.fn(),
  submitFeedback: vi.fn(),
  updateFeedbackStatus: vi.fn(),
}))

vi.mock('../src/lib/feedback', () => ({
  ...feedbackMocks,
  FEEDBACK_UNREAD_EVENT: 'study-planner:feedback-unread-changed',
  validateFeedbackScreenshots: () => undefined,
}))

vi.mock('../src/lib/supabase', () => ({ supabase: undefined }))

import { FeedbackPage } from '../src/components/FeedbackPage'
import { FeedbackNotificationObserver } from '../src/components/FeedbackNotificationObserver'

const accountRecord = {
  id: 'feedback-1',
  user_id: 'user-1',
  feedback_type: 'bug',
  content: '原始问题',
  status: 'resolved',
  created_at: '2026-08-18T05:00:00.000Z',
  attachments: [],
  replies: [
    {
      id: 'reply-admin-1',
      feedback_id: 'feedback-1',
      content: '开发者已经回复',
      created_at: '2026-08-18T05:10:00.000Z',
      author_type: 'admin',
      read_at: null,
      attachments: [],
    },
  ],
}

beforeEach(() => {
  feedbackMocks.getFeedbackSessionContext.mockReset().mockResolvedValue({ session: { user: { id: 'user-1' } }, isAdmin: false })
  feedbackMocks.getUnreadFeedbackReplyCount.mockReset().mockResolvedValue(1)
  feedbackMocks.listFeedback.mockReset().mockResolvedValue([accountRecord])
  feedbackMocks.markFeedbackRepliesRead.mockReset().mockResolvedValue(0)
  feedbackMocks.markAdminFollowupsRead.mockReset().mockResolvedValue(undefined)
  feedbackMocks.appendFeedbackReply.mockReset().mockResolvedValue({ uploadedCount: 0, failedCount: 0 })
  feedbackMocks.replyToFeedback.mockReset().mockResolvedValue({ uploadedCount: 0, failedCount: 0 })
  feedbackMocks.submitFeedback.mockReset().mockResolvedValue({ id: 'new-feedback', uploadedCount: 0, failedCount: 0 })
  feedbackMocks.updateFeedbackStatus.mockReset().mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('反馈回复通知与双向会话', () => {
  it('侧边栏意见反馈使用与录入一致的蓝色数量徽标，并在已读后移除', async () => {
    feedbackMocks.getUnreadFeedbackReplyCount.mockResolvedValue(2)
    render(<>
      <aside className="sidebar"><nav><button type="button"><span>意见反馈</span></button></nav></aside>
      <FeedbackNotificationObserver />
    </>)

    await waitFor(() => expect(document.querySelector('.feedback-nav-badge')?.textContent).toBe('2'))
    expect(document.querySelector('.feedback-nav-badge')?.classList.contains('intake-nav-badge')).toBe(true)
    expect(screen.getByRole('button', { name: '意见反馈，2 条新回复' })).toBeTruthy()

    window.dispatchEvent(new CustomEvent('study-planner:feedback-unread-changed', { detail: { count: 0 } }))
    await waitFor(() => expect(document.querySelector('.feedback-nav-badge')).toBeNull())
    expect(screen.getByRole('button', { name: '意见反馈' })).toBeTruthy()
  })

  it('用户在页面内看到新回复提醒，并可继续追加回复；已解决反馈会提示自动重新打开', async () => {
    render(<FeedbackPage />)

    expect(await screen.findByText('你的反馈有新回复')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看回复' }))

    expect(await screen.findByText('开发者已经回复')).toBeTruthy()
    expect(screen.getAllByText(/新回复/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '继续回复' }))

    expect(screen.getByText(/自动重新打开为“处理中”/)).toBeTruthy()
    const textarea = screen.getByPlaceholderText(/继续补充情况/)
    fireEvent.change(textarea, { target: { value: '我这里还有一个补充情况' } })
    fireEvent.click(screen.getByRole('button', { name: '发送追加回复' }))

    await waitFor(() => expect(feedbackMocks.appendFeedbackReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feedback-1' }),
      '我这里还有一个补充情况',
      [],
    ))
    expect(feedbackMocks.markFeedbackRepliesRead).toHaveBeenCalled()
  })

  it('开发者给登录用户回复时可以选择图片附件', async () => {
    feedbackMocks.getFeedbackSessionContext.mockResolvedValue({ session: { user: { id: 'admin-1' } }, isAdmin: true })
    feedbackMocks.getUnreadFeedbackReplyCount.mockResolvedValue(0)
    feedbackMocks.listFeedback.mockResolvedValue([accountRecord])

    render(<FeedbackPage />)
    fireEvent.click(await screen.findByRole('button', { name: '反馈管理' }))
    expect(await screen.findByText('原始问题')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '回复用户' }))
    expect(screen.getByText('添加图片')).toBeTruthy()
    const input = document.querySelector<HTMLInputElement>('.feedback-reply-upload input[type="file"]')
    expect(input?.accept).toContain('image/png')
    expect(input?.multiple).toBe(true)
  })
})

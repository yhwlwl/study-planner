import { useEffect, useState } from 'react'
import { FEEDBACK_UNREAD_EVENT, getUnreadFeedbackReplyCount } from '../lib/feedback'
import { supabase } from '../lib/supabase'

function feedbackNavButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
    .find(button => button.querySelector('span')?.textContent?.trim() === '意见反馈')
}

function renderFeedbackBadge(unreadCount: number) {
  const button = feedbackNavButton()
  if (!button) return
  const existing = button.querySelector<HTMLElement>('.feedback-nav-badge')
  if (unreadCount <= 0) {
    existing?.remove()
    button.setAttribute('aria-label', '意见反馈')
    return
  }

  const badge = existing ?? document.createElement('em')
  badge.className = 'intake-nav-badge feedback-nav-badge'
  badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount)
  badge.setAttribute('aria-hidden', 'true')
  if (!existing) button.appendChild(badge)
  button.setAttribute('aria-label', `意见反馈，${unreadCount} 条新回复`)
}

export function FeedbackNotificationObserver() {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let disposed = false
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const count = await getUnreadFeedbackReplyCount()
        if (!disposed) setUnreadCount(count)
      } catch {
        // 通知检查失败不能影响主应用；下一次轮询、聚焦或手动刷新会自动重试。
      } finally {
        running = false
      }
    }
    const onUnreadChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      if (typeof detail?.count === 'number') setUnreadCount(detail.count)
      else void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 45_000)
    window.addEventListener('focus', refresh)
    window.addEventListener(FEEDBACK_UNREAD_EVENT, onUnreadChanged)
    document.addEventListener('visibilitychange', onVisibility)
    const authSubscription = supabase?.auth.onAuthStateChange(() => {
      window.setTimeout(() => { void refresh() }, 0)
    }).data.subscription

    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(FEEDBACK_UNREAD_EVENT, onUnreadChanged)
      document.removeEventListener('visibilitychange', onVisibility)
      authSubscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const sync = () => renderFeedbackBadge(unreadCount)
    sync()
    const root = document.getElementById('root')
    if (!root) return
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      const badge = feedbackNavButton()?.querySelector('.feedback-nav-badge')
      badge?.remove()
    }
  }, [unreadCount])

  return null
}

import { useEffect, useState } from 'react'
import { FEEDBACK_UNREAD_EVENT, getUnreadFeedbackReplyCount } from '../lib/feedback'
import { supabase } from '../lib/supabase'

const REFRESH_INTERVAL_MS = 120_000

function feedbackNavButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
    .find(button => button.querySelector('span')?.textContent?.trim() === '意见反馈')
}

function renderFeedbackBadge(unreadCount: number) {
  const button = feedbackNavButton()
  if (!button) return

  const existing = button.querySelector<HTMLElement>('.feedback-nav-badge')
  if (unreadCount <= 0) {
    if (existing) existing.remove()
    if (button.getAttribute('aria-label') !== '意见反馈') button.setAttribute('aria-label', '意见反馈')
    return
  }

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount)
  const ariaLabel = `意见反馈，${unreadCount} 条新回复`
  if (!existing) {
    const badge = document.createElement('em')
    badge.className = 'intake-nav-badge feedback-nav-badge'
    badge.textContent = badgeText
    badge.setAttribute('aria-hidden', 'true')
    button.appendChild(badge)
  } else {
    // 只有值真正变化时才写 DOM。MutationObserver 会观察 childList，重复写
    // textContent 会再次产生 mutation；这里必须保持同步函数幂等，避免主线程死循环。
    if (existing.textContent !== badgeText) existing.textContent = badgeText
    if (existing.className !== 'intake-nav-badge feedback-nav-badge') existing.className = 'intake-nav-badge feedback-nav-badge'
    if (existing.getAttribute('aria-hidden') !== 'true') existing.setAttribute('aria-hidden', 'true')
  }
  if (button.getAttribute('aria-label') !== ariaLabel) button.setAttribute('aria-label', ariaLabel)
}

export function FeedbackNotificationObserver() {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let disposed = false
    let running = false
    let authRefreshTimer: number | undefined

    const refresh = async () => {
      if (disposed || running || document.visibilityState === 'hidden') return
      running = true
      try {
        const count = await getUnreadFeedbackReplyCount()
        if (!disposed) setUnreadCount(current => current === count ? current : count)
      } catch {
        // 通知检查失败不能影响主应用；下一次聚焦、轮询或手动刷新会自动重试。
      } finally {
        running = false
      }
    }

    const onUnreadChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      if (typeof detail?.count === 'number') setUnreadCount(current => current === detail.count ? current : detail.count!)
      else void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onFocus = () => { void refresh() }

    void refresh()
    const interval = window.setInterval(() => { void refresh() }, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    window.addEventListener(FEEDBACK_UNREAD_EVENT, onUnreadChanged)
    document.addEventListener('visibilitychange', onVisibility)
    const authSubscription = supabase?.auth.onAuthStateChange(() => {
      if (authRefreshTimer !== undefined) window.clearTimeout(authRefreshTimer)
      authRefreshTimer = window.setTimeout(() => { void refresh() }, 400)
    }).data.subscription

    return () => {
      disposed = true
      window.clearInterval(interval)
      if (authRefreshTimer !== undefined) window.clearTimeout(authRefreshTimer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(FEEDBACK_UNREAD_EVENT, onUnreadChanged)
      document.removeEventListener('visibilitychange', onVisibility)
      authSubscription?.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let frame = 0
    let retryTimer: number | undefined
    const sync = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        renderFeedbackBadge(unreadCount)
      })
    }

    // App 与通知组件同一次 React commit 完成，通常这里即可拿到 sidebar。
    // 仅观察 sidebar nav 的 childList，避免监听整个 #root 带来的高频回调。
    const attachObserver = (): MutationObserver | undefined => {
      const nav = document.querySelector('.sidebar nav')
      if (!nav) return undefined
      renderFeedbackBadge(unreadCount)
      const observer = new MutationObserver(sync)
      observer.observe(nav, { childList: true, subtree: true })
      return observer
    }

    let observer = attachObserver()
    if (!observer) {
      retryTimer = window.setTimeout(() => {
        observer = attachObserver()
      }, 80)
    }

    return () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      const badge = feedbackNavButton()?.querySelector('.feedback-nav-badge')
      badge?.remove()
    }
  }, [unreadCount])

  return null
}

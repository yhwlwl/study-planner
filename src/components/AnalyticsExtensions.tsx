import { useEffect, useRef } from 'react'
import { useApp } from '../AppContext'
import { visitorId } from '../lib/analytics'
import { APP_VERSION, GITHUB_REPO_URL } from '../lib/constants'
import { PWA_INSTALL_EVENT } from '../pwa-install'
import { supabase } from '../lib/supabase'
import { isTutorialNamespace } from '../lib/tutorial'

type MetricEventType =
  | 'heartbeat'
  | 'tutorial_started'
  | 'tutorial_completed'
  | 'github_repo_clicked'
  | 'pwa_launch'
  | 'pwa_installed'
  | 'pwa_prompt_shown'
  | 'pwa_guide_opened'

const SESSION_KEY = 'study-planner:visit-session-id'
const HEARTBEAT_MS = 4 * 60 * 1000
const REPO = new URL(GITHUB_REPO_URL)

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function sessionId() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) return saved
    const next = randomId()
    sessionStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    return randomId()
  }
}

function isStandalone() {
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    || window.matchMedia('(display-mode: standalone)').matches
}

function currentAppPage() {
  if (document.querySelector('.focus-timer-page')) return 'timer'
  const heading = document.querySelector('.page-heading h1')?.textContent?.trim() ?? ''
  const map: Record<string, string> = {
    今日: 'today', 月历: 'calendar', 任务: 'tasks', 录入: 'intake', 目标: 'goals',
    统计: 'stats', 导出: 'export', 意见反馈: 'feedback', 使用教程: 'guide', 设置: 'settings',
  }
  return map[heading]
}

async function token() {
  try {
    if (!supabase) return undefined
    return (await supabase.auth.getSession()).data.session?.access_token
  } catch {
    return undefined
  }
}

async function recordMetric(eventType: MetricEventType, metadata: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return
  const accessToken = await token()
  const body = {
    eventId: randomId(),
    sessionId: sessionId(),
    visitorId: visitorId(),
    eventType,
    pathname: window.location.pathname.slice(0, 300),
    appPage: currentAppPage(),
    clientTime: new Date().toISOString(),
    language: navigator.language,
    clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    isPwa: isStandalone(),
    appVersion: APP_VERSION,
    metadata,
  }
  try {
    await fetch('/api/metric-event', {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch {
    // 运营埋点永远不能影响主应用交互。
  }
}

function githubSource(anchor: HTMLAnchorElement) {
  if (anchor.dataset.analyticsSource) return anchor.dataset.analyticsSource
  if (anchor.classList.contains('sidebar-repo-link')) return 'sidebar'
  if (anchor.closest('.guide-page')) return 'guide'
  if (anchor.closest('.settings-page')) return 'settings'
  return (anchor.textContent?.trim() || 'other').slice(0, 80)
}

/**
 * 仅负责低频运营事件：GitHub 出站、教程开始/完成、PWA 使用和在线心跳。
 * 不使用 MutationObserver；心跳只在页面可见时每 4 分钟一次。
 */
export function AnalyticsExtensions() {
  const { namespace, ready } = useApp()
  const previousNamespace = useRef<string>()
  const promptSeen = useRef(false)

  useEffect(() => {
    if (!ready) return
    const previous = previousNamespace.current
    previousNamespace.current = namespace
    if (isTutorialNamespace(namespace) && previous !== namespace) {
      void recordMetric('tutorial_started', { source: previous ? 'namespace_transition' : 'resume_or_start' })
    }
  }, [namespace, ready])

  useEffect(() => {
    if (!ready || isTutorialNamespace(namespace)) return
    let lastHeartbeatAt = 0
    const heartbeat = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      const now = Date.now()
      if (now - lastHeartbeatAt < HEARTBEAT_MS - 5_000) return
      lastHeartbeatAt = now
      void recordMetric('heartbeat')
    }
    const first = window.setTimeout(heartbeat, 8_000)
    const interval = window.setInterval(heartbeat, HEARTBEAT_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') heartbeat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [namespace, ready])

  useEffect(() => {
    if (!ready) return
    if (isStandalone()) void recordMetric('pwa_launch')

    const checkPrompt = () => {
      if (promptSeen.current || !document.querySelector('.pwa-install-nudge')) return
      promptSeen.current = true
      void recordMetric('pwa_prompt_shown')
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (anchor) {
        try {
          const url = new URL(anchor.href, window.location.href)
          if (url.hostname === REPO.hostname && url.pathname.replace(/\/$/, '').startsWith(REPO.pathname.replace(/\/$/, ''))) {
            void recordMetric('github_repo_clicked', {
              source: githubSource(anchor),
              linkText: anchor.textContent?.trim().slice(0, 120) || null,
              targetPath: url.pathname,
            })
          }
        } catch { /* ignore malformed href */ }
      }

      const button = target?.closest('button')
      const label = button?.textContent?.trim() ?? ''
      if (button?.closest('.tutorial-coachmark') && label === '开始我的计划') {
        void recordMetric('tutorial_completed', { source: 'interactive_tutorial' })
        window.setTimeout(() => {
          if (document.querySelector('.pwa-guide-modal-backdrop')) {
            void recordMetric('pwa_guide_opened', { source: 'tutorial_completed' })
          }
        }, 900)
      }
      window.setTimeout(checkPrompt, 1200)
    }

    const onInstalled = () => { void recordMetric('pwa_installed', { platform: navigator.platform }) }
    const onInstallGuideRequest = () => { void recordMetric('pwa_guide_opened', { source: 'explicit_request' }) }
    document.addEventListener('click', onClick, true)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener(PWA_INSTALL_EVENT, onInstallGuideRequest)
    const promptTimer = window.setTimeout(checkPrompt, 7_500)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener(PWA_INSTALL_EVENT, onInstallGuideRequest)
      window.clearTimeout(promptTimer)
    }
  }, [ready])

  return null
}

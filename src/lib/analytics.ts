import { supabase } from './supabase'

const APP_VERSION = '0.6.6'
const SESSION_KEY = 'study-planner:visit-session-id'
const STATUS_KEY = 'study-planner:visit-log-status'
let activeRequest: Promise<void> | undefined

type VisitLogStatus = {
  ok: boolean
  at: string
  status?: number
  code?: string
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function sessionId(): string {
  const saved = sessionStorage.getItem(SESSION_KEY)
  if (saved) return saved
  const next = randomId()
  sessionStorage.setItem(SESSION_KEY, next)
  return next
}

function referrerOrigin(): string | undefined {
  if (!document.referrer) return undefined
  try {
    return new URL(document.referrer).origin
  } catch {
    return undefined
  }
}

function isStandalonePwa(): boolean {
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

function rememberStatus(status: VisitLogStatus): void {
  try {
    sessionStorage.setItem(STATUS_KEY, JSON.stringify(status))
  } catch {
    // Diagnostics are optional and must never affect the planner.
  }
}

async function postVisit(body: Record<string, unknown>, token?: string): Promise<void> {
  const response = await fetch('/api/visit-log', {
    method: 'POST',
    cache: 'no-store',
    keepalive: true,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })

  if (response.ok) {
    rememberStatus({ ok: true, at: new Date().toISOString(), status: response.status })
    return
  }

  let code = `http_${response.status}`
  try {
    const data = await response.json() as { code?: unknown }
    if (typeof data.code === 'string') code = data.code
  } catch {
    // Keep the status-based fallback code.
  }
  rememberStatus({ ok: false, at: new Date().toISOString(), status: response.status, code })
  throw new Error(code)
}

export async function recordPageVisit(): Promise<void> {
  if (activeRequest) return activeRequest
  activeRequest = (async () => {
    try {
      const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
      const token = data.session?.access_token as string | undefined
      const body = {
        eventId: randomId(),
        sessionId: sessionId(),
        eventType: 'page_view',
        pathname: window.location.pathname.slice(0, 300),
        referrerOrigin: referrerOrigin(),
        clientTime: new Date().toISOString(),
        language: navigator.language,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        accountMode: token ? 'account' : 'guest',
        isPwa: isStandalonePwa(),
        appVersion: APP_VERSION,
        metadata: {
          online: navigator.onLine,
          colorDepth: window.screen.colorDepth,
          touchPoints: navigator.maxTouchPoints
        }
      }

      try {
        await postVisit(body, token)
      } catch {
        // One delayed retry covers a cold function start or brief mobile network transition.
        await new Promise(resolve => globalThis.setTimeout(resolve, 1800))
        await postVisit(body, token)
      }
    } catch (error) {
      const current = sessionStorage.getItem(STATUS_KEY)
      if (!current) rememberStatus({
        ok: false,
        at: new Date().toISOString(),
        code: error instanceof Error ? error.message.slice(0, 80) : 'request_failed'
      })
      console.warn('访问日志写入失败，可打开 /api/visit-log 查看服务端诊断。')
    }
  })().finally(() => { activeRequest = undefined })

  return activeRequest
}

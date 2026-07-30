import { supabase } from './supabase'

const APP_VERSION = '0.6.5'
const SESSION_KEY = 'study-planner:visit-session-id'
let activeRequest: Promise<void> | undefined

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

      const response = await fetch('/api/visit-log', {
        method: 'POST',
        cache: 'no-store',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      })

      void response
    } catch {
      // Logging must never block or degrade the planner itself.
    }
  })().finally(() => { activeRequest = undefined })

  return activeRequest
}

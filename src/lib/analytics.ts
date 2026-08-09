import { supabase } from './supabase'

const APP_VERSION = '0.9.0'
const SESSION_KEY = 'study-planner:visit-session-id'
const STATUS_KEY = 'study-planner:visit-log-status'
const OUTBOX_KEY = 'study-planner:visit-log-outbox-v1'
const MAX_OUTBOX_ITEMS = 30
let activeRequest: Promise<void> | undefined
let retryListenersInstalled = false
let memorySessionId: string | undefined
let memoryOutbox: VisitEnvelope[] = []

type VisitLogStatus = {
  ok: boolean
  at: string
  status?: number
  code?: string
  queued?: number
}

type VisitEnvelope = {
  body: Record<string, unknown>
  queuedAt: string
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
  try {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) return saved
    const next = randomId()
    sessionStorage.setItem(SESSION_KEY, next)
    return next
  } catch {
    memorySessionId ??= randomId()
    return memorySessionId
  }
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

function validEnvelope(value: unknown): value is VisitEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<VisitEnvelope>
  return Boolean(candidate.body && typeof candidate.body === 'object' && !Array.isArray(candidate.body) && typeof candidate.queuedAt === 'string')
}

function readOutbox(): VisitEnvelope[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return memoryOutbox.slice(-MAX_OUTBOX_ITEMS)
    const stored = parsed.filter(validEnvelope).slice(-MAX_OUTBOX_ITEMS)
    return stored.length ? stored : memoryOutbox.slice(-MAX_OUTBOX_ITEMS)
  } catch {
    return memoryOutbox.slice(-MAX_OUTBOX_ITEMS)
  }
}

function writeOutbox(items: VisitEnvelope[]): void {
  const limited = items.slice(-MAX_OUTBOX_ITEMS)
  memoryOutbox = limited
  try {
    if (limited.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(limited))
    else localStorage.removeItem(OUTBOX_KEY)
  } catch {
    // Safari private mode and storage pressure may reject writes; memory fallback remains.
  }
}

function enqueueVisit(body: Record<string, unknown>): void {
  const queue = readOutbox()
  const eventId = body.eventId
  if (queue.some(item => item.body.eventId === eventId)) return
  writeOutbox([...queue, { body, queuedAt: new Date().toISOString() }])
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
  rememberStatus({ ok: false, at: new Date().toISOString(), status: response.status, code, queued: readOutbox().length })
  throw new Error(code)
}

async function accessToken(): Promise<string | undefined> {
  try {
    const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } }
    return data.session?.access_token as string | undefined
  } catch {
    return undefined
  }
}

export async function flushVisitLogOutbox(): Promise<void> {
  if (activeRequest) return activeRequest
  activeRequest = (async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      rememberStatus({ ok: false, at: new Date().toISOString(), code: 'offline_queued', queued: readOutbox().length })
      return
    }

    const token = await accessToken()
    const queue = readOutbox()
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]
      try {
        await postVisit(current.body, token)
        writeOutbox(queue.slice(index + 1))
      } catch {
        // Preserve this event and everything after it. A future online/visible event retries.
        rememberStatus({ ok: false, at: new Date().toISOString(), code: 'queued_for_retry', queued: queue.length - index })
        return
      }
    }
  })().finally(() => { activeRequest = undefined })

  return activeRequest
}

export function installVisitLogRetry(): void {
  if (retryListenersInstalled || typeof window === 'undefined') return
  retryListenersInstalled = true
  window.addEventListener('online', () => { void flushVisitLogOutbox() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushVisitLogOutbox()
  })
}

export async function recordPageVisit(): Promise<void> {
  const token = await accessToken()
  enqueueVisit({
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
  })

  await flushVisitLogOutbox()
}

const APP_VERSION = '0.9.0'
const SESSION_KEY = 'study-planner:visit-session-id'
const VISITOR_KEY = 'study-planner:visitor-id'
const ATTRIBUTION_KEY = 'study-planner:first-attribution-v1'
const UTM_SOURCE_KEY = 'study-planner:utm_source'
const UTM_CAMPAIGN_KEY = 'study-planner:utm_campaign'
const FIRST_REFERRER_KEY = 'study-planner:first_referrer'
const MILESTONE_KEY = 'study-planner:analytics-milestones-v1'
const PENDING_SIGNUP_KEY = 'study-planner:pending-signup-v1'
const LAST_VISIT_DAY_KEY = 'study-planner:last-visit-day'
const STATUS_KEY = 'study-planner:visit-log-status'
const OUTBOX_KEY = 'study-planner:visit-log-outbox-v1'
const MAX_OUTBOX_ITEMS = 60
const PENDING_SIGNUP_TTL_MS = 14 * 24 * 60 * 60 * 1000

export type AnalyticsEventType =
  | 'page_view'
  | 'app_page_view'
  | 'signup_started'
  | 'signup_confirmed'
  | 'intake_started'
  | 'natural_language_parsed'
  | 'first_plan_applied'
  | 'first_task_completed'
  | 'review_completed'
  | 'schedule_repair_applied'

type FirstAttribution = {
  utmSource?: string
  utmCampaign?: string
  firstReferrer?: string
  landingPath: string
  capturedAt: string
}

type PendingSignup = {
  userId?: string
  email: string
  emailDomain?: string
  startedAt: string
}

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

type EventOptions = {
  appPage?: string
  metadata?: Record<string, unknown>
}

const SHORT_LINK_ATTRIBUTION: Record<string, Pick<FirstAttribution, 'utmSource' | 'utmCampaign'>> = {
  // 只预置已经明确给出的映射；r1/r3 路由已可用，确定活动名后再补，避免错误归因。
  '/r2': { utmSource: 'xiaohongshu', utmCampaign: 'summer_homework_2' },
}

let activeRequest: Promise<void> | undefined
let retryListenersInstalled = false
let authConfirmationListenerInstalled = false
let memorySessionId: string | undefined
let memoryVisitorId: string | undefined
let memoryAttribution: FirstAttribution | undefined
let memoryPendingSignup: PendingSignup | undefined
let memoryLastVisitDay: string | undefined
let memoryOutbox: VisitEnvelope[] = []
let memoryMilestones = new Set<string>()
const confirmingSignupUserIds = new Set<string>()
const pendingSignupListeners = new Set<() => void>()

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function safeLocalGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function safeLocalSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* memory fallbacks keep analytics non-blocking */ }
}

function safeLocalRemove(key: string): void {
  try { localStorage.removeItem(key) } catch { /* optional cleanup only */ }
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

export function visitorId(): string {
  const saved = safeLocalGet(VISITOR_KEY)
  if (saved) return saved
  memoryVisitorId ??= randomId()
  safeLocalSet(VISITOR_KEY, memoryVisitorId)
  return memoryVisitorId
}

function cleanAttributionValue(value: string | null | undefined, maxLength = 160): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function referrerOrigin(): string | undefined {
  if (typeof document === 'undefined' || !document.referrer) return undefined
  try {
    return new URL(document.referrer).origin
  } catch {
    return undefined
  }
}

function firstReferrerValue(): string | undefined {
  if (typeof document === 'undefined' || !document.referrer) return undefined
  try {
    const referrer = new URL(document.referrer)
    return `${referrer.origin}${referrer.pathname}`.slice(0, 300)
  } catch {
    return cleanAttributionValue(document.referrer, 300)
  }
}

function validAttribution(value: unknown): value is FirstAttribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<FirstAttribution>
  return typeof candidate.landingPath === 'string' && typeof candidate.capturedAt === 'string'
}

function readAttribution(): FirstAttribution | undefined {
  if (memoryAttribution) return memoryAttribution
  try {
    const parsed = JSON.parse(safeLocalGet(ATTRIBUTION_KEY) ?? 'null') as unknown
    if (!validAttribution(parsed)) return undefined
    memoryAttribution = parsed
    return parsed
  } catch {
    return undefined
  }
}

export function captureFirstAttribution(): FirstAttribution {
  const existing = readAttribution()
  if (existing) return existing

  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname.slice(0, 300)
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
  const shortLink = SHORT_LINK_ATTRIBUTION[pathname.toLowerCase()]
  const attribution: FirstAttribution = {
    // A short link is an explicit campaign mapping. It must win over arbitrary
    // query parameters so /r2 remains attributable even when a share tool adds
    // its own UTM values.
    utmSource: shortLink?.utmSource ?? cleanAttributionValue(params.get('utm_source')),
    utmCampaign: shortLink?.utmCampaign ?? cleanAttributionValue(params.get('utm_campaign')),
    firstReferrer: firstReferrerValue(),
    landingPath: pathname,
    capturedAt: new Date().toISOString(),
  }
  memoryAttribution = attribution
  safeLocalSet(ATTRIBUTION_KEY, JSON.stringify(attribution))
  if (attribution.utmSource) safeLocalSet(UTM_SOURCE_KEY, attribution.utmSource)
  if (attribution.utmCampaign) safeLocalSet(UTM_CAMPAIGN_KEY, attribution.utmCampaign)
  if (attribution.firstReferrer) safeLocalSet(FIRST_REFERRER_KEY, attribution.firstReferrer)
  return attribution
}

export function initializeAnalytics(): void {
  visitorId()
  captureFirstAttribution()
  if (authConfirmationListenerInstalled || typeof window === 'undefined') return
  authConfirmationListenerInstalled = true
  void import('./supabase').then(({ supabase }) => {
    if (!supabase) return
    const confirm = (session: { user?: { id?: string; email?: string } } | null | undefined) => {
      const userId = session?.user?.id
      if (userId) void recordSignupConfirmedIfPending(userId, session?.user?.email)
    }
    void supabase.auth.getSession().then(({ data }) => confirm(data.session)).catch(() => undefined)
    supabase.auth.onAuthStateChange((_event, session) => confirm(session))
  }).catch(() => undefined)
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
    const { supabase } = await import('./supabase')
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

function localDay(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function lastVisitDay(): string | undefined {
  return safeLocalGet(LAST_VISIT_DAY_KEY) ?? memoryLastVisitDay
}

function rememberVisitDay(): void {
  memoryLastVisitDay = localDay()
  safeLocalSet(LAST_VISIT_DAY_KEY, memoryLastVisitDay)
}

export function installVisitLogRetry(): void {
  if (retryListenersInstalled || typeof window === 'undefined') return
  retryListenersInstalled = true
  window.addEventListener('online', () => { void flushVisitLogOutbox() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    void flushVisitLogOutbox()
    if (lastVisitDay() !== localDay()) void recordPageVisit({ entry: 'resume_after_day_change' })
  })
}

function baseEventBody(eventType: AnalyticsEventType, options?: EventOptions): Record<string, unknown> {
  initializeAnalytics()
  const attribution = captureFirstAttribution()
  return {
    eventId: randomId(),
    visitorId: visitorId(),
    sessionId: sessionId(),
    eventType,
    pathname: window.location.pathname.slice(0, 300),
    appPage: options?.appPage?.slice(0, 80),
    referrerOrigin: referrerOrigin(),
    utmSource: attribution.utmSource,
    utmCampaign: attribution.utmCampaign,
    firstReferrer: attribution.firstReferrer,
    clientTime: new Date().toISOString(),
    language: navigator.language,
    clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    isPwa: isStandalonePwa(),
    appVersion: APP_VERSION,
    metadata: {
      online: navigator.onLine,
      colorDepth: window.screen.colorDepth,
      touchPoints: navigator.maxTouchPoints,
      landingPath: attribution.landingPath,
      ...(options?.metadata ?? {}),
    }
  }
}

export function recordAnalyticsEvent(eventType: AnalyticsEventType, options?: EventOptions): Promise<void> {
  enqueueVisit(baseEventBody(eventType, options))
  return flushVisitLogOutbox()
}

function readMilestones(): Set<string> {
  if (memoryMilestones.size) return new Set(memoryMilestones)
  try {
    const parsed = JSON.parse(safeLocalGet(MILESTONE_KEY) ?? '[]') as unknown
    if (Array.isArray(parsed)) memoryMilestones = new Set(parsed.filter(item => typeof item === 'string'))
  } catch {
    // Keep the empty in-memory set.
  }
  return new Set(memoryMilestones)
}

function rememberMilestone(eventType: AnalyticsEventType): boolean {
  const milestones = readMilestones()
  if (milestones.has(eventType)) return false
  milestones.add(eventType)
  memoryMilestones = milestones
  safeLocalSet(MILESTONE_KEY, JSON.stringify([...milestones]))
  return true
}

export function recordAnalyticsEventOnce(eventType: AnalyticsEventType, options?: EventOptions): Promise<void> {
  if (!rememberMilestone(eventType)) return Promise.resolve()
  return recordAnalyticsEvent(eventType, options)
}

export function recordPageVisit(metadata?: Record<string, unknown>): Promise<void> {
  rememberVisitDay()
  return recordAnalyticsEvent('page_view', { metadata })
}

export function recordAppPageView(appPage: string): Promise<void> {
  return recordAnalyticsEvent('app_page_view', { appPage })
}

export function emailDomain(email: string): string | undefined {
  const domain = email.trim().toLowerCase().split('@')[1]
  return cleanAttributionValue(domain, 120)
}

function validPendingSignup(value: unknown): value is PendingSignup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<PendingSignup>
  return typeof candidate.email === 'string' && typeof candidate.startedAt === 'string'
}

function readPendingSignup(): PendingSignup | undefined {
  if (memoryPendingSignup) return memoryPendingSignup
  try {
    const parsed = JSON.parse(safeLocalGet(PENDING_SIGNUP_KEY) ?? 'null') as unknown
    if (!validPendingSignup(parsed)) return undefined
    if (Date.now() - new Date(parsed.startedAt).getTime() > PENDING_SIGNUP_TTL_MS) {
      safeLocalRemove(PENDING_SIGNUP_KEY)
      return undefined
    }
    memoryPendingSignup = parsed
    return parsed
  } catch {
    return undefined
  }
}

function notifyPendingSignupChanged(): void {
  for (const listener of pendingSignupListeners) listener()
}

export function pendingSignupInfo(): PendingSignup | undefined {
  return readPendingSignup()
}

export function subscribePendingSignup(listener: () => void): () => void {
  pendingSignupListeners.add(listener)
  return () => pendingSignupListeners.delete(listener)
}

export function rememberPendingSignup(email: string, userId?: string): void {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return
  const pending: PendingSignup = { userId, email: normalizedEmail, emailDomain: emailDomain(normalizedEmail), startedAt: new Date().toISOString() }
  memoryPendingSignup = pending
  safeLocalSet(PENDING_SIGNUP_KEY, JSON.stringify(pending))
  notifyPendingSignupChanged()
}

function clearPendingSignup(): void {
  memoryPendingSignup = undefined
  safeLocalRemove(PENDING_SIGNUP_KEY)
  notifyPendingSignupChanged()
}

export async function recordSignupConfirmedIfPending(userId: string, confirmedEmail?: string): Promise<void> {
  const pending = readPendingSignup()
  const normalizedConfirmedEmail = confirmedEmail?.trim().toLowerCase()
  const matches = pending && (pending.userId === userId || Boolean(normalizedConfirmedEmail && pending.email === normalizedConfirmedEmail))
  if (!pending || !matches || confirmingSignupUserIds.has(userId)) return
  confirmingSignupUserIds.add(userId)
  try {
    await recordAnalyticsEvent('signup_confirmed', { metadata: { emailDomain: pending.emailDomain } })
    clearPendingSignup()
  } finally {
    confirmingSignupUserIds.delete(userId)
  }
}

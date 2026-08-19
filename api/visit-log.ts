import { resolveGeo } from './geo-enrichment'

declare const process: { env: Record<string, string | undefined> }

type VisitPayload = {
  eventId?: unknown
  sessionId?: unknown
  visitorId?: unknown
  eventType?: unknown
  appPage?: unknown
  utmSource?: unknown
  utmCampaign?: unknown
  firstReferrer?: unknown
  pathname?: unknown
  referrerOrigin?: unknown
  clientTime?: unknown
  language?: unknown
  clientTimezone?: unknown
  screenWidth?: unknown
  screenHeight?: unknown
  viewportWidth?: unknown
  viewportHeight?: unknown
  accountMode?: unknown
  isPwa?: unknown
  appVersion?: unknown
  metadata?: unknown
}

type ServerConfig = {
  supabaseUrl: string
  serviceKey: string
  countOffset: number
}

const API_VERSION = '0.9.0'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LEGACY_JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const ALLOWED_EVENT_TYPES = new Set([
  'page_view', 'app_page_view', 'signup_started', 'signup_confirmed', 'intake_started',
  'natural_language_parsed', 'first_plan_applied', 'first_task_completed', 'review_completed', 'schedule_repair_applied'
])

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return Math.min(max, Math.max(min, value))
}

function nonNegativeInteger(value: string | undefined, fallback = 0): number {
  if (!value || !/^\d+$/.test(value.trim())) return fallback
  return Math.min(1_000_000_000, Number.parseInt(value, 10))
}

function safeMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const output: Record<string, string | number | boolean | null> = {}
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 30)) {
    const key = rawKey.trim().slice(0, 80)
    if (!key) continue
    if (typeof rawValue === 'string') output[key] = rawValue.slice(0, 300)
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) output[key] = rawValue
    else if (typeof rawValue === 'boolean' || rawValue === null) output[key] = rawValue
  }
  return output
}

function requestIp(headers: Headers): string | null {
  const raw = headers.get('x-vercel-forwarded-for')
    ?? headers.get('x-forwarded-for')
    ?? headers.get('x-real-ip')
  if (!raw) return null
  let value = raw.split(',')[0]?.trim() ?? ''
  if (value.startsWith('::ffff:')) value = value.slice(7)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.replace(/:\d+$/, '')
  return /^[0-9a-f:.]+$/i.test(value) ? value : null
}

function headerHosts(request: Request): Set<string> {
  const hosts = new Set<string>()
  try { hosts.add(new URL(request.url).host.toLowerCase()) } catch { /* ignored */ }
  for (const name of ['x-forwarded-host', 'host']) {
    const raw = request.headers.get(name)
    if (!raw) continue
    const host = raw.split(',')[0]?.trim().toLowerCase()
    if (host) hosts.add(host)
  }
  return hosts
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const originUrl = new URL(origin)
    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') return true
    return headerHosts(request).has(originUrl.host.toLowerCase())
  } catch {
    return false
  }
}

function corsHeaders(request: Request, cacheControl = 'no-store'): Record<string, string> {
  const origin = request.headers.get('origin')
  return {
    'Access-Control-Allow-Origin': origin && sameOrigin(request) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': cacheControl,
    'Vary': 'Origin'
  }
}

function json(request: Request, data: unknown, status = 200, cacheControl = 'no-store'): Response {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(request, cacheControl), 'Content-Type': 'application/json; charset=utf-8' }
  })
}

function serverConfig(): { config?: ServerConfig; missing: string[]; invalidUrl?: boolean } {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  const missing: string[] = []
  if (!rawUrl) missing.push('SUPABASE_URL')
  if (!serviceKey) missing.push('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length || !rawUrl || !serviceKey) return { missing }

  try {
    const parsed = new URL(rawUrl.trim())
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return { missing, invalidUrl: true }
    }
    return {
      missing,
      config: {
        supabaseUrl: parsed.toString().replace(/\/$/, ''),
        serviceKey: serviceKey.trim(),
        countOffset: nonNegativeInteger(process.env.VISIT_COUNT_OFFSET)
      }
    }
  } catch {
    return { missing, invalidUrl: true }
  }
}

function serviceHeaders(serviceKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    'Content-Type': 'application/json'
  }
  if (LEGACY_JWT_RE.test(serviceKey)) headers.Authorization = `Bearer ${serviceKey}`
  return headers
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}

function supabaseErrorCode(status: number, detail: string): string {
  if (status === 404 || detail.includes('PGRST205') || detail.includes('visit_logs')) return 'visit_logs_table_missing'
  if (status === 401 || status === 403) return 'supabase_key_rejected'
  return 'supabase_request_failed'
}

export function parseContentRangeTotal(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/\/(\d+)$/)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

async function queryStoredPageViews(config: ServerConfig): Promise<{ count?: number; error?: { status: number; code: string } }> {
  const response = await fetchWithTimeout(`${config.supabaseUrl}/rest/v1/visit_logs?select=id&event_type=eq.page_view&limit=1`, {
    method: 'GET',
    headers: {
      ...serviceHeaders(config.serviceKey),
      Prefer: 'count=exact',
      Range: '0-0'
    }
  })
  if (!response.ok) {
    const detail = await safeResponseText(response)
    return { error: { status: response.status, code: supabaseErrorCode(response.status, detail) } }
  }
  const count = parseContentRangeTotal(response.headers.get('content-range'))
  return count == null ? { error: { status: 502, code: 'visit_count_unavailable' } } : { count }
}

async function verifiedUserId(request: Request, config: ServerConfig): Promise<string | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null
  try {
    const response = await fetchWithTimeout(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.serviceKey,
        authorization
      }
    })
    if (!response.ok) return null
    const user = await response.json() as { id?: unknown }
    return typeof user.id === 'string' && UUID_RE.test(user.id) ? user.id : null
  } catch {
    return null
  }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] ?? character))
}

function badgeSvg(label: string, value: string, color: string): string {
  const safeLabel = escapeXml(label.slice(0, 24))
  const safeValue = escapeXml(value.slice(0, 24))
  const leftWidth = Math.max(72, safeLabel.length * 13 + 24)
  const rightWidth = Math.max(58, safeValue.length * 12 + 24)
  const totalWidth = leftWidth + rightWidth
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="28" role="img" aria-label="${safeLabel}: ${safeValue}"><title>${safeLabel}: ${safeValue}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-opacity=".12"/></linearGradient><clipPath id="r"><rect width="${totalWidth}" height="28" rx="7"/></clipPath><g clip-path="url(#r)"><rect width="${leftWidth}" height="28" fill="#475569"/><rect x="${leftWidth}" width="${rightWidth}" height="28" fill="${color}"/><rect width="${totalWidth}" height="28" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif" font-size="13"><text x="${leftWidth / 2}" y="19">${safeLabel}</text><text x="${leftWidth + rightWidth / 2}" y="19" font-weight="700">${safeValue}</text></g></svg>`
}

function svgResponse(request: Request, label: string, value: string, color: string, status = 200): Response {
  return new Response(badgeSvg(label, value, color), {
    status,
    headers: {
      ...corsHeaders(request, 'public, max-age=300, s-maxage=300, stale-while-revalidate=600'),
      'Content-Type': 'image/svg+xml; charset=utf-8'
    }
  })
}

async function getStatusOrCount(request: Request, config: ServerConfig): Promise<Response> {
  try {
    const result = await queryStoredPageViews(config)
    const url = new URL(request.url)
    const wantsSvg = url.searchParams.get('format') === 'svg' || url.searchParams.get('format') === 'badge'
    if (result.error) {
      if (wantsSvg) return svgResponse(request, '网站累计访问', '不可用', '#b91c1c', 200)
      return json(request, {
        ok: false,
        version: API_VERSION,
        configured: true,
        tableReady: result.error.code !== 'visit_logs_table_missing',
        code: result.error.code,
        supabaseStatus: result.error.status
      }, result.error.status === 401 || result.error.status === 403 ? 503 : 502)
    }

    const storedPageViews = result.count ?? 0
    const totalPageViews = storedPageViews + config.countOffset
    if (wantsSvg) {
      const label = text(url.searchParams.get('label'), 24) ?? '网站累计访问'
      return svgResponse(request, label, totalPageViews.toLocaleString('en-US'), '#2563eb')
    }
    return json(request, {
      ok: true,
      version: API_VERSION,
      configured: true,
      tableReady: true,
      storedPageViews,
      countOffset: config.countOffset,
      totalPageViews
    }, 200, 'public, max-age=60, s-maxage=60')
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'supabase_timeout' : 'supabase_unreachable'
    const url = new URL(request.url)
    if (url.searchParams.get('format') === 'svg' || url.searchParams.get('format') === 'badge') {
      return svgResponse(request, '网站累计访问', '不可用', '#b91c1c', 200)
    }
    return json(request, { ok: false, version: API_VERSION, configured: true, tableReady: false, code }, 504)
  }
}

async function insertVisit(request: Request, config: ServerConfig): Promise<Response> {
  if (!sameOrigin(request)) {
    console.warn('visit log origin rejected', {
      origin: request.headers.get('origin'),
      requestHost: (() => { try { return new URL(request.url).host } catch { return null } })(),
      forwardedHost: request.headers.get('x-forwarded-host')
    })
    return json(request, { ok: false, code: 'origin_not_allowed' }, 403)
  }

  let payload: VisitPayload
  try {
    payload = await request.json() as VisitPayload
  } catch {
    return json(request, { ok: false, code: 'invalid_json' }, 400)
  }

  const eventId = text(payload.eventId, 36)
  const sessionId = text(payload.sessionId, 36)
  const visitorId = text(payload.visitorId, 36)
  if (!eventId || !sessionId || !UUID_RE.test(eventId) || !UUID_RE.test(sessionId)) {
    return json(request, { ok: false, code: 'invalid_event_or_session_id' }, 400)
  }
  if (visitorId && !UUID_RE.test(visitorId)) return json(request, { ok: false, code: 'invalid_visitor_id' }, 400)

  const eventType = text(payload.eventType, 32) ?? 'page_view'
  if (!ALLOWED_EVENT_TYPES.has(eventType)) return json(request, { ok: false, code: 'unsupported_event_type' }, 400)
  const userId = await verifiedUserId(request, config)
  const headers = request.headers
  const ipAddress = requestIp(headers)
  const geo = await resolveGeo({
    headers,
    ip: ipAddress,
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    serviceHeaders,
  })

  const record = {
    event_id: eventId,
    session_id: sessionId,
    visitor_id: visitorId,
    event_type: eventType,
    user_id: userId,
    ip_address: ipAddress,
    country_code: geo.countryCode,
    region_code: geo.regionCode,
    city: geo.city,
    ip_timezone: geo.timezone,
    geo_source: geo.source,
    geo_resolved_at: geo.resolvedAt,
    edge_region: text(process.env.VERCEL_REGION, 20),
    pathname: text(payload.pathname, 300),
    app_page: text(payload.appPage, 80),
    referrer_origin: text(payload.referrerOrigin, 300),
    utm_source: text(payload.utmSource, 160),
    utm_campaign: text(payload.utmCampaign, 160),
    first_referrer: text(payload.firstReferrer, 300),
    user_agent: text(headers.get('user-agent'), 600),
    browser_language: text(payload.language, 40),
    client_timezone: text(payload.clientTimezone, 80),
    client_time: text(payload.clientTime, 40),
    screen_width: integer(payload.screenWidth, 0, 10000),
    screen_height: integer(payload.screenHeight, 0, 10000),
    viewport_width: integer(payload.viewportWidth, 0, 10000),
    viewport_height: integer(payload.viewportHeight, 0, 10000),
    account_mode: userId ? 'account' : 'guest',
    is_pwa: payload.isPwa === true,
    app_version: text(payload.appVersion, 30),
    metadata: safeMetadata(payload.metadata)
  }

  try {
    const response = await fetchWithTimeout(`${config.supabaseUrl}/rest/v1/visit_logs?on_conflict=event_id`, {
      method: 'POST',
      headers: {
        ...serviceHeaders(config.serviceKey),
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(record)
    })

    if (!response.ok && response.status !== 409) {
      const detail = await safeResponseText(response)
      const code = supabaseErrorCode(response.status, detail)
      console.error('visit log insert failed', response.status, code, detail)
      return json(request, { ok: false, code, supabaseStatus: response.status }, response.status === 401 || response.status === 403 ? 503 : 502)
    }

    return json(request, { ok: true, stored: true, eventId }, 201)
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'supabase_timeout' : 'supabase_unreachable'
    console.error('visit log insert request failed', code)
    return json(request, { ok: false, code }, 504)
  }
}

function configurationError(request: Request, result: { missing: string[]; invalidUrl?: boolean }): Response {
  const url = new URL(request.url)
  if (url.searchParams.get('format') === 'svg' || url.searchParams.get('format') === 'badge') {
    return svgResponse(request, '网站累计访问', '未配置', '#b91c1c', 200)
  }
  return json(request, {
    ok: false,
    version: API_VERSION,
    configured: false,
    code: result.invalidUrl ? 'invalid_supabase_url' : 'missing_environment',
    missing: result.missing
  }, 503)
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })

    const result = serverConfig()
    if (!result.config) return configurationError(request, result)

    if (request.method === 'GET') return getStatusOrCount(request, result.config)
    if (request.method === 'POST') return insertVisit(request, result.config)
    return json(request, { ok: false, code: 'method_not_allowed' }, 405)
  }
}

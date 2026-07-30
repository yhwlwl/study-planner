declare const process: { env: Record<string, string | undefined> }

type VisitPayload = {
  eventId?: unknown
  sessionId?: unknown
  eventType?: unknown
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
}

const API_VERSION = '0.7.0'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LEGACY_JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const ALLOWED_EVENT_TYPES = new Set(['page_view'])

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

function decodeHeader(value: string | null): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value).slice(0, 160)
  } catch {
    return value.slice(0, 160)
  }
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

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) return false
  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true
    return originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  return {
    'Access-Control-Allow-Origin': origin && sameOrigin(request) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  }
}

function json(request: Request, data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' }
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
        serviceKey: serviceKey.trim()
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
  // Legacy service_role keys are JWTs and should also be sent as a bearer token.
  // New sb_secret_ keys are opaque and belong only in the apikey header.
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

async function healthCheck(request: Request, config: ServerConfig): Promise<Response> {
  try {
    const response = await fetchWithTimeout(`${config.supabaseUrl}/rest/v1/visit_logs?select=id&limit=1`, {
      method: 'GET',
      headers: serviceHeaders(config.serviceKey)
    })
    if (!response.ok) {
      const detail = await safeResponseText(response)
      return json(request, {
        ok: false,
        version: API_VERSION,
        configured: true,
        tableReady: false,
        code: supabaseErrorCode(response.status, detail),
        supabaseStatus: response.status,
        detail
      }, response.status === 401 || response.status === 403 ? 503 : 502)
    }
    return json(request, {
      ok: true,
      version: API_VERSION,
      configured: true,
      tableReady: true
    })
  } catch (error) {
    return json(request, {
      ok: false,
      version: API_VERSION,
      configured: true,
      tableReady: false,
      code: error instanceof DOMException && error.name === 'AbortError' ? 'supabase_timeout' : 'supabase_unreachable'
    }, 504)
  }
}

async function insertVisit(request: Request, config: ServerConfig): Promise<Response> {
  if (!sameOrigin(request)) return json(request, { ok: false, code: 'origin_not_allowed' }, 403)

  let payload: VisitPayload
  try {
    payload = await request.json() as VisitPayload
  } catch {
    return json(request, { ok: false, code: 'invalid_json' }, 400)
  }

  const eventId = text(payload.eventId, 36)
  const sessionId = text(payload.sessionId, 36)
  if (!eventId || !sessionId || !UUID_RE.test(eventId) || !UUID_RE.test(sessionId)) {
    return json(request, { ok: false, code: 'invalid_event_or_session_id' }, 400)
  }

  const eventTypeCandidate = text(payload.eventType, 32) ?? 'page_view'
  const eventType = ALLOWED_EVENT_TYPES.has(eventTypeCandidate) ? eventTypeCandidate : 'page_view'
  const userId = await verifiedUserId(request, config)
  const headers = request.headers

  const record = {
    event_id: eventId,
    session_id: sessionId,
    event_type: eventType,
    user_id: userId,
    ip_address: requestIp(headers),
    country_code: text(headers.get('x-vercel-ip-country'), 2),
    region_code: text(headers.get('x-vercel-ip-country-region'), 8),
    city: decodeHeader(headers.get('x-vercel-ip-city')),
    ip_timezone: text(headers.get('x-vercel-ip-timezone'), 80),
    edge_region: text(process.env.VERCEL_REGION, 20),
    pathname: text(payload.pathname, 300),
    referrer_origin: text(payload.referrerOrigin, 300),
    user_agent: text(headers.get('user-agent'), 600),
    browser_language: text(payload.language, 40),
    client_timezone: text(payload.clientTimezone, 80),
    client_time: text(payload.clientTime, 40),
    screen_width: integer(payload.screenWidth, 0, 10000),
    screen_height: integer(payload.screenHeight, 0, 10000),
    viewport_width: integer(payload.viewportWidth, 0, 10000),
    viewport_height: integer(payload.viewportHeight, 0, 10000),
    account_mode: payload.accountMode === 'account' ? 'account' : 'guest',
    is_pwa: payload.isPwa === true,
    app_version: text(payload.appVersion, 30),
    metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {}
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
      return json(request, {
        ok: false,
        code,
        supabaseStatus: response.status,
        detail
      }, response.status === 401 || response.status === 403 ? 503 : 502)
    }

    return json(request, { ok: true, stored: true, eventId }, 201)
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'AbortError' ? 'supabase_timeout' : 'supabase_unreachable'
    console.error('visit log insert request failed', code)
    return json(request, { ok: false, code }, 504)
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })

    const result = serverConfig()
    if (!result.config) {
      return json(request, {
        ok: false,
        version: API_VERSION,
        configured: false,
        code: result.invalidUrl ? 'invalid_supabase_url' : 'missing_environment',
        missing: result.missing
      }, 503)
    }

    if (request.method === 'GET') return healthCheck(request, result.config)
    if (request.method === 'POST') return insertVisit(request, result.config)
    return json(request, { ok: false, code: 'method_not_allowed' }, 405)
  }
}

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function verifiedUserId(request: Request, supabaseUrl: string, serviceKey: string): Promise<string | null> {
  const authorization = request.headers.get('authorization')
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceKey,
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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
    if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)
    if (!sameOrigin(request)) return json(request, { error: 'Origin not allowed' }, 403)

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return json(request, { error: 'Server logging is not configured' }, 503)

    let payload: VisitPayload
    try {
      payload = await request.json() as VisitPayload
    } catch {
      return json(request, { error: 'Invalid JSON' }, 400)
    }

    const eventId = text(payload.eventId, 36)
    const sessionId = text(payload.sessionId, 36)
    if (!eventId || !sessionId || !UUID_RE.test(eventId) || !UUID_RE.test(sessionId)) {
      return json(request, { error: 'Invalid event or session id' }, 400)
    }

    const eventTypeCandidate = text(payload.eventType, 32) ?? 'page_view'
    const eventType = ALLOWED_EVENT_TYPES.has(eventTypeCandidate) ? eventTypeCandidate : 'page_view'
    const userId = await verifiedUserId(request, supabaseUrl, serviceKey)
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

    const response = await fetch(`${supabaseUrl}/rest/v1/visit_logs?on_conflict=event_id`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(record)
    })

    if (!response.ok && response.status !== 409) {
      const message = (await response.text()).slice(0, 500)
      console.error('visit log insert failed', response.status, message)
      return json(request, { error: 'Log insert failed' }, 502)
    }

    return json(request, { ok: true }, 201)
  }
}

import { resolveGeo, type GeoResult } from './geo-enrichment.js'

declare const process: { env: Record<string, string | undefined> }

type MetricPayload = {
  eventId?: unknown
  sessionId?: unknown
  visitorId?: unknown
  eventType?: unknown
  pathname?: unknown
  appPage?: unknown
  clientTime?: unknown
  language?: unknown
  clientTimezone?: unknown
  screenWidth?: unknown
  screenHeight?: unknown
  viewportWidth?: unknown
  viewportHeight?: unknown
  isPwa?: unknown
  appVersion?: unknown
  metadata?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LEGACY_JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const ALLOWED = new Set([
  'heartbeat',
  'tutorial_started',
  'tutorial_completed',
  'github_repo_clicked',
  'pwa_launch',
  'pwa_installed',
  'pwa_prompt_shown',
  'pwa_guide_opened',
])

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v ? v.slice(0, maxLength) : null
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return Math.min(max, Math.max(min, value))
}

function metadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string | number | boolean | null> = {}
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 30)) {
    const key = rawKey.trim().slice(0, 80)
    if (!key) continue
    if (typeof rawValue === 'string') out[key] = rawValue.slice(0, 300)
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) out[key] = rawValue
    else if (typeof rawValue === 'boolean' || rawValue === null) out[key] = rawValue
  }
  return out
}

function hosts(request: Request) {
  const values = new Set<string>()
  try { values.add(new URL(request.url).host.toLowerCase()) } catch { /* ignored */ }
  for (const name of ['x-forwarded-host', 'host']) {
    const value = request.headers.get(name)?.split(',')[0]?.trim().toLowerCase()
    if (value) values.add(value)
  }
  return values
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
    return hosts(request).has(url.host.toLowerCase())
  } catch {
    return false
  }
}

function requestIp(headers: Headers): string | null {
  const raw = headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for') ?? headers.get('x-real-ip')
  if (!raw) return null
  let value = raw.split(',')[0]?.trim() ?? ''
  if (value.startsWith('::ffff:')) value = value.slice(7)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.replace(/:\d+$/, '')
  return /^[0-9a-f:.]+$/i.test(value) ? value : null
}

function serviceHeaders(serviceKey: string) {
  const result: Record<string, string> = { apikey: serviceKey, 'Content-Type': 'application/json' }
  if (LEGACY_JWT_RE.test(serviceKey)) result.Authorization = `Bearer ${serviceKey}`
  return result
}

async function verifiedUserId(request: Request, supabaseUrl: string, serviceKey: string) {
  const authorization = request.headers.get('authorization')
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, authorization } })
    if (!response.ok) return null
    const user = await response.json() as { id?: unknown }
    return typeof user.id === 'string' && UUID_RE.test(user.id) ? user.id : null
  } catch {
    return null
  }
}

function response(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get('origin')
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin && sameOrigin(request) ? origin : 'null',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    },
  })
}

// 城市级地理位置解析是尽力而为的增强：解析器任何异常都不允许阻断埋点写入。
async function resolveGeoOrFallback(input: Parameters<typeof resolveGeo>[0]): Promise<GeoResult> {
  try {
    return await resolveGeo(input)
  } catch (error) {
    console.warn('geo resolution failed; continuing without enrichment', error)
    return { countryCode: null, regionCode: null, city: null, timezone: null, source: 'unresolved', resolvedAt: null }
  }
}

export default {
  async fetch(request: Request) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
      if (request.method !== 'POST') return response(request, { ok: false, code: 'method_not_allowed' }, 405)
      if (!sameOrigin(request)) return response(request, { ok: false, code: 'origin_not_allowed' }, 403)

      const rawUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!rawUrl || !serviceKey) return response(request, { ok: false, code: 'missing_environment' }, 503)
      const supabaseUrl = rawUrl.replace(/\/$/, '')

      let payload: MetricPayload
      try { payload = await request.json() as MetricPayload } catch { return response(request, { ok: false, code: 'invalid_json' }, 400) }

    const eventId = text(payload.eventId, 36)
    const sessionId = text(payload.sessionId, 36)
    const visitor = text(payload.visitorId, 36)
    const eventType = text(payload.eventType, 32)
    if (!eventId || !sessionId || !visitor || !UUID_RE.test(eventId) || !UUID_RE.test(sessionId) || !UUID_RE.test(visitor)) {
      return response(request, { ok: false, code: 'invalid_ids' }, 400)
    }
    if (!eventType || !ALLOWED.has(eventType)) return response(request, { ok: false, code: 'unsupported_event_type' }, 400)

    const userId = await verifiedUserId(request, supabaseUrl, serviceKey)
    const headers = request.headers
    const ipAddress = requestIp(headers)
    const geo = await resolveGeoOrFallback({ headers, ip: ipAddress, supabaseUrl, serviceKey, serviceHeaders })
    const record = {
      event_id: eventId,
      session_id: sessionId,
      visitor_id: visitor,
      event_type: eventType,
      user_id: userId,
      occurred_at: new Date().toISOString(),
      client_time: text(payload.clientTime, 64),
      ip_address: ipAddress,
      country_code: geo.countryCode,
      region_code: geo.regionCode,
      city: geo.city,
      ip_timezone: geo.timezone,
      geo_source: geo.source,
      geo_resolved_at: geo.resolvedAt,
      edge_region: text(headers.get('x-vercel-id')?.split('::')[0], 40),
      pathname: text(payload.pathname, 300),
      referrer_origin: null,
      user_agent: text(headers.get('user-agent'), 500),
      browser_language: text(payload.language, 80),
      client_timezone: text(payload.clientTimezone, 80),
      screen_width: integer(payload.screenWidth, 0, 10000),
      screen_height: integer(payload.screenHeight, 0, 10000),
      viewport_width: integer(payload.viewportWidth, 0, 10000),
      viewport_height: integer(payload.viewportHeight, 0, 10000),
      account_mode: userId ? 'account' : 'guest',
      is_pwa: payload.isPwa === true,
      app_version: text(payload.appVersion, 30),
      metadata: metadata(payload.metadata),
      app_page: text(payload.appPage, 80),
      utm_source: null,
      utm_campaign: null,
      first_referrer: null,
    }

    try {
      const insert = await fetch(`${supabaseUrl}/rest/v1/visit_logs?on_conflict=event_id`, {
        method: 'POST',
        headers: { ...serviceHeaders(serviceKey), Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(record),
      })
      if (!insert.ok) {
        console.warn('metric event insert failed', insert.status, (await insert.text()).slice(0, 300))
        return response(request, { ok: false, code: 'storage_failed' }, 502)
      }
      return response(request, { ok: true }, 201)
    } catch {
      return response(request, { ok: false, code: 'storage_unreachable' }, 504)
    }
    } catch (error) {
      // 任何未预期的异常都必须以结构化 JSON 返回，而不是抛给 Vercel 变成裸 500/超时。
      console.error('metric-event unexpected error', error)
      return response(request, { ok: false, code: 'internal_error' }, 500)
    }
  },
}

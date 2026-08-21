import { createClient } from '@supabase/supabase-js'

declare const process: { env: Record<string, string | undefined> }

type GuestAttachmentPayload = {
  visitorId?: unknown
  guestSecret?: unknown
}

type ServerConfig = {
  supabaseUrl: string
  serviceKey: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCREENSHOT_BUCKET = 'feedback-screenshots'
const SIGNED_URL_TTL_SECONDS = 60 * 30

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
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

function sameOrigin(request: Request): boolean {
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

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  return {
    'Access-Control-Allow-Origin': origin && sameOrigin(request) ? origin : 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  }
}

function json(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function serverConfig(): ServerConfig | undefined {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!rawUrl || !serviceKey) return undefined
  try {
    const parsed = new URL(rawUrl.trim())
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return undefined
    return { supabaseUrl: parsed.toString().replace(/\/$/, ''), serviceKey: serviceKey.trim() }
  } catch {
    return undefined
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
    if (request.method !== 'POST') return json(request, { ok: false, code: 'method_not_allowed' }, 405)
    if (!sameOrigin(request)) return json(request, { ok: false, code: 'origin_not_allowed' }, 403)

    const config = serverConfig()
    if (!config) return json(request, { ok: false, code: 'missing_environment' }, 503)

    let payload: GuestAttachmentPayload
    try { payload = await request.json() as GuestAttachmentPayload }
    catch { return json(request, { ok: false, code: 'invalid_json' }, 400) }

    const visitorId = text(payload.visitorId, 36)
    const guestSecret = text(payload.guestSecret, 512)
    if (!visitorId || !UUID_RE.test(visitorId) || !guestSecret || guestSecret.length < 32) {
      return json(request, { ok: false, code: 'invalid_guest_identity' }, 400)
    }

    const service = createClient(config.supabaseUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    // 先复用数据库里经过 visitor_id + secret hash 校验的游客历史 RPC，绝不让 service key 的权限扩大调用者可见范围。
    const history = await service.rpc('list_guest_feedback', {
      p_visitor_id: visitorId,
      p_guest_secret: guestSecret,
    })
    if (history.error) return json(request, { ok: false, code: 'guest_history_unavailable' }, 502)
    if (!Array.isArray(history.data) || history.data.length === 0) return json(request, { ok: true, attachments: [] })

    const feedbackIds = history.data
      .map((row: any) => typeof row?.id === 'string' && UUID_RE.test(row.id) ? row.id : undefined)
      .filter((id: string | undefined): id is string => Boolean(id))
    if (!feedbackIds.length) return json(request, { ok: true, attachments: [] })

    const attachmentResult = await service
      .from('feedback_attachments')
      .select('id,feedback_id,reply_id,storage_path,file_name,mime_type,size_bytes,created_at')
      .in('feedback_id', feedbackIds)
      .not('reply_id', 'is', null)
      .order('created_at', { ascending: true })
    if (attachmentResult.error) return json(request, { ok: false, code: 'attachment_metadata_unavailable' }, 502)

    const rows = (attachmentResult.data ?? []).filter((row: any) => typeof row.storage_path === 'string' && row.storage_path)
    if (!rows.length) return json(request, { ok: true, attachments: [] })

    const paths = rows.map((row: any) => row.storage_path as string)
    const signed = await service.storage.from(SCREENSHOT_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    if (signed.error || !signed.data) return json(request, { ok: false, code: 'attachment_signing_failed' }, 502)

    const signedByPath = new Map<string, string>()
    for (const item of signed.data) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl)
    }

    return json(request, {
      ok: true,
      attachments: rows.flatMap((row: any) => {
        const signedUrl = signedByPath.get(row.storage_path)
        if (!signedUrl) return []
        return [{
          id: String(row.id),
          feedback_id: String(row.feedback_id),
          reply_id: row.reply_id ? String(row.reply_id) : null,
          file_name: String(row.file_name ?? '图片'),
          mime_type: String(row.mime_type ?? 'image/jpeg'),
          size_bytes: Number(row.size_bytes ?? 0),
          created_at: String(row.created_at),
          signed_url: signedUrl,
        }]
      }),
    })
  },
}

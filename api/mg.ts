const MG_UPSTREAM = 'https://kdwpmcdxapwecbfrvqtm.supabase.co/functions/v1/mg-admin'

function responseHeaders(isHtml: boolean): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  })
  if (isHtml) {
    headers.set('Content-Type', 'text/html; charset=utf-8')
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co https://esm.sh; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
  } else {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  }
  return headers
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: responseHeaders(false) })
    }

    const incoming = new URL(request.url)
    const upstream = new URL(MG_UPSTREAM)
    upstream.search = incoming.search

    const headers = new Headers({ Accept: incoming.searchParams.has('action') ? 'application/json' : 'text/html' })
    const authorization = request.headers.get('authorization')
    if (authorization) headers.set('Authorization', authorization)

    try {
      const response = await fetch(upstream, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
      })
      const isHtml = !incoming.searchParams.has('action')
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: responseHeaders(isHtml),
      })
    } catch (error) {
      const code = error instanceof DOMException && error.name === 'TimeoutError' ? 'mg_upstream_timeout' : 'mg_upstream_unavailable'
      return new Response(JSON.stringify({ error: code }), { status: 502, headers: responseHeaders(false) })
    }
  },
}

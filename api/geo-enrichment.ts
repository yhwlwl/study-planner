type ServiceHeadersFactory = (serviceKey: string) => Record<string, string>

type GeoResult = {
  countryCode: string | null
  regionCode: string | null
  city: string | null
  timezone: string | null
  source: 'vercel_header' | 'ipwhois_cache' | 'ipwhois' | 'country_only' | 'unresolved'
  resolvedAt: string | null
}

type CachedGeo = {
  country_code?: unknown
  region_code?: unknown
  city?: unknown
  timezone?: unknown
  provider?: unknown
  resolved_at?: unknown
}

type IpWhoResponse = {
  success?: unknown
  country_code?: unknown
  region_code?: unknown
  city?: unknown
  timezone?: { id?: unknown } | unknown
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v ? v.slice(0, maxLength) : null
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null
  try { return decodeURIComponent(value).slice(0, 160) } catch { return value.slice(0, 160) }
}

function publicIp(value: string | null): boolean {
  if (!value) return false
  if (value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return false
  const m = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return value.includes(':')
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10 || a === 127 || a === 0) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  return true
}

async function fetchJson(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    if (!response.ok) return undefined
    return await response.json() as unknown
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function cachedGeo(value: unknown): CachedGeo | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value.length ? cachedGeo(value[0]) : undefined
  if (typeof value === 'object') return value as CachedGeo
  return undefined
}

function ipWhoTimezone(value: IpWhoResponse['timezone']) {
  if (typeof value === 'string') return clean(value, 80)
  if (value && typeof value === 'object' && !Array.isArray(value)) return clean((value as { id?: unknown }).id, 80)
  return null
}

/**
 * 城市解析采用两级来源：
 * 1. 优先使用 Vercel 原生地理位置 Header（零额外网络请求）；
 * 2. Header 没有 city 时，仅对公网 IP 使用 ipwho.is HTTPS 回退，并写入 30 天服务端缓存。
 *
 * 这样不会让所有访问都依赖第三方解析器，也能显著减少 Vercel 只给国家、不返回城市时的 unknown。
 */
export async function resolveGeo(input: {
  headers: Headers
  ip: string | null
  supabaseUrl: string
  serviceKey: string
  serviceHeaders: ServiceHeadersFactory
}): Promise<GeoResult> {
  const countryCode = clean(input.headers.get('x-vercel-ip-country'), 2)
  const regionCode = clean(input.headers.get('x-vercel-ip-country-region'), 16)
  const city = decodeHeader(input.headers.get('x-vercel-ip-city'))
  const timezone = clean(input.headers.get('x-vercel-ip-timezone'), 80)
  if (city) {
    return { countryCode, regionCode, city, timezone, source: 'vercel_header', resolvedAt: new Date().toISOString() }
  }

  if (!publicIp(input.ip)) {
    return { countryCode, regionCode, city: null, timezone, source: countryCode ? 'country_only' : 'unresolved', resolvedAt: null }
  }

  const rpcHeaders = input.serviceHeaders(input.serviceKey)
  const cache = cachedGeo(await fetchJson(`${input.supabaseUrl}/rest/v1/rpc/ip_geo_cache_get`, {
    method: 'POST',
    headers: rpcHeaders,
    body: JSON.stringify({ p_ip: input.ip }),
  }, 1200))
  const cachedCity = clean(cache?.city, 160)
  if (cachedCity) {
    return {
      countryCode: clean(cache?.country_code, 2) ?? countryCode,
      regionCode: clean(cache?.region_code, 16) ?? regionCode,
      city: cachedCity,
      timezone: clean(cache?.timezone, 80) ?? timezone,
      source: 'ipwhois_cache',
      resolvedAt: clean(cache?.resolved_at, 64),
    }
  }

  const remote = await fetchJson(`https://ipwho.is/${encodeURIComponent(input.ip!)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Study-Planner-Geo/1.0' },
  }, 1800) as IpWhoResponse | undefined
  const remoteCity = clean(remote?.city, 160)
  if (remote?.success !== true || !remoteCity) {
    return { countryCode, regionCode, city: null, timezone, source: countryCode ? 'country_only' : 'unresolved', resolvedAt: null }
  }

  const resolved: GeoResult = {
    countryCode: clean(remote.country_code, 2) ?? countryCode,
    regionCode: clean(remote.region_code, 16) ?? regionCode,
    city: remoteCity,
    timezone: ipWhoTimezone(remote.timezone) ?? timezone,
    source: 'ipwhois',
    resolvedAt: new Date().toISOString(),
  }

  // 缓存失败不能影响访问日志写入，因此这里尽力而为。
  void fetch(`${input.supabaseUrl}/rest/v1/rpc/ip_geo_cache_put`, {
    method: 'POST',
    headers: rpcHeaders,
    body: JSON.stringify({
      p_ip: input.ip,
      p_country_code: resolved.countryCode,
      p_region_code: resolved.regionCode,
      p_city: resolved.city,
      p_timezone: resolved.timezone,
      p_provider: 'ipwho.is',
      p_ttl_days: 30,
    }),
  }).catch(() => undefined)

  return resolved
}

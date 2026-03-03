const INPUT_TIPS_URL = 'https://restapi.amap.com/v3/assistant/inputtips'

const DEFAULTS = {
  cacheTtlMs: 10 * 60 * 1000,
  maxCacheEntries: 500,
  rateLimitPerMinute: 60,
  requestTimeoutMs: 5000,
  minKeywordLength: 2,
  maxKeywordLength: 30,
}

class LruTtlCache {
  constructor(maxEntries, ttlMs, now = () => Date.now()) {
    this.maxEntries = maxEntries
    this.ttlMs = ttlMs
    this.now = now
    this.store = new Map()
  }

  get(key) {
    const found = this.store.get(key)
    if (!found) return null
    if (found.expireAt <= this.now()) {
      this.store.delete(key)
      return null
    }
    this.store.delete(key)
    this.store.set(key, found)
    return found.value
  }

  set(key, value) {
    this.store.delete(key)
    this.store.set(key, { value, expireAt: this.now() + this.ttlMs })
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      this.store.delete(oldest)
    }
  }
}

class MinuteRateLimiter {
  constructor(limitPerMinute, now = () => Date.now()) {
    this.limitPerMinute = limitPerMinute
    this.now = now
    this.bucket = new Map()
  }

  hit(key) {
    const minute = Math.floor(this.now() / 60000)
    const current = this.bucket.get(key)
    if (!current || current.minute !== minute) {
      this.bucket.set(key, { minute, count: 1 })
      return false
    }
    current.count += 1
    return current.count > this.limitPerMinute
  }
}

function writeJson(res, code, body) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function clean(value) {
  if (!value) return null
  const v = value.trim()
  return v.length ? v : null
}

function isSafeCity(city) {
  return /^[\u4e00-\u9fa5a-zA-Z0-9\-]{1,20}$/.test(city)
}

function isSafeType(type) {
  return /^[0-9|]{1,40}$/.test(type)
}

function isSafeLocation(location) {
  return /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)
}

function isAdministrativeLike(item) {
  const name = item.name || ''
  return /省|市|区|县|旗|盟|州|镇|乡|街道$/.test(name) || Boolean(item.district)
}

function normalizeMode(scopeOrMode) {
  if (!scopeOrMode) return 'poi'
  const value = scopeOrMode.trim().toLowerCase()
  if (value === 'city') return 'city'
  return 'poi'
}

function normalizeTips(raw) {
  const tips = Array.isArray(raw?.tips) ? raw.tips : []
  return tips
    .map((item) => ({
      name: typeof item?.name === 'string' ? item.name : '',
      address: typeof item?.address === 'string' ? item.address : '',
      location: typeof item?.location === 'string' ? item.location : '',
      adcode: typeof item?.adcode === 'string' ? item.adcode : '',
      district: typeof item?.district === 'string' ? item.district : '',
      id: typeof item?.id === 'string' ? item.id : '',
    }))
    .filter((item) => item.location)
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export function createInputTipsProxyHandler(options) {
  const {
    amapKey,
    fetchImpl = fetch,
    now = () => Date.now(),
    cache = new LruTtlCache(options?.maxCacheEntries ?? DEFAULTS.maxCacheEntries, options?.cacheTtlMs ?? DEFAULTS.cacheTtlMs, now),
    rateLimiter = new MinuteRateLimiter(options?.rateLimitPerMinute ?? DEFAULTS.rateLimitPerMinute, now),
    minKeywordLength = DEFAULTS.minKeywordLength,
    maxKeywordLength = DEFAULTS.maxKeywordLength,
    requestTimeoutMs = DEFAULTS.requestTimeoutMs,
  } = options ?? {}

  return async function inputTipsProxy(req, res) {
    if (!req.url) return writeJson(res, 400, { ok: false, data: [], cached: false, reason: 'INVALID_URL' })
    if (!amapKey) return writeJson(res, 500, { ok: false, data: [], cached: false, reason: 'NO_AMAP_KEY' })

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
    if (rateLimiter.hit(ip)) {
      return writeJson(res, 429, { ok: false, data: [], cached: false, reason: 'RATE_LIMITED' })
    }

    const requestUrl = new URL(req.url, 'http://localhost')
    const ua = req.headers['user-agent'] || ''
    const referer = req.headers.referer || req.headers.referrer || ''
    if (!ua || (referer && !String(referer).includes('localhost') && !String(referer).includes('127.0.0.1'))) {
      return writeJson(res, 403, { ok: false, data: [], cached: false, reason: 'FORBIDDEN_CLIENT' })
    }

    const keywords = clean(requestUrl.searchParams.get('keywords'))
    const city = clean(requestUrl.searchParams.get('city'))
    const citylimit = clean(requestUrl.searchParams.get('citylimit'))
    const datatype = clean(requestUrl.searchParams.get('datatype')) || 'all'
    const rawType = clean(requestUrl.searchParams.get('type'))
    const location = clean(requestUrl.searchParams.get('location'))
    const mode = normalizeMode(clean(requestUrl.searchParams.get('mode')) ?? clean(requestUrl.searchParams.get('scope')))

    if (!keywords) {
      return writeJson(res, 400, {
        ok: false,
        data: [],
        cached: false,
        reason: 'INVALID_KEYWORDS',
        message: 'keywords 不能为空。',
      })
    }

    if (keywords.length < minKeywordLength) {
      return writeJson(res, 200, { ok: true, data: [], cached: false, reason: 'KEYWORDS_TOO_SHORT' })
    }
    if (keywords.length > maxKeywordLength) {
      return writeJson(res, 400, { ok: false, data: [], cached: false, reason: 'KEYWORDS_TOO_LONG' })
    }

    if (city && !isSafeCity(city)) return writeJson(res, 400, { ok: false, data: [], cached: false, reason: 'INVALID_CITY' })
    if (location && !isSafeLocation(location)) {
      return writeJson(res, 400, { ok: false, data: [], cached: false, reason: 'INVALID_LOCATION' })
    }

    const type = rawType && isSafeType(rawType) ? rawType : null
    const cacheKey = [keywords, city ?? '', mode, type ?? '', location ?? '', datatype].join('|')
    const cached = cache.get(cacheKey)
    if (cached) return writeJson(res, 200, { ok: true, data: cached, cached: true })

    const targetUrl = new URL(INPUT_TIPS_URL)
    targetUrl.searchParams.set('key', amapKey)
    targetUrl.searchParams.set('keywords', keywords)
    targetUrl.searchParams.set('datatype', datatype)
    targetUrl.searchParams.set('output', 'json')
    if (city) targetUrl.searchParams.set('city', city)
    if (citylimit) targetUrl.searchParams.set('citylimit', citylimit)
    if (type) targetUrl.searchParams.set('type', type)
    if (location) targetUrl.searchParams.set('location', location)

    try {
      const upstream = await fetchWithTimeout(fetchImpl, targetUrl.toString(), requestTimeoutMs)
      const payload = await upstream.json()
      const normalized = normalizeTips(payload)
      // 城市模式不再转发 type=city 给高德；仅在代理层做行政区倾向过滤，避免 INVALID_TYPE。
      const data = mode === 'city' ? normalized.filter(isAdministrativeLike) : normalized
      cache.set(cacheKey, data)
      return writeJson(res, 200, { ok: true, data, cached: false })
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILED'
      return writeJson(res, 200, { ok: false, data: [], cached: false, reason })
    }
  }
}

export function __testables() {
  return { LruTtlCache, MinuteRateLimiter, normalizeTips }
}

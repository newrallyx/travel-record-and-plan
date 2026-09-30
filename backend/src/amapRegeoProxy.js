function readOptionalParam(url, key) {
  const value = url.searchParams.get(key)
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function isSafeLocation(location) {
  return /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)
}

async function fetchWithTimeout(targetUrl, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(targetUrl, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export function createRegeoProxyHandler({ amapWebApiKey, getAmapWebApiKey } = {}) {
  return async function handleRegeo(req, res) {
    if (!req.url) {
      res.status(400).json({ ok: false, message: '缺少请求 URL' })
      return
    }

    const currentAmapWebApiKey = typeof getAmapWebApiKey === 'function' ? getAmapWebApiKey() : amapWebApiKey
    if (!currentAmapWebApiKey) {
      res.status(500).json({ ok: false, message: 'AMAP_WEB_API_KEY missing' })
      return
    }

    const requestUrl = new URL(req.url, 'http://localhost')
    const location = readOptionalParam(requestUrl, 'location')
    if (!location || !isSafeLocation(location)) {
      res.status(400).json({ ok: false, message: 'location 必须是经度,纬度' })
      return
    }

    const targetUrl = new URL('https://restapi.amap.com/v3/geocode/regeo')
    targetUrl.searchParams.set('key', currentAmapWebApiKey)
    targetUrl.searchParams.set('location', location)
    targetUrl.searchParams.set('extensions', 'base')
    targetUrl.searchParams.set('output', 'json')

    try {
      const upstream = await fetchWithTimeout(targetUrl.toString(), 5000)
      const data = await upstream.json()
      if (!upstream.ok) {
        res.status(upstream.status).json({ ok: false, message: 'regeo upstream error', detail: data })
        return
      }
      res.status(200).json({ ok: true, data })
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'regeo timeout(5s)' : 'regeo proxy failed'
      res.status(502).json({ ok: false, message })
    }
  }
}

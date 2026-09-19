function readOptionalParam(url, key) {
  const value = url.searchParams.get(key)
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
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

export function createDirectionProxyHandler({ amapWebApiKey, getAmapWebApiKey } = {}) {
  return async function handleDirection(req, res) {
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
    const origin = readOptionalParam(requestUrl, 'origin')
    const destination = readOptionalParam(requestUrl, 'destination')
    const strategy = readOptionalParam(requestUrl, 'strategy') ?? '0'
    const waypoints = readOptionalParam(requestUrl, 'waypoints')

    if (!origin || !destination) {
      res.status(400).json({ ok: false, message: 'origin 和 destination 为必填参数' })
      return
    }

    const targetUrl = new URL('https://restapi.amap.com/v3/direction/driving')
    targetUrl.searchParams.set('key', currentAmapWebApiKey)
    targetUrl.searchParams.set('origin', origin)
    targetUrl.searchParams.set('destination', destination)
    targetUrl.searchParams.set('strategy', strategy)
    targetUrl.searchParams.set('extensions', 'all')
    targetUrl.searchParams.set('output', 'json')
    if (waypoints) {
      targetUrl.searchParams.set('waypoints', waypoints.replace(/\|/g, ';'))
    }

    try {
      const upstream = await fetchWithTimeout(targetUrl.toString(), 5000)
      const data = await upstream.json()
      if (!upstream.ok) {
        res.status(upstream.status).json({ ok: false, message: 'direction upstream error', detail: data })
        return
      }
      res.status(200).json({ ok: true, data })
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'direction timeout(5s)' : 'direction proxy failed'
      res.status(502).json({ ok: false, message })
    }
  }
}

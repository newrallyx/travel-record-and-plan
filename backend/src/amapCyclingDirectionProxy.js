import { readOptionalParam, requestUpstreamJson } from './upstreamRequest.js'

export function createCyclingDirectionProxyHandler({ amapWebApiKey, getAmapWebApiKey } = {}) {
  return async function handleCyclingDirection(req, res) {
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

    if (!origin || !destination) {
      res.status(400).json({ ok: false, message: 'origin 和 destination 为必填参数' })
      return
    }

    const targetUrl = new URL('https://restapi.amap.com/v4/direction/bicycling')
    targetUrl.searchParams.set('key', currentAmapWebApiKey)
    targetUrl.searchParams.set('origin', origin)
    targetUrl.searchParams.set('destination', destination)
    targetUrl.searchParams.set('output', 'json')

    try {
      const { response: upstream, data } = await requestUpstreamJson(targetUrl.toString())
      if (!upstream.ok) {
        res.status(upstream.status).json({ ok: false, message: 'cycling direction upstream error', detail: data })
        return
      }
      res.status(200).json({ ok: true, data })
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'cycling direction timeout(5s)' : 'cycling direction proxy failed'
      res.status(502).json({ ok: false, code: error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILED', message })
    }
  }
}

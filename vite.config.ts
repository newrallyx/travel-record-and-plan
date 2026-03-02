import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { cwd: () => string }

function readOptionalParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function writeJson(response: any, statusCode: number, body: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

async function fetchWithTimeout(targetUrl: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(targetUrl, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function createInputTipsProxy(amapWebKey: string) {
  return async function handleInputTips(req: any, res: any) {
    if (!req.url) {
      writeJson(res, 400, { status: '0', info: '缺少请求 URL', infocode: 'INVALID_REQUEST' })
      return
    }

    const requestUrl = new URL(req.url, 'http://localhost')
    const keywords = readOptionalParam(requestUrl, 'keywords')
    const type = readOptionalParam(requestUrl, 'type')
    const city = readOptionalParam(requestUrl, 'city')
    const citylimit = readOptionalParam(requestUrl, 'citylimit')

    if (!keywords) {
      writeJson(res, 400, { status: '0', info: 'keywords 为必填参数', infocode: 'MISSING_KEYWORDS' })
      return
    }

    if (!amapWebKey) {
      writeJson(res, 500, { status: '0', info: '服务端未配置 AMAP_WEB_KEY', infocode: 'NO_AMAP_WEB_KEY' })
      return
    }

    const targetUrl = new URL('https://restapi.amap.com/v3/assistant/inputtips')
    targetUrl.searchParams.set('key', amapWebKey)
    targetUrl.searchParams.set('keywords', keywords)
    targetUrl.searchParams.set('datatype', 'all')
    if (type) targetUrl.searchParams.set('type', type)
    if (city) targetUrl.searchParams.set('city', city)
    if (citylimit) targetUrl.searchParams.set('citylimit', citylimit)

    try {
      const upstream = await fetchWithTimeout(targetUrl.toString(), 5000)
      const json = (await upstream.json()) as unknown
      writeJson(res, upstream.status, json)
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? '高德输入提示请求超时（5s）' : '高德输入提示代理请求失败'
      writeJson(res, 502, { status: '0', info: message, infocode: 'UPSTREAM_ERROR' })
    }
  }
}

function createDirectionProxy(amapWebKey: string) {
  return async function handleDirection(req: any, res: any) {
    if (!req.url) {
      writeJson(res, 400, { ok: false, message: '缺少请求 URL' })
      return
    }

    if (!amapWebKey) {
      writeJson(res, 500, { ok: false, message: 'AMAP_WEB_KEY missing' })
      return
    }

    const requestUrl = new URL(req.url, 'http://localhost')
    const origin = readOptionalParam(requestUrl, 'origin')
    const destination = readOptionalParam(requestUrl, 'destination')
    const strategy = readOptionalParam(requestUrl, 'strategy') ?? '0'
    const waypoints = readOptionalParam(requestUrl, 'waypoints')

    if (!origin || !destination) {
      writeJson(res, 400, { ok: false, message: 'origin 和 destination 为必填参数' })
      return
    }

    const targetUrl = new URL('https://restapi.amap.com/v3/direction/driving')
    targetUrl.searchParams.set('key', amapWebKey)
    targetUrl.searchParams.set('origin', origin)
    targetUrl.searchParams.set('destination', destination)
    targetUrl.searchParams.set('strategy', strategy)
    if (waypoints) {
      targetUrl.searchParams.set('waypoints', waypoints.replace(/\|/g, ';'))
    }

    try {
      const upstream = await fetchWithTimeout(targetUrl.toString(), 5000)
      const data = (await upstream.json()) as unknown
      if (!upstream.ok) {
        writeJson(res, upstream.status, { ok: false, message: 'direction upstream error', detail: data })
        return
      }
      writeJson(res, 200, { ok: true, data })
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? 'direction timeout(5s)' : 'direction proxy failed'
      writeJson(res, 502, { ok: false, message })
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const amapWebKey = env.AMAP_WEB_KEY ?? ''
  const inputTipsProxy = createInputTipsProxy(amapWebKey)
  const directionProxy = createDirectionProxy(amapWebKey)

  return {
    plugins: [
      react(),
      {
        name: 'amap-web-proxy',
        configureServer(server) {
          server.middlewares.use('/api/amap/inputtips', inputTipsProxy)
          server.middlewares.use('/api/amap/direction', directionProxy)
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/amap/inputtips', inputTipsProxy)
          server.middlewares.use('/api/amap/direction', directionProxy)
        },
      },
    ],
  }
})

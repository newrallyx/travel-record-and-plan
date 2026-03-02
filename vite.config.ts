import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const upstream = await fetch(targetUrl.toString(), { signal: controller.signal })
      const text = await upstream.text()
      const json = JSON.parse(text) as unknown
      writeJson(res, upstream.status, json)
    } catch (error) {
      const message = (error as Error).name === 'AbortError' ? '高德输入提示请求超时（5s）' : '高德输入提示代理请求失败'
      writeJson(res, 502, { status: '0', info: message, infocode: 'UPSTREAM_ERROR' })
    } finally {
      clearTimeout(timeout)
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const inputTipsProxy = createInputTipsProxy(env.AMAP_WEB_KEY ?? '')

  return {
    plugins: [
      react(),
      {
        name: 'amap-inputtips-proxy',
        configureServer(server) {
          server.middlewares.use('/api/amap/inputtips', inputTipsProxy)
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/amap/inputtips', inputTipsProxy)
        },
      },
    ],
  }
})

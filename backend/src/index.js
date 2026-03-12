import { createApp } from './app.js'
import { loadBackendEnv, resolveAmapWebApiKey } from './env.js'

loadBackendEnv()

const port = Number(process.env.BACKEND_PORT ?? 3001)
const { key: amapWebApiKey, source } = resolveAmapWebApiKey(process.env)

if (!amapWebApiKey) {
  console.warn('[backend] AMAP Web API key not loaded from env (.env/.env.local). Expected: AMAP_WEB_API_KEY, fallback: AMAP_WEB_KEY or AMAP_KEY')
} else {
  console.log(`[backend] AMAP Web API key loaded from ${source}`)
}

const app = createApp({ amapWebApiKey })

app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`)
})

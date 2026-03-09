import dotenv from 'dotenv'
import { createApp } from './app.js'

dotenv.config()

const port = Number(process.env.BACKEND_PORT ?? 3001)
const amapWebApiKey = process.env.AMAP_WEB_API_KEY ?? process.env.AMAP_KEY ?? process.env.AMAP_WEB_KEY ?? ''

const app = createApp({ amapWebApiKey })

app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`)
})

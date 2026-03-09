import express from 'express'
import cors from 'cors'
import { createInputTipsProxyHandler } from './amapInputTipsProxy.js'
import { createDirectionProxyHandler } from './amapDirectionProxy.js'

export function createApp({ amapWebApiKey }) {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  const inputTipsHandler = createInputTipsProxyHandler({ amapKey: amapWebApiKey })
  const directionHandler = createDirectionProxyHandler({ amapWebApiKey })

  app.get('/api/amap/inputtips', inputTipsHandler)
  app.get('/api/amap/direction', directionHandler)

  return app
}

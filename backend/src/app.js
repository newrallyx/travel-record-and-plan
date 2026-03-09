import express from 'express'
import cors from 'cors'
import { createInputTipsProxyHandler } from './amapInputTipsProxy.js'
import { createDirectionProxyHandler } from './amapDirectionProxy.js'
import { createCyclingDirectionProxyHandler } from './amapCyclingDirectionProxy.js'

export function createApp({ amapWebApiKey }) {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  const inputTipsHandler = createInputTipsProxyHandler({ amapKey: amapWebApiKey })
  const directionHandler = createDirectionProxyHandler({ amapWebApiKey })
  const cyclingDirectionHandler = createCyclingDirectionProxyHandler({ amapWebApiKey })

  app.get('/api/amap/inputtips', inputTipsHandler)
  app.get('/api/amap/direction', directionHandler)
  app.get('/api/amap/cycling-direction', cyclingDirectionHandler)

  return app
}

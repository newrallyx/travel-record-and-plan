import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirectionProxyHandler } from '../backend/src/amapDirectionProxy.js'
import { createCyclingDirectionProxyHandler } from '../backend/src/amapCyclingDirectionProxy.js'

function makeReq(url) {
  return { url }
}

function makeRes() {
  const payload = { statusCode: 200, body: null }
  return {
    status(code) {
      payload.statusCode = code
      return this
    },
    json(value) {
      payload.body = value
      return this
    },
    get statusCode() {
      return payload.statusCode
    },
    get jsonPayload() {
      return payload.body
    },
  }
}

async function withMockedFetch(mock, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('driving proxy uses current key and requests detailed polyline data', async () => {
  let upstreamUrl = null
  const handler = createDirectionProxyHandler({ getAmapWebApiKey: () => 'dynamic-key' })

  await withMockedFetch(
    async (url) => {
      upstreamUrl = new URL(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: '1', route: { paths: [] } }),
      }
    },
    async () => {
      const req = makeReq('/api/amap/direction?origin=104.1,30.6&destination=103.0,30.0&strategy=1&waypoints=104.0,30.5|103.5,30.2')
      const res = makeRes()
      await handler(req, res)

      assert.equal(res.statusCode, 200)
      assert.equal(res.jsonPayload.ok, true)
    },
  )

  assert.ok(upstreamUrl)
  assert.equal(upstreamUrl.searchParams.get('key'), 'dynamic-key')
  assert.equal(upstreamUrl.searchParams.get('extensions'), 'all')
  assert.equal(upstreamUrl.searchParams.get('output'), 'json')
  assert.equal(upstreamUrl.searchParams.get('waypoints'), '104.0,30.5;103.5,30.2')
})

test('driving proxy rejects requests when the current key is missing', async () => {
  const handler = createDirectionProxyHandler({ amapWebApiKey: 'old-key', getAmapWebApiKey: () => '' })
  const req = makeReq('/api/amap/direction?origin=104.1,30.6&destination=103.0,30.0')
  const res = makeRes()

  await handler(req, res)

  assert.equal(res.statusCode, 500)
  assert.equal(res.jsonPayload.ok, false)
})

test('cycling proxy also uses the current key', async () => {
  let upstreamUrl = null
  const handler = createCyclingDirectionProxyHandler({ getAmapWebApiKey: () => 'cycle-key' })

  await withMockedFetch(
    async (url) => {
      upstreamUrl = new URL(url)
      return {
        ok: true,
        status: 200,
        json: async () => ({ errcode: 0, data: { paths: [] } }),
      }
    },
    async () => {
      const req = makeReq('/api/amap/cycling-direction?origin=104.1,30.6&destination=103.0,30.0')
      const res = makeRes()
      await handler(req, res)

      assert.equal(res.statusCode, 200)
      assert.equal(res.jsonPayload.ok, true)
    },
  )

  assert.ok(upstreamUrl)
  assert.equal(upstreamUrl.searchParams.get('key'), 'cycle-key')
  assert.equal(upstreamUrl.searchParams.get('output'), 'json')
})
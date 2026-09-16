import assert from 'node:assert/strict'
import test from 'node:test'

import { createRegeoProxyHandler } from '../backend/src/amapRegeoProxy.js'

function makeReq(url) {
  return { url, headers: { 'user-agent': 'test' }, socket: { remoteAddress: '127.0.0.1' } }
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = JSON.stringify(value); this.jsonPayload = value },
    end(value) { this.body = value; this.jsonPayload = JSON.parse(value) },
  }
}

test('reverse geocode proxy forwards a safe coordinate and preserves address evidence', async () => {
  let upstreamUrl
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    upstreamUrl = new URL(url)
    return { ok: true, status: 200, json: async () => ({ status: '1', regeocode: { addressComponent: { province: '陕西省', adcode: '610116' } } }) }
  }
  try {
    const handler = createRegeoProxyHandler({ getAmapWebApiKey: () => 'regeo-key' })
    const response = makeRes()
    await handler(makeReq('/api/amap/regeo?location=108.900000,34.200000'), response)
    assert.equal(response.statusCode, 200)
    assert.equal(upstreamUrl.searchParams.get('location'), '108.900000,34.200000')
    assert.equal(upstreamUrl.searchParams.get('extensions'), 'base')
    assert.equal(response.jsonPayload.ok, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reverse geocode proxy rejects malformed coordinates before upstream access', async () => {
  const handler = createRegeoProxyHandler({ getAmapWebApiKey: () => 'regeo-key' })
  const response = makeRes()
  await handler(makeReq('/api/amap/regeo?location=not-a-coordinate'), response)
  assert.equal(response.statusCode, 400)
})

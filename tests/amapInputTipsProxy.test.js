import test from 'node:test'
import assert from 'node:assert/strict'
import { createInputTipsProxyHandler } from '../server/amapInputTipsProxy.js'

function makeReq(url, headers = {}) {
  return {
    url,
    headers: { 'user-agent': 'node-test', referer: 'http://localhost:5173', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  }
}

function makeRes() {
  const payload = { statusCode: 200, body: '' }
  return {
    setHeader() {},
    end(text) {
      payload.body = text
    },
    get json() {
      return JSON.parse(payload.body || '{}')
    },
    set statusCode(v) {
      payload.statusCode = v
    },
    get statusCode() {
      return payload.statusCode
    },
  }
}

test('keywords length < 2 should return empty and not call upstream', async () => {
  let called = 0
  const handler = createInputTipsProxyHandler({
    amapKey: 'k',
    fetchImpl: async () => {
      called += 1
      throw new Error('should not call')
    },
  })

  const req = makeReq('/api/amap/inputtips?keywords=a')
  const res = makeRes()
  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(called, 0)
  assert.equal(res.json.ok, true)
  assert.deepEqual(res.json.data, [])
})

test('same query should hit cache and only call upstream once', async () => {
  let called = 0
  const handler = createInputTipsProxyHandler({
    amapKey: 'k',
    fetchImpl: async () => {
      called += 1
      return {
        json: async () => ({ tips: [{ name: '天安门', location: '116.1,39.9' }] }),
      }
    },
  })

  const req = makeReq('/api/amap/inputtips?keywords=天安门&city=北京&datatype=all')
  const res1 = makeRes()
  const res2 = makeRes()

  await handler(req, res1)
  await handler(req, res2)

  assert.equal(called, 1)
  assert.equal(res1.json.cached, false)
  assert.equal(res2.json.cached, true)
  assert.equal(res2.json.data.length, 1)
})

test('rate limit should return 429', async () => {
  let now = 0
  const handler = createInputTipsProxyHandler({
    amapKey: 'k',
    rateLimitPerMinute: 1,
    now: () => now,
    fetchImpl: async () => ({ json: async () => ({ tips: [] }) }),
  })

  const req = makeReq('/api/amap/inputtips?keywords=上海')

  const res1 = makeRes()
  await handler(req, res1)
  assert.equal(res1.statusCode, 200)

  const res2 = makeRes()
  await handler(req, res2)
  assert.equal(res2.statusCode, 429)
  assert.equal(res2.json.reason, 'RATE_LIMITED')

  now = 61000
  const res3 = makeRes()
  await handler(req, res3)
  assert.equal(res3.statusCode, 200)
})


test('empty keywords should return INVALID_KEYWORDS', async () => {
  const handler = createInputTipsProxyHandler({
    amapKey: 'k',
    fetchImpl: async () => ({ json: async () => ({ tips: [] }) }),
  })

  const req = makeReq('/api/amap/inputtips?keywords=   ')
  const res = makeRes()
  await handler(req, res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.json.reason, 'INVALID_KEYWORDS')
  assert.match(res.json.message, /keywords/)
})

test('mode=city should not fail on type=city and should return 200', async () => {
  const handler = createInputTipsProxyHandler({
    amapKey: 'k',
    fetchImpl: async () => ({
      json: async () => ({
        tips: [
          { name: '北京', district: '北京市', location: '116.4,39.9' },
          { name: '罗敷收费站', district: '', location: '110.1,34.1' },
        ],
      }),
    }),
  })

  const req = makeReq('/api/amap/inputtips?keywords=罗敷收费站&datatype=all&type=city&mode=city&citylimit=false')
  const res = makeRes()
  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.reason, undefined)
  assert.equal(res.json.data.length, 1)
  assert.equal(res.json.data[0].name, '北京')
})

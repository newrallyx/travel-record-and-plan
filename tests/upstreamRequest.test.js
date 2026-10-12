import test from 'node:test'
import assert from 'node:assert/strict'
import { requestUpstreamJson } from '../backend/src/upstreamRequest.js'

test('shared upstream deadline aborts a slow response body after headers have arrived', async () => {
  let signal
  await assert.rejects(requestUpstreamJson('https://example.invalid', {
    timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      signal = options.signal
      return { json: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }) }
    },
  }), { name: 'AbortError' })
  assert.equal(signal.aborted, true)
})

test('shared request clears its deadline after a completed response', async () => {
  let signal
  const result = await requestUpstreamJson('https://example.invalid', {
    timeoutMs: 10, fetchImpl: async (_url, options) => {
      signal = options.signal
      return { ok: true, json: async () => ({ status: '1' }) }
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(result.data, { status: '1' })
  assert.equal(signal.aborted, false)
})

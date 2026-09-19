import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../backend/src/app.js'

const LOCAL_API_HEADERS = {
  'X-Roadtrip-Client': 'roadtrip-local-app',
}

async function startTestServer(options = {}) {
  const server = createServer(createApp(options))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Test server did not expose a TCP port.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  }
}

test('AMAP key config reports missing, rejects invalid input and accepts a valid key', async (t) => {
  const server = await startTestServer()
  t.after(server.close)

  const initialResponse = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    headers: LOCAL_API_HEADERS,
  })
  assert.equal(initialResponse.status, 200)
  assert.deepEqual(await initialResponse.json(), {
    ok: true,
    configured: false,
    source: null,
  })

  const invalidResponse = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    method: 'POST',
    headers: { ...LOCAL_API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'bad key' }),
  })
  assert.equal(invalidResponse.status, 400)

  const validResponse = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    method: 'POST',
    headers: { ...LOCAL_API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: '1234567890abcdef1234567890abcdef' }),
  })
  assert.equal(validResponse.status, 200)
  assert.deepEqual(await validResponse.json(), {
    ok: true,
    configured: true,
    source: 'local-config',
  })

  const configuredResponse = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    headers: LOCAL_API_HEADERS,
  })
  assert.deepEqual(await configuredResponse.json(), {
    ok: true,
    configured: true,
    source: 'local-config',
  })
})

test('AMAP key updates can be disabled', async (t) => {
  const server = await startTestServer({ allowApiKeySetup: false })
  t.after(server.close)

  const response = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    method: 'POST',
    headers: { ...LOCAL_API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: '1234567890abcdef1234567890abcdef' }),
  })
  assert.equal(response.status, 403)
})

test('AMAP key is persisted to the configured desktop user data path', async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-amap-key-'))
  const configPath = path.join(tempDirectory, 'amap-key.json')
  const server = await startTestServer({ apiKeyConfigPath: configPath })
  t.after(async () => {
    await server.close()
    await rm(tempDirectory, { recursive: true, force: true })
  })

  const key = 'abcdef1234567890abcdef1234567890'
  const response = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    method: 'POST',
    headers: { ...LOCAL_API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    AMAP_WEB_API_KEY: key,
  })
})

test('local API rejects missing client proof and non-allowlisted browser origins', async (t) => {
  const server = await startTestServer()
  t.after(server.close)

  const missingHeaderResponse = await fetch(`${server.baseUrl}/api/config/amap-key`)
  assert.equal(missingHeaderResponse.status, 403)

  const foreignOriginResponse = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    headers: {
      ...LOCAL_API_HEADERS,
      Origin: 'https://malicious.example',
    },
  })
  assert.equal(foreignOriginResponse.status, 403)

  const trustedOriginResponse = await fetch(`${server.baseUrl}/api/config/amap-key`, {
    headers: {
      ...LOCAL_API_HEADERS,
      Origin: 'http://127.0.0.1:5173',
    },
  })
  assert.equal(trustedOriginResponse.status, 200)
})

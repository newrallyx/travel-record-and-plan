import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loadTripReviewWithStatus,
  replaceCorruptTripReviewWithMockData,
  saveTripReview,
  TRIP_STORAGE_KEY,
  TRIP_STORAGE_RECOVERY_KEY,
} from '../src/services/tripStorage.ts'

class MemoryStorage {
  constructor() {
    this.values = new Map()
    this.failWrites = false
  }

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  key(index) {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key) {
    this.values.delete(key)
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('storage quota exceeded')
    this.values.set(key, String(value))
  }
}

function installStorage(t) {
  const storage = new MemoryStorage()
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  t.after(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
    } else {
      delete globalThis.localStorage
    }
  })
  return storage
}

test('corrupted trip JSON is quarantined without overwriting the original value', (t) => {
  const storage = installStorage(t)
  const corruptedRaw = '{"trips":[{"broken":'
  storage.setItem(TRIP_STORAGE_KEY, corruptedRaw)

  const result = loadTripReviewWithStatus()

  assert.equal(result.persistenceBlocked, true)
  assert.equal(result.issue?.kind, 'corrupt-data')
  assert.equal(result.issue?.recoverySaved, true)
  assert.equal(storage.getItem(TRIP_STORAGE_KEY), corruptedRaw)
  assert.equal(storage.getItem(TRIP_STORAGE_RECOVERY_KEY), corruptedRaw)
})

test('corrupted trip JSON is replaced only after an explicit reset', (t) => {
  const storage = installStorage(t)
  const corruptedRaw = 'not-json'
  storage.setItem(TRIP_STORAGE_KEY, corruptedRaw)
  loadTripReviewWithStatus()

  const replacement = replaceCorruptTripReviewWithMockData()

  assert.ok(replacement.trips.length > 0)
  assert.doesNotThrow(() => JSON.parse(storage.getItem(TRIP_STORAGE_KEY)))
  assert.equal(storage.getItem(TRIP_STORAGE_RECOVERY_KEY), corruptedRaw)
})

test('normal save failures are returned to the UI instead of being silently swallowed', (t) => {
  const storage = installStorage(t)
  storage.failWrites = true

  const result = saveTripReview({ trips: [] })

  assert.equal(result.ok, false)
})

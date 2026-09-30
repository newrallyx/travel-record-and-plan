import type { SegmentTrack } from './types'
import type { OverviewLine } from './overviewAggregation'

// Exact content keys avoid stale results after geometry, classification or direction edits.
// Bump this version whenever aggregation semantics change.
const OVERVIEW_CACHE_VERSION = 1
export function overviewCacheKey(tracks: readonly SegmentTrack[]): string {
  return JSON.stringify([OVERVIEW_CACHE_VERSION, [...tracks].sort((a, b) => a.segmentId.localeCompare(b.segmentId))
    .map(({ segmentId, line, roadParts }) => [segmentId, line, roadParts])])
}

export function createOverviewCache(capacity = 3) {
  const entries = new Map<string, OverviewLine[]>()
  return {
    get(key: string) {
      const value = entries.get(key)
      if (value) { entries.delete(key); entries.set(key, value) }
      return value
    },
    set(key: string, lines: OverviewLine[]) {
      entries.delete(key)
      entries.set(key, lines)
      while (entries.size > capacity) entries.delete(entries.keys().next().value!)
    },
  }
}

export const overviewCache = createOverviewCache()

async function persistentKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

// Derived data has its own database; failures must never prevent the map from loading.
export function createPersistentOverviewCache(factory: IDBFactory | undefined = globalThis.indexedDB) {
  async function open() {
    if (!factory) return undefined
    return new Promise<IDBDatabase | undefined>((resolve) => {
      let blocked = false
      const request = factory.open('trip-overview-cache', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('results', { keyPath: 'key' }).createIndex('savedAt', 'savedAt')
      }
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return }
        resolve(request.result)
      }
      request.onerror = () => resolve(undefined)
      request.onblocked = () => { blocked = true; resolve(undefined) }
    })
  }
  return {
    async get(key: string): Promise<OverviewLine[] | undefined> {
      let db: IDBDatabase | undefined
      try {
        const storageKey = await persistentKey(key)
        db = await open()
        if (!db) return undefined
        return await new Promise<OverviewLine[] | undefined>((resolve) => {
          const tx = db!.transaction('results', 'readonly')
          const request = tx.objectStore('results').get(storageKey)
          tx.oncomplete = () => resolve(request.result?.lines)
          tx.onabort = tx.onerror = () => resolve(undefined)
        })
      } catch { return undefined } finally { db?.close() }
    },
    async set(key: string, lines: OverviewLine[]): Promise<void> {
      let db: IDBDatabase | undefined
      try {
        const storageKey = await persistentKey(key)
        db = await open()
        if (!db) return
        await new Promise<void>((resolve) => {
          const tx = db!.transaction('results', 'readwrite')
          const store = tx.objectStore('results')
          store.put({ key: storageKey, lines, savedAt: Date.now() })
          // Key-only eviction avoids deserializing every saved overview.
          const request = store.index('savedAt').openKeyCursor(null, 'prev')
          let count = 0
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) return
            if (++count > 3) store.delete(cursor.primaryKey)
            cursor.continue()
          }
          tx.oncomplete = () => resolve()
          tx.onabort = tx.onerror = () => resolve()
        })
      } catch { /* A full or unavailable cache is safe to recompute next time. */ } finally { db?.close() }
    },
  }
}

export const persistentOverviewCache = createPersistentOverviewCache()

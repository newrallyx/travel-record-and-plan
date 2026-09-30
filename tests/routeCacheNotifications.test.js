import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { subscribeRouteCacheChanges, savePlannedSegmentRouteCache, saveManualSegmentRouteCache,
  getSegmentRouteCache, deleteSegmentRouteCache, clearAllRouteCache, replaceAllSegmentRouteCache,
} from '../src/services/routeCacheDb.ts'

test('cache change notifications follow committed writes, never reads, and unsubscribe', async () => {
  globalThis.indexedDB = new IDBFactory()
  let changes = 0
  const unsubscribe = subscribeRouteCacheChanges(() => { changes++ })
  const record = { segmentId: 'test', routeBuildKey: 'key', points: [{ lat: 34, lon: 109 }, { lat: 35, lon: 110 }] }
  try {
    await savePlannedSegmentRouteCache(record)
    assert.equal(changes, 1)
    assert.equal((await getSegmentRouteCache('test')).segmentId, 'test')
    assert.equal(changes, 1)
    await saveManualSegmentRouteCache(record)
    assert.equal(changes, 2)
    await deleteSegmentRouteCache('test')
    assert.equal(changes, 3)
    await replaceAllSegmentRouteCache([record])
    assert.equal(changes, 4)
    await clearAllRouteCache()
    assert.equal(changes, 5)
    unsubscribe()
    await savePlannedSegmentRouteCache(record)
    assert.equal(changes, 5)
  } finally { unsubscribe(); delete globalThis.indexedDB }
})

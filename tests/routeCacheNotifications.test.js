import test from 'node:test'
import assert from 'node:assert/strict'
import { createTripBackupExport } from '../src/services/tripBackup.ts'
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

test('failed route persistence rejects and a full backup refuses to export failed reads as empty data', async () => {
  const previous = globalThis.indexedDB
  globalThis.indexedDB = { open() { throw new Error('storage unavailable') } }
  const record = { segmentId: 'failed', routeBuildKey: 'key', points: [{ lat: 34, lon: 109 }] }
  try {
    await assert.rejects(savePlannedSegmentRouteCache(record), /storage unavailable/)
    await assert.rejects(saveManualSegmentRouteCache(record), /storage unavailable/)
    await assert.rejects(createTripBackupExport({ trips: [] }), /storage unavailable/)
  } finally { globalThis.indexedDB = previous }
})

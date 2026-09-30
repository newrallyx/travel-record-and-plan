import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterPhotoMarkers, getPhotoClusterCellSize } from '../src/utils/photoMarkerClusters.ts'

function createPhoto(id, lat, lon) {
  return {
    id,
    segmentId: 'segment-1',
    storageMode: 'linked',
    libraryRootId: 'root-1',
    relativePath: `${id}.jpg`,
    originalFilename: `${id}.jpg`,
    importedAt: '',
    updatedAt: '',
    fingerprint: { size: 1, modifiedAt: 1 },
    mapPosition: { lat, lon, coordinateSystem: 'GCJ02', source: 'manual', manuallyAdjusted: true },
  }
}

test('photo marker clustering groups nearby photos and preserves distant photos', () => {
  const clusters = clusterPhotoMarkers([
    createPhoto('one', 30.5700, 104.0600),
    createPhoto('two', 30.5701, 104.0601),
    createPhoto('far', 31.2304, 121.4737),
  ], 10)

  assert.equal(clusters.length, 2)
  assert.deepEqual(clusters.map((cluster) => cluster.photos.length).sort(), [1, 2])
})

test('photo marker clustering separates nearby photos at high zoom and ignores missing positions', () => {
  const missing = { ...createPhoto('missing', 0, 0), mapPosition: undefined }
  const clusters = clusterPhotoMarkers([
    createPhoto('one', 30.5700, 104.0600),
    createPhoto('two', 30.5800, 104.0700),
    missing,
  ], 18)

  assert.equal(clusters.length, 2)
  assert.ok(getPhotoClusterCellSize(18) < getPhotoClusterCellSize(10))
})

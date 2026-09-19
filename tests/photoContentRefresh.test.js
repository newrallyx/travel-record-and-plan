import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshLinkedPhotoContent } from '../src/services/photoContentRefresh.ts'

function createPhoto(overrides = {}) {
  return {
    id: 'photo-1',
    segmentId: 'segment-1',
    storageMode: 'linked',
    libraryRootId: 'root-1',
    relativePath: 'old/photo.jpg',
    originalFilename: 'photo.jpg',
    importedAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    fingerprint: { size: 3, modifiedAt: 1 },
    ...overrides,
  }
}

function createApi(onRefresh) {
  return {
    async readPhoto(rootId, relativePath) {
      assert.equal(rootId, 'root-1')
      assert.equal(relativePath, 'moved/photo.jpg')
      return {
        data: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'image/jpeg',
        size: 4,
        modifiedAt: 200,
      }
    },
    async refreshPhotoContent(payload) {
      onRefresh(payload)
      return { ...createPhoto(), ...payload, fingerprint: payload.expectedFingerprint }
    },
  }
}

test('changed or moved photo refresh rebuilds metadata and thumbnail while preserving a manual map position', async () => {
  let committedPayload = null
  const manualPosition = {
    lat: 30.5,
    lon: 104.1,
    coordinateSystem: 'GCJ02',
    source: 'manual',
    manuallyAdjusted: true,
  }
  const updated = await refreshLinkedPhotoContent({
    api: createApi((payload) => { committedPayload = payload }),
    photo: createPhoto({ mapPosition: manualPosition }),
    relativePath: 'moved/photo.jpg',
    exifExtractor: async () => ({
      metadata: {
        capturedAt: '2026-07-12T08:00:00',
        orientation: 6,
        originalGps: { lat: 30.6, lon: 104.2 },
      },
    }),
    thumbnailGenerator: async () => ({ blob: new Blob(['thumb']), mimeType: 'image/webp' }),
    now: () => new Date('2026-07-12T09:00:00.000Z'),
  })

  assert.equal(committedPayload.relativePath, 'moved/photo.jpg')
  assert.deepEqual(committedPayload.expectedFingerprint, { size: 4, modifiedAt: 200 })
  assert.deepEqual(committedPayload.mapPosition, manualPosition)
  assert.equal(committedPayload.thumbnailCacheVersion, 2)
  assert.equal(committedPayload.thumbnailData.byteLength, 5)
  assert.equal(updated.relativePath, 'moved/photo.jpg')
})

test('photo refresh does not commit anything when EXIF or thumbnail preparation fails', async () => {
  let commitCount = 0
  await assert.rejects(refreshLinkedPhotoContent({
    api: createApi(() => { commitCount += 1 }),
    photo: createPhoto(),
    relativePath: 'moved/photo.jpg',
    exifExtractor: async () => ({ metadata: {}, warning: 'damaged EXIF' }),
  }), /damaged EXIF/)
  assert.equal(commitCount, 0)
})

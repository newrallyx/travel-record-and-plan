import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { commitPhotoContentRefresh } from '../electron/photoContentStore.mjs'
import { PhotoThumbnailCache } from '../electron/photoThumbnailCache.mjs'

function createWebp(payload) {
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from(payload),
  ])
}

function createPhoto() {
  return {
    id: 'photo-1',
    segmentId: 'segment-1',
    storageMode: 'linked',
    libraryRootId: 'root-1',
    relativePath: 'old.jpg',
    originalFilename: 'old.jpg',
    importedAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    fingerprint: { size: 10, modifiedAt: 10 },
    thumbnailCacheKey: 'photo-1.webp',
    thumbnailCacheVersion: 2,
  }
}

test('photo content commit restores the previous thumbnail when metadata persistence fails', async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-photo-refresh-'))
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))
  const cache = new PhotoThumbnailCache(path.join(tempDirectory, 'thumbnails'))
  const oldThumbnail = createWebp([1])
  const newThumbnail = createWebp([2])
  await cache.save('photo-1', oldThumbnail)

  await assert.rejects(commitPhotoContentRefresh({
    photo: createPhoto(),
    inspected: {
      photoPath: path.join(tempDirectory, 'moved.jpg'),
      mimeType: 'image/jpeg',
      size: 20,
      modifiedAt: 20,
    },
    payload: {
      relativePath: 'moved.jpg',
      expectedFingerprint: { size: 20, modifiedAt: 20 },
      metadataReadAt: '2026-07-12T01:00:00.000Z',
      thumbnailData: newThumbnail,
      thumbnailMimeType: 'image/webp',
      thumbnailCacheVersion: 2,
    },
    metadataStore: {
      async savePhoto() {
        throw new Error('metadata write failed')
      },
    },
    thumbnailCache: cache,
  }), /metadata write failed/)

  assert.deepEqual(await cache.read('photo-1'), oldThumbnail)
})

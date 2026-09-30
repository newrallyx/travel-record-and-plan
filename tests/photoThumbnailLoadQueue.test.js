import test from 'node:test'
import assert from 'node:assert/strict'
import { createAsyncTaskLimiter } from '../src/utils/asyncTaskLimiter.ts'
import { PHOTO_THUMBNAIL_CACHE_VERSION } from '../src/services/photoThumbnail.ts'
import { readOrRegenerateThumbnail } from '../src/services/photoThumbnailLoadQueue.ts'

test('async task limiter caps concurrent work and continues after rejection', async () => {
  const limit = createAsyncTaskLimiter(2)
  let active = 0
  let peak = 0
  const tasks = Array.from({ length: 6 }, (_, index) => limit(async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    if (index === 2) throw new Error('expected')
    return index
  }))

  const results = await Promise.allSettled(tasks)
  assert.equal(peak, 2)
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 5)
  assert.equal(results[2].status, 'rejected')
})

test('async task limiter rejects invalid concurrency', () => {
  assert.throws(() => createAsyncTaskLimiter(0), /positive integer/)
  assert.throws(() => createAsyncTaskLimiter(1.5), /positive integer/)
})

test('current thumbnail metadata rebuilds the cache when its file is missing', async () => {
  const savedPhotos = []
  const generatedThumbnail = { blob: new Blob(['thumbnail'], { type: 'image/webp' }), mimeType: 'image/webp' }
  const photo = {
    id: 'photo-1',
    segmentId: 'segment-1',
    storageMode: 'linked',
    libraryRootId: 'root-1',
    relativePath: 'photo.jpg',
    originalFilename: 'photo.jpg',
    importedAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    fingerprint: { size: 1, modifiedAt: 1 },
    thumbnailCacheKey: 'photo-1.webp',
    thumbnailCacheVersion: PHOTO_THUMBNAIL_CACHE_VERSION,
  }
  const result = await readOrRegenerateThumbnail('photo-1', {
    repository: {
      async getPhoto() { return photo },
      async readThumbnail() { return null },
      async readOriginal() { return { blob: new Blob(['original']), mimeType: 'image/jpeg' } },
      async saveThumbnail() { return 'photo-1.webp' },
      async savePhoto(nextPhoto) { savedPhotos.push(nextPhoto) },
    },
    thumbnailGenerator: async () => generatedThumbnail,
    now: () => new Date('2026-07-16T01:00:00.000Z'),
  })

  assert.equal(result, generatedThumbnail)
  assert.equal(savedPhotos.length, 1)
  assert.equal(savedPhotos[0].thumbnailCacheVersion, PHOTO_THUMBNAIL_CACHE_VERSION)
  assert.equal(savedPhotos[0].updatedAt, '2026-07-16T01:00:00.000Z')
})

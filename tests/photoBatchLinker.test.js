import test from 'node:test'
import assert from 'node:assert/strict'
import { linkPhotosToReviewSegment } from '../src/services/photoBatchLinker.ts'

function createTripReview() {
  return {
    trips: [{
      id: 'trip-1',
      title: 'Trip',
      category: 'review',
      startDate: '2026-07-11',
      endDate: '2026-07-11',
      days: [{
        id: 'day-1',
        date: '2026-07-11',
        routeSegments: [{
          id: 'segment-1',
          name: 'Segment',
          startPoint: 'A',
          endPoint: 'B',
          preference: 'HIGHWAY_FIRST',
        }],
      }],
    }],
  }
}

function createFiles() {
  return ['one.jpg', 'broken.jpg', 'three.jpg'].map((relativePath, index) => ({
    relativePath,
    originalFilename: relativePath,
    mimeType: 'image/jpeg',
    fingerprint: { size: index + 1, modifiedAt: 100 + index },
  }))
}

function createRepository() {
  const photos = new Map()
  const thumbnails = new Map()
  const deleted = []
  let batchWriteCount = 0
  return {
    photos,
    thumbnails,
    deleted,
    get batchWriteCount() { return batchWriteCount },
    async savePhoto(photo) { photos.set(photo.id, photo) },
    async savePhotos(nextPhotos) {
      batchWriteCount += 1
      for (const photo of nextPhotos) photos.set(photo.id, photo)
    },
    async getPhoto(photoId) { return photos.get(photoId) ?? null },
    async readOriginal(photoId) { return { blob: new Blob([photoId]), mimeType: 'image/jpeg' } },
    async readLibraryPhoto(_rootId, relativePath) {
      return { blob: new Blob([relativePath]), mimeType: 'image/jpeg' }
    },
    async saveThumbnail(photoId, thumbnail) { thumbnails.set(photoId, thumbnail); return `${photoId}.webp` },
    async deleteThumbnail(photoId) { thumbnails.delete(photoId); deleted.push(photoId) },
    async deletePhoto(photoId) { photos.delete(photoId); thumbnails.delete(photoId); deleted.push(photoId) },
  }
}

test('batch linker isolates a broken photo and persists successful metadata in one batch', async () => {
  const repository = createRepository()
  const ids = ['photo-1', 'photo-2', 'photo-3']
  const progress = []
  const result = await linkPhotosToReviewSegment({
    repository,
    tripReview: createTripReview(),
    segmentId: 'segment-1',
    libraryRootId: 'root-1',
    files: createFiles(),
    createPhotoId: () => ids.shift(),
    now: () => new Date('2026-07-11T00:00:00.000Z'),
    thumbnailGenerator: async (blob) => {
      if (await blob.text() === 'broken.jpg') throw new Error('decode failed')
      return { blob: new Blob(['thumbnail'], { type: 'image/webp' }), mimeType: 'image/webp' }
    },
    exifExtractor: async () => ({
      metadata: {
        capturedAt: '2026-07-11T08:30:15.000Z',
        orientation: 6,
        originalGps: { lat: 30.5728, lon: 104.0668 },
      },
    }),
    onProgress: (item) => progress.push(item),
  })

  assert.deepEqual(result.successes.map((item) => item.photoId), ['photo-1', 'photo-3'])
  assert.deepEqual(result.failures.map((item) => item.error), ['decode failed'])
  assert.deepEqual(repository.deleted, [])
  assert.equal(repository.batchWriteCount, 1)
  assert.deepEqual([...repository.photos.keys()], ['photo-1', 'photo-3'])
  assert.equal(repository.photos.get('photo-1').orientation, 6)
  assert.equal(repository.photos.get('photo-1').thumbnailCacheVersion, 2)
  assert.equal(repository.photos.get('photo-1').thumbnailCacheKey, 'photo-1.webp')
  assert.deepEqual(repository.photos.get('photo-3').originalGps, { lat: 30.5728, lon: 104.0668 })
  assert.equal(repository.photos.get('photo-1').mapPosition.coordinateSystem, 'GCJ02')
  assert.equal(repository.photos.get('photo-1').mapPosition.source, 'exif')
  assert.notEqual(repository.photos.get('photo-1').mapPosition.lon, 104.0668)
  assert.deepEqual(result.tripReview.trips[0].days[0].routeSegments[0].photoIds, ['photo-1', 'photo-3'])
  assert.equal(progress.at(-1).completed, 3)
  assert.equal(progress.at(-1).succeeded, 2)
  assert.equal(progress.at(-1).failed, 1)
})

test('batch linker stops before the next photo when cancelled', async () => {
  const repository = createRepository()
  const controller = new AbortController()
  let id = 0
  const result = await linkPhotosToReviewSegment({
    repository,
    tripReview: createTripReview(),
    segmentId: 'segment-1',
    libraryRootId: 'root-1',
    files: createFiles(),
    signal: controller.signal,
    createPhotoId: () => `photo-${++id}`,
    thumbnailGenerator: async () => ({
      blob: new Blob(['thumbnail'], { type: 'image/webp' }),
      mimeType: 'image/webp',
    }),
    exifExtractor: async () => ({ metadata: {} }),
    onProgress: (progress) => {
      if (progress.status === 'succeeded') controller.abort()
    },
  })

  assert.equal(result.cancelled, true)
  assert.deepEqual(result.successes.map((item) => item.photoId), ['photo-1'])
  assert.deepEqual([...repository.photos.keys()], ['photo-1'])
  assert.equal(repository.batchWriteCount, 1)
})

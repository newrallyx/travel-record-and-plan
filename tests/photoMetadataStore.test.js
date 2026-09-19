import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PhotoMetadataStore, normalizeLinkedPhotoRecord } from '../electron/photoMetadataStore.mjs'

async function createStoreFixture(t) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-photo-metadata-'))
  const filePath = path.join(tempDirectory, 'photo-library.json')
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))
  return { filePath, store: new PhotoMetadataStore(filePath) }
}

function createRoot(rootPath) {
  return {
    id: 'root-1',
    tripId: 'trip-1',
    name: 'Road trip photos',
    path: rootPath,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  }
}

test('photo library roots persist their owning trip and still read legacy roots', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  const root = createRoot(path.join(path.dirname(filePath), 'photos'))
  await store.saveRoot(root)
  assert.equal((await store.getRoot(root.id)).tripId, 'trip-1')

  const legacyRoot = { ...root, id: 'legacy-root', path: path.join(path.dirname(filePath), 'legacy') }
  delete legacyRoot.tripId
  await store.saveRoot(legacyRoot)
  assert.equal((await store.getRoot(legacyRoot.id)).tripId, undefined)
})

function createPhoto(overrides = {}) {
  return {
    id: 'photo-1',
    segmentId: 'segment-1',
    storageMode: 'linked',
    libraryRootId: 'root-1',
    relativePath: path.join('day-1', 'photo.jpg'),
    originalFilename: 'photo.jpg',
    mimeType: 'image/jpeg',
    importedAt: '2026-07-11T00:01:00.000Z',
    updatedAt: '2026-07-11T00:01:00.000Z',
    fingerprint: { size: 1024, modifiedAt: 123456 },
    ...overrides,
  }
}

test('photo metadata persists roots and linked photos across store instances', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  const root = createRoot(path.join(path.dirname(filePath), 'photos'))
  await store.saveRoot(root)
  await store.savePhoto(createPhoto())

  const reopenedStore = new PhotoMetadataStore(filePath)
  assert.deepEqual(await reopenedStore.listRoots(), [root])
  assert.deepEqual(await reopenedStore.listPhotosBySegment('segment-1'), [normalizeLinkedPhotoRecord(createPhoto())])

  const persisted = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(persisted.schema, 'roadtrip-photo-library')
  assert.equal(persisted.version, 1)
})

test('photo metadata persists the thumbnail generator cache version', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))
  await store.savePhoto(createPhoto({
    thumbnailCacheKey: 'photo-1.webp',
    thumbnailCacheVersion: 2,
  }))

  const reopenedStore = new PhotoMetadataStore(filePath)
  const photo = await reopenedStore.getPhoto('photo-1')
  assert.equal(photo.thumbnailCacheKey, 'photo-1.webp')
  assert.equal(photo.thumbnailCacheVersion, 2)
})

test('photo metadata rejects unknown roots and prevents referenced roots from being deleted', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await assert.rejects(store.savePhoto(createPhoto()), /unknown photo library root/)

  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))
  await store.savePhoto(createPhoto())
  await assert.rejects(store.deleteRoot('root-1'), /photos still reference it/)

  await store.deletePhoto('photo-1')
  await store.deleteRoot('root-1')
  assert.deepEqual(await store.listRoots(), [])
})

test('photo metadata batch deletion is atomic and reports existing ids only', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))
  await store.savePhoto(createPhoto())
  await store.savePhoto(createPhoto({
    id: 'photo-2',
    relativePath: path.join('day-1', 'photo-2.jpg'),
    originalFilename: 'photo-2.jpg',
  }))

  assert.deepEqual(await store.deletePhotos(['photo-1', 'missing']), ['photo-1'])
  assert.equal(await store.getPhoto('photo-1'), null)
  assert.equal((await store.getPhoto('photo-2')).id, 'photo-2')
  await assert.rejects(store.deletePhotos(['photo-2', '']), /non-empty string/)
  assert.equal((await store.getPhoto('photo-2')).id, 'photo-2')
})

test('photo metadata batch save commits all records atomically', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))
  const photos = [
    createPhoto(),
    createPhoto({
      id: 'photo-2',
      relativePath: path.join('day-1', 'photo-2.jpg'),
      originalFilename: 'photo-2.jpg',
    }),
  ]

  await store.savePhotos(photos)
  assert.deepEqual((await store.listPhotos()).map((photo) => photo.id), ['photo-1', 'photo-2'])

  await assert.rejects(store.savePhotos([
    { ...photos[0], note: 'must not persist' },
    { ...photos[1], id: 'photo-3', relativePath: photos[0].relativePath },
  ]), /already linked/)
  assert.equal((await store.getPhoto('photo-1')).note, undefined)
})

test('deleting trip photo data removes owned roots and linked segment records in one commit', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'trip-1-photos')))
  await store.saveRoot({
    ...createRoot(path.join(path.dirname(filePath), 'trip-2-photos')),
    id: 'root-2',
    tripId: 'trip-2',
  })
  await store.savePhotos([
    createPhoto(),
    createPhoto({
      id: 'photo-moved-in-legacy-data',
      segmentId: 'segment-trip-2',
      relativePath: path.join('day-1', 'moved.jpg'),
      originalFilename: 'moved.jpg',
    }),
    createPhoto({
      id: 'photo-linked-from-other-root',
      segmentId: 'segment-1',
      libraryRootId: 'root-2',
      relativePath: path.join('day-1', 'linked.jpg'),
      originalFilename: 'linked.jpg',
    }),
    createPhoto({
      id: 'photo-keep',
      segmentId: 'segment-trip-2',
      libraryRootId: 'root-2',
      relativePath: path.join('day-1', 'keep.jpg'),
      originalFilename: 'keep.jpg',
    }),
  ])

  const result = await store.deleteTripData('trip-1', ['segment-1'])
  assert.deepEqual(result.deletedRootIds, ['root-1'])
  assert.deepEqual(new Set(result.deletedPhotoIds), new Set([
    'photo-1',
    'photo-moved-in-legacy-data',
    'photo-linked-from-other-root',
  ]))
  assert.deepEqual((await store.listRoots()).map((root) => root.id), ['root-2'])
  assert.deepEqual((await store.listPhotos()).map((photo) => photo.id), ['photo-keep'])
})

test('photo metadata rejects paths that escape the linked library root', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))

  await assert.rejects(store.savePhoto(createPhoto({ relativePath: path.join('..', 'outside.jpg') })), /stay inside/)
  await assert.rejects(store.savePhoto(createPhoto({ relativePath: path.resolve('outside.jpg') })), /stay inside/)
})

test('corrupt metadata is rejected and is not silently overwritten', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  const corruptContent = '{ definitely not valid json'
  await writeFile(filePath, corruptContent, 'utf8')

  await assert.rejects(store.listRoots(), SyntaxError)
  await assert.rejects(
    store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos'))),
    SyntaxError,
  )
  assert.equal(await readFile(filePath, 'utf8'), corruptContent)
})

test('relinking a library root preserves its id and all linked photo records', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  const originalPath = path.join(path.dirname(filePath), 'old-photos')
  const relocatedPath = path.join(path.dirname(filePath), 'new-photos')
  await store.saveRoot(createRoot(originalPath))
  await store.savePhoto(createPhoto())

  const updatedRoot = await store.relinkRoot('root-1', relocatedPath, '2026-07-11T02:00:00.000Z')
  assert.equal(updatedRoot.id, 'root-1')
  assert.equal(updatedRoot.path, relocatedPath)
  assert.equal((await store.getPhoto('photo-1')).libraryRootId, 'root-1')
})

test('the same local source photo cannot be indexed twice', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))
  await store.savePhoto(createPhoto())

  await assert.rejects(
    store.savePhoto(createPhoto({ id: 'photo-2', segmentId: 'segment-2' })),
    /already linked/,
  )
})

test('photo map position persists its coordinate system and source', async (t) => {
  const { filePath, store } = await createStoreFixture(t)
  await store.saveRoot(createRoot(path.join(path.dirname(filePath), 'photos')))
  await store.savePhoto(createPhoto({
    originalGps: { lat: 30.5728, lon: 104.0668 },
    mapPosition: {
      lat: 30.570346141080414,
      lon: 104.06930547724922,
      coordinateSystem: 'GCJ02',
      source: 'exif',
      manuallyAdjusted: false,
    },
  }))

  const reopened = new PhotoMetadataStore(filePath)
  assert.equal((await reopened.getPhoto('photo-1')).mapPosition.coordinateSystem, 'GCJ02')
  assert.equal((await reopened.getPhoto('photo-1')).mapPosition.source, 'exif')
})

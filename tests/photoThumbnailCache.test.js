import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PhotoThumbnailCache } from '../electron/photoThumbnailCache.mjs'

function createWebp(payload = [1, 2, 3]) {
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from(payload),
  ])
}

test('thumbnail cache saves, replaces, reads and deletes WebP thumbnails', async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-thumbnail-cache-'))
  const cache = new PhotoThumbnailCache(tempDirectory)
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))

  assert.equal(await cache.save('photo-1', createWebp([1])), 'photo-1.webp')
  assert.deepEqual(await cache.read('photo-1'), createWebp([1]))
  await cache.save('photo-1', createWebp([2, 3]))
  assert.deepEqual(await cache.read('photo-1'), createWebp([2, 3]))
  await cache.delete('photo-1')
  assert.equal(await cache.read('photo-1'), null)
})

test('thumbnail cache rejects unsafe ids and non-WebP data', async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-thumbnail-cache-'))
  const cache = new PhotoThumbnailCache(tempDirectory)
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))

  await assert.rejects(cache.save('../outside', createWebp()), /unsupported characters/)
  await assert.rejects(cache.save('photo-1', Buffer.from('not webp')), /encoded as WebP/)
})

test('thumbnail cleanup removes cache entries without metadata and keeps referenced entries', async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-thumbnail-cache-'))
  const cache = new PhotoThumbnailCache(tempDirectory)
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))

  await cache.save('photo-keep', createWebp([1]))
  await cache.save('photo-orphan', createWebp([2]))
  const result = await cache.cleanup(['photo-keep'])

  assert.deepEqual(result.deletedThumbnailIds, ['photo-orphan'])
  assert.equal(result.deletedTempFileCount, 0)
  assert.deepEqual(await cache.read('photo-keep'), createWebp([1]))
  assert.equal(await cache.read('photo-orphan'), null)
})

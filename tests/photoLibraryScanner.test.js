import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { reconcilePhotoLibraryScan, scanPhotoLibraryRoot } from '../electron/photoLibraryScanner.mjs'

async function createScannerFixture(t) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-photo-scan-'))
  const rootPath = path.join(tempDirectory, 'library')
  const nestedPath = path.join(rootPath, 'day-1')
  await mkdir(nestedPath, { recursive: true })
  await writeFile(path.join(nestedPath, 'one.jpg'), Buffer.from([1, 2, 3]))
  await writeFile(path.join(rootPath, 'two.PNG'), Buffer.from([4, 5]))
  await writeFile(path.join(rootPath, 'ignored.txt'), 'not a photo')
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))
  return { tempDirectory, rootPath, nestedPath }
}

test('photo library scanner recursively lists supported files without copying them', async (t) => {
  const { rootPath } = await createScannerFixture(t)
  const result = await scanPhotoLibraryRoot(rootPath)

  assert.equal(result.status, 'available')
  assert.deepEqual(result.files.map((file) => file.relativePath), [
    path.join('day-1', 'one.jpg'),
    'two.PNG',
  ])
  assert.deepEqual(result.files.map((file) => file.mimeType), ['image/jpeg', 'image/png'])
})

test('photo library scanner reports an unavailable root without marking indexed photos missing', async (t) => {
  const { tempDirectory } = await createScannerFixture(t)
  const result = await scanPhotoLibraryRoot(path.join(tempDirectory, 'not-connected'))

  assert.equal(result.status, 'root-unavailable')
  assert.deepEqual(result.files, [])
  assert.equal(result.issues.length, 1)
})

test('photo library reconciliation separates unchanged, changed, missing and new files', () => {
  const indexedPhotos = [
    { id: 'same', relativePath: 'same.jpg', fingerprint: { size: 10, modifiedAt: 100 } },
    { id: 'changed', relativePath: 'changed.jpg', fingerprint: { size: 20, modifiedAt: 200 } },
    { id: 'moved', relativePath: 'old/moved.jpg', fingerprint: { size: 30, modifiedAt: 300 } },
    { id: 'missing', relativePath: 'missing.jpg', fingerprint: { size: 40, modifiedAt: 400 } },
  ]
  const scannedFiles = [
    { relativePath: 'same.jpg', fingerprint: { size: 10, modifiedAt: 100 } },
    { relativePath: 'changed.jpg', fingerprint: { size: 21, modifiedAt: 201 } },
    { relativePath: 'new/moved.jpg', fingerprint: { size: 30, modifiedAt: 300 } },
    { relativePath: 'brand-new.jpg', fingerprint: { size: 50, modifiedAt: 500 } },
  ]
  const result = reconcilePhotoLibraryScan(indexedPhotos, scannedFiles)

  assert.deepEqual(result.unchangedPhotoIds, ['same'])
  assert.deepEqual(result.changed.map((item) => item.photoId), ['changed'])
  assert.deepEqual(result.missing.map((item) => item.photoId), ['moved', 'missing'])
  assert.deepEqual(result.newFiles.map((item) => item.relativePath), ['new/moved.jpg', 'brand-new.jpg'])
  assert.deepEqual(result.relocationCandidates, [{
    photoId: 'moved',
    candidates: [scannedFiles[2]],
  }])
})

test('photo library scanner skips symbolic links and directory junctions', async (t) => {
  const { tempDirectory, rootPath } = await createScannerFixture(t)
  const outsidePath = path.join(tempDirectory, 'outside.jpg')
  const linkPath = path.join(rootPath, 'linked.jpg')
  await writeFile(outsidePath, Buffer.from([9]))

  try {
    await symlink(outsidePath, linkPath, 'file')
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating symbolic links is not permitted in this Windows environment.')
      return
    }
    throw error
  }

  const result = await scanPhotoLibraryRoot(rootPath)
  assert.equal(result.files.some((file) => file.relativePath === 'linked.jpg'), false)
  assert.equal(result.issues.some((issue) => issue.code === 'SYMLINK_SKIPPED'), true)
})

test('photo library scan reports progress and explains that HEIC needs conversion', async (t) => {
  const { tempDirectory, rootPath } = await createScannerFixture(t)
  await writeFile(path.join(rootPath, 'iphone.heic'), 'heic')
  const progress = []
  const result = await scanPhotoLibraryRoot(rootPath, { onProgress: (item) => progress.push(item) })
  assert.ok(progress.length > 0)
  assert.equal(progress.at(-1).discoveredPhotos, result.files.length)
  assert.equal(result.issues.some((issue) => (
    issue.relativePath === 'iphone.heic' && issue.code === 'PHOTO_CONVERSION_REQUIRED'
  )), true)
  assert.ok(result.durationMs >= 0)
  assert.ok(tempDirectory)
})

test('photo library scan can be cancelled before walking a large tree', async (t) => {
  const { rootPath } = await createScannerFixture(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(scanPhotoLibraryRoot(rootPath, { signal: controller.signal }), (error) => (
    error instanceof Error && error.name === 'AbortError'
  ))
})

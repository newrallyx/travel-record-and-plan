import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getSupportedPhotoMimeType,
  isTrustedDesktopUrl,
  readAuthorizedPhoto,
  resolveAuthorizedPhotoPath,
} from '../electron/photoLibraryAccess.mjs'

async function createPhotoLibraryFixture(t) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-photo-library-'))
  const rootPath = path.join(tempDirectory, 'library')
  const nestedPath = path.join(rootPath, 'trip')
  const outsidePath = path.join(tempDirectory, 'outside.jpg')
  await mkdir(nestedPath, { recursive: true })
  await writeFile(path.join(nestedPath, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  await writeFile(outsidePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  t.after(() => rm(tempDirectory, { recursive: true, force: true }))
  return { rootPath, nestedPath, outsidePath }
}

test('authorized photo reader accepts supported images inside the selected library', async (t) => {
  const { rootPath } = await createPhotoLibraryFixture(t)
  const result = await readAuthorizedPhoto(rootPath, path.join('trip', 'photo.jpg'))

  assert.equal(result.mimeType, 'image/jpeg')
  assert.equal(result.size, 4)
  assert.deepEqual(result.data, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
})

test('authorized photo resolver rejects traversal and absolute paths', async (t) => {
  const { rootPath, outsidePath } = await createPhotoLibraryFixture(t)

  await assert.rejects(resolveAuthorizedPhotoPath(rootPath, path.join('..', 'outside.jpg')), /outside the authorized/)
  await assert.rejects(resolveAuthorizedPhotoPath(rootPath, outsidePath), /relative path/)
})

test('authorized photo resolver rejects links that escape the selected library', async (t) => {
  const { rootPath, nestedPath, outsidePath } = await createPhotoLibraryFixture(t)
  const linkPath = path.join(nestedPath, 'linked-outside.jpg')

  try {
    await symlink(outsidePath, linkPath, 'file')
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating symbolic links is not permitted in this Windows environment.')
      return
    }
    throw error
  }

  await assert.rejects(
    resolveAuthorizedPhotoPath(rootPath, path.join('trip', 'linked-outside.jpg')),
    /resolves outside the authorized/,
  )
})

test('photo MIME type allowlist is extension based and intentionally narrow', () => {
  assert.equal(getSupportedPhotoMimeType('photo.JPEG'), 'image/jpeg')
  assert.equal(getSupportedPhotoMimeType('photo.png'), 'image/png')
  assert.equal(getSupportedPhotoMimeType('photo.webp'), 'image/webp')
  assert.equal(getSupportedPhotoMimeType('photo.svg'), null)
  assert.equal(getSupportedPhotoMimeType('photo.exe'), null)
})

test('desktop photo access only trusts the configured local application origin', () => {
  const expectedOrigin = 'http://127.0.0.1:41873'

  assert.equal(isTrustedDesktopUrl('http://127.0.0.1:41873/', expectedOrigin), true)
  assert.equal(isTrustedDesktopUrl('http://127.0.0.1:41873/photos', expectedOrigin), true)
  assert.equal(isTrustedDesktopUrl('http://localhost:41873/', expectedOrigin), false)
  assert.equal(isTrustedDesktopUrl('https://example.com/', expectedOrigin), false)
  assert.equal(isTrustedDesktopUrl('not-a-url', expectedOrigin), false)
})

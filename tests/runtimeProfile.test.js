import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  PHOTO_ALBUM_PREVIEW_PORT,
  PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY,
  P0_FIXES_TEST_PORT,
  P0_FIXES_TEST_USER_DATA_DIRECTORY,
  isAllowedExternalUrl,
  resolveDesktopPort,
  resolveDesktopRuntimeProfile,
  STABLE_DESKTOP_PORT,
} from '../electron/runtimeProfile.mjs'

test('photo album preview runtime uses isolated identity, port and user-data directory', () => {
  const profile = resolveDesktopRuntimeProfile('roadtrip-retrospective-photo-album-preview')
  assert.equal(profile.isPhotoAlbumPreview, true)
  assert.equal(profile.defaultPort, PHOTO_ALBUM_PREVIEW_PORT)
  assert.equal(profile.userDataDirectoryName, PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY)
  assert.match(profile.windowTitle, /相册实验版/)
})

test('stable runtime keeps its existing port and default Electron user-data location', () => {
  const profile = resolveDesktopRuntimeProfile('roadtrip-retrospective-tool')
  assert.equal(profile.isPhotoAlbumPreview, false)
  assert.equal(profile.defaultPort, STABLE_DESKTOP_PORT)
  assert.equal(profile.userDataDirectoryName, null)
  assert.doesNotMatch(profile.windowTitle, /相册实验版/)
})

test('P0 fixes test runtime has an isolated identity, port and user-data directory', async () => {
  const config = JSON.parse(await readFile(new URL('../electron-builder.p0-fixes-test.json', import.meta.url), 'utf8'))
  assert.equal(config.directories.output, 'release-p0-fixes-test')
  assert.equal(config.extraMetadata.name, 'roadtrip-retrospective-p0-fixes-test')

  const profile = resolveDesktopRuntimeProfile(config.extraMetadata.name)
  assert.equal(profile.isP0FixesTest, true)
  assert.equal(profile.defaultPort, P0_FIXES_TEST_PORT)
  assert.equal(profile.userDataDirectoryName, P0_FIXES_TEST_USER_DATA_DIRECTORY)
  assert.match(profile.windowTitle, /P0 修复测试版/)
  assert.notEqual(profile.defaultPort, STABLE_DESKTOP_PORT)
  assert.notEqual(profile.userDataDirectoryName, PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY)

  const packagedNameProfile = resolveDesktopRuntimeProfile(config.productName)
  assert.equal(packagedNameProfile.isP0FixesTest, true)
  assert.equal(packagedNameProfile.defaultPort, P0_FIXES_TEST_PORT)
  assert.equal(packagedNameProfile.userDataDirectoryName, P0_FIXES_TEST_USER_DATA_DIRECTORY)
})

test('official photo album package reuses preview user data and port without retaining the preview title', () => {
  const profile = resolveDesktopRuntimeProfile('roadtrip-retrospective-photo-album')
  assert.equal(profile.isPhotoAlbumPreview, false)
  assert.equal(profile.usesPhotoAlbumDataProfile, true)
  assert.equal(profile.defaultPort, PHOTO_ALBUM_PREVIEW_PORT)
  assert.equal(profile.userDataDirectoryName, PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY)
  assert.doesNotMatch(profile.windowTitle, /相册实验版/)
})

test('official Windows package metadata selects the photo album data profile', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.build.extraMetadata.name, 'roadtrip-retrospective-photo-album')
  const profile = resolveDesktopRuntimeProfile(packageJson.build.extraMetadata.name)
  assert.equal(profile.userDataDirectoryName, PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY)
  assert.equal(profile.defaultPort, PHOTO_ALBUM_PREVIEW_PORT)
})

test('explicit valid port overrides the profile default without accepting invalid values', () => {
  assert.equal(resolveDesktopPort('41900', PHOTO_ALBUM_PREVIEW_PORT), 41900)
  assert.equal(resolveDesktopPort('0', PHOTO_ALBUM_PREVIEW_PORT), PHOTO_ALBUM_PREVIEW_PORT)
  assert.equal(resolveDesktopPort('invalid', STABLE_DESKTOP_PORT), STABLE_DESKTOP_PORT)
})

test('external navigation only permits web links', () => {
  assert.equal(isAllowedExternalUrl('https://example.com/trip'), true)
  assert.equal(isAllowedExternalUrl('http://example.com/trip'), true)
  assert.equal(isAllowedExternalUrl('file:///C:/Windows/System32/drivers/etc/hosts'), false)
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedExternalUrl('mailto:someone@example.com'), false)
  assert.equal(isAllowedExternalUrl('not a url'), false)
})

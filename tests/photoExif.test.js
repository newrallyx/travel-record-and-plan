import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPhotoExif, normalizeExifOutput } from '../src/services/photoExif.ts'

test('EXIF normalization reads capture time, orientation and decimal GPS', () => {
  const metadata = normalizeExifOutput({
    DateTimeOriginal: new Date('2026-07-11T08:30:15.000Z'),
    Orientation: 6,
    latitude: 30.5728,
    longitude: 104.0668,
  })

  assert.deepEqual(metadata, {
    capturedAt: '2026-07-11T08:30:15.000Z',
    orientation: 6,
    originalGps: { lat: 30.5728, lon: 104.0668 },
  })
})

test('EXIF normalization converts DMS coordinates and preserves local date text', () => {
  const metadata = normalizeExifOutput({
    DateTimeOriginal: '2026:05:01 14:05:09',
    Orientation: 1,
    GPSLatitude: [33, 52, 30],
    GPSLatitudeRef: 'S',
    GPSLongitude: [151, 12, 0],
    GPSLongitudeRef: 'W',
  })

  assert.equal(metadata.capturedAt, '2026-05-01T14:05:09')
  assert.equal(metadata.originalGps.lat, -33.875)
  assert.equal(metadata.originalGps.lon, -151.2)
})

test('EXIF normalization ignores invalid dates, orientations and coordinate ranges', () => {
  assert.deepEqual(normalizeExifOutput({
    DateTimeOriginal: '2026:02:31 25:00:00',
    Orientation: 9,
    latitude: 120,
    longitude: 300,
  }), {
    capturedAt: undefined,
    orientation: undefined,
    originalGps: undefined,
  })
})

test('damaged EXIF returns a warning without rejecting photo import', async () => {
  const result = await extractPhotoExif(new Blob(['not an image']), async () => {
    throw new Error('invalid TIFF data')
  })

  assert.deepEqual(result.metadata, {})
  assert.match(result.warning, /invalid TIFF data/)
})

test('EXIF extraction requests stable raw values from the full parser', async () => {
  let receivedOptions
  const result = await extractPhotoExif(new Blob(['image']), async (_blob, options) => {
    receivedOptions = options
    return {
      DateTimeOriginal: new Date('2024-10-03T04:28:03.000Z'),
      Orientation: 8,
    }
  })

  assert.equal(receivedOptions.translateValues, false)
  assert.ok(receivedOptions.pick.includes('DateTimeOriginal'))
  assert.ok(receivedOptions.pick.includes('GPSLatitude'))
  assert.deepEqual(result.metadata, {
    capturedAt: '2024-10-03T04:28:03.000Z',
    orientation: 8,
    originalGps: undefined,
  })
})

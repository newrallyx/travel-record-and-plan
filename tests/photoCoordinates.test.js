import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createExifMapPosition,
  createManualMapPosition,
  isInGcj02Coverage,
  wgs84ToGcj02,
} from '../src/utils/photoCoordinates.ts'

function assertNear(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`)
}

test('WGS-84 coordinates in mainland coverage convert to expected GCJ-02 values', () => {
  const beijing = wgs84ToGcj02({ lat: 39.908823, lon: 116.39747 })
  assertNear(beijing.lat, 39.91022649807321)
  assertNear(beijing.lon, 116.4037135824225)

  const chengdu = wgs84ToGcj02({ lat: 30.5728, lon: 104.0668 })
  assertNear(chengdu.lat, 30.570346141080414)
  assertNear(chengdu.lon, 104.06930547724922)
})

test('manual map positions retain map coordinates and adjustment metadata', () => {
  assert.deepEqual(createManualMapPosition({ lat: 30.5728, lon: 104.0668 }), {
    lat: 30.5728,
    lon: 104.0668,
    coordinateSystem: 'GCJ02',
    source: 'manual',
    manuallyAdjusted: true,
  })
})

test('manual map positions reject invalid coordinates', () => {
  assert.throws(() => createManualMapPosition({ lat: 95, lon: 104 }), /outside/)
  assert.throws(() => createManualMapPosition({ lat: 30, lon: Number.NaN }), /finite/)
})

test('coordinates outside GCJ-02 coverage remain unchanged WGS-84', () => {
  const paris = { lat: 48.8566, lon: 2.3522 }
  assert.equal(isInGcj02Coverage(paris), false)
  assert.deepEqual(wgs84ToGcj02(paris), paris)
  assert.deepEqual(createExifMapPosition(paris), {
    ...paris,
    coordinateSystem: 'WGS84',
    source: 'exif',
    manuallyAdjusted: false,
  })
})

test('EXIF map positions keep source metadata and identify GCJ-02 conversion', () => {
  const original = { lat: 30.5728, lon: 104.0668 }
  const mapPosition = createExifMapPosition(original)

  assert.equal(mapPosition.coordinateSystem, 'GCJ02')
  assert.equal(mapPosition.source, 'exif')
  assert.equal(mapPosition.manuallyAdjusted, false)
  assert.notEqual(mapPosition.lat, original.lat)
  assert.notEqual(mapPosition.lon, original.lon)
})

test('coordinate conversion rejects non-finite and out-of-range input', () => {
  assert.throws(() => wgs84ToGcj02({ lat: Number.NaN, lon: 104 }), /finite/)
  assert.throws(() => wgs84ToGcj02({ lat: 91, lon: 104 }), /outside/)
  assert.throws(() => wgs84ToGcj02({ lat: 30, lon: 181 }), /outside/)
})

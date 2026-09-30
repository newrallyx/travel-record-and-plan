import type { PhotoCoordinate, PhotoMapPosition } from '../types/photo'

const EARTH_SEMI_MAJOR_AXIS = 6378245
const EARTH_ECCENTRICITY_SQUARED = 0.006693421622965943
const GCJ_MIN_LON = 72.004
const GCJ_MAX_LON = 137.8347
const GCJ_MIN_LAT = 0.8293
const GCJ_MAX_LAT = 55.8271

function assertValidCoordinate(coordinate: PhotoCoordinate): void {
  if (!Number.isFinite(coordinate.lat) || !Number.isFinite(coordinate.lon)) {
    throw new Error('Photo coordinate must contain finite latitude and longitude values.')
  }
  if (coordinate.lat < -90 || coordinate.lat > 90 || coordinate.lon < -180 || coordinate.lon > 180) {
    throw new Error('Photo coordinate is outside the valid latitude or longitude range.')
  }
}

function transformLatitude(lonOffset: number, latOffset: number): number {
  let result = -100 + 2 * lonOffset + 3 * latOffset + 0.2 * latOffset ** 2
    + 0.1 * lonOffset * latOffset + 0.2 * Math.sqrt(Math.abs(lonOffset))
  result += (20 * Math.sin(6 * lonOffset * Math.PI) + 20 * Math.sin(2 * lonOffset * Math.PI)) * 2 / 3
  result += (20 * Math.sin(latOffset * Math.PI) + 40 * Math.sin(latOffset / 3 * Math.PI)) * 2 / 3
  result += (160 * Math.sin(latOffset / 12 * Math.PI) + 320 * Math.sin(latOffset * Math.PI / 30)) * 2 / 3
  return result
}

function transformLongitude(lonOffset: number, latOffset: number): number {
  let result = 300 + lonOffset + 2 * latOffset + 0.1 * lonOffset ** 2
    + 0.1 * lonOffset * latOffset + 0.1 * Math.sqrt(Math.abs(lonOffset))
  result += (20 * Math.sin(6 * lonOffset * Math.PI) + 20 * Math.sin(2 * lonOffset * Math.PI)) * 2 / 3
  result += (20 * Math.sin(lonOffset * Math.PI) + 40 * Math.sin(lonOffset / 3 * Math.PI)) * 2 / 3
  result += (150 * Math.sin(lonOffset / 12 * Math.PI) + 300 * Math.sin(lonOffset / 30 * Math.PI)) * 2 / 3
  return result
}

export function isInGcj02Coverage(coordinate: PhotoCoordinate): boolean {
  assertValidCoordinate(coordinate)
  return coordinate.lon >= GCJ_MIN_LON
    && coordinate.lon <= GCJ_MAX_LON
    && coordinate.lat >= GCJ_MIN_LAT
    && coordinate.lat <= GCJ_MAX_LAT
}

export function wgs84ToGcj02(coordinate: PhotoCoordinate): PhotoCoordinate {
  assertValidCoordinate(coordinate)
  if (!isInGcj02Coverage(coordinate)) return { ...coordinate }

  const latitudeRadians = coordinate.lat / 180 * Math.PI
  const sinLatitude = Math.sin(latitudeRadians)
  const magic = 1 - EARTH_ECCENTRICITY_SQUARED * sinLatitude ** 2
  const sqrtMagic = Math.sqrt(magic)
  const latitudeDelta = transformLatitude(coordinate.lon - 105, coordinate.lat - 35) * 180
    / ((EARTH_SEMI_MAJOR_AXIS * (1 - EARTH_ECCENTRICITY_SQUARED)) / (magic * sqrtMagic) * Math.PI)
  const longitudeDelta = transformLongitude(coordinate.lon - 105, coordinate.lat - 35) * 180
    / (EARTH_SEMI_MAJOR_AXIS / sqrtMagic * Math.cos(latitudeRadians) * Math.PI)

  return {
    lat: coordinate.lat + latitudeDelta,
    lon: coordinate.lon + longitudeDelta,
  }
}

export function createExifMapPosition(coordinate: PhotoCoordinate): PhotoMapPosition {
  const converted = isInGcj02Coverage(coordinate)
  return {
    ...wgs84ToGcj02(coordinate),
    coordinateSystem: converted ? 'GCJ02' : 'WGS84',
    source: 'exif',
    manuallyAdjusted: false,
  }
}

export function createManualMapPosition(coordinate: PhotoCoordinate): PhotoMapPosition {
  assertValidCoordinate(coordinate)
  return {
    ...coordinate,
    coordinateSystem: 'GCJ02',
    source: 'manual',
    manuallyAdjusted: true,
  }
}

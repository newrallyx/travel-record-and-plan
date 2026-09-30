import type { CoordPoint } from '../types/trip.ts'

export const HISTORICAL_ROUTE_DISTANCE_DIFFERENCE_RATIO = 0.05
export const HISTORICAL_ROUTE_POINT_TOLERANCE_METERS = 300
export const HISTORICAL_ROUTE_GEOMETRY_SIMILARITY = 0.9

interface LatLonPoint {
  lat: number
  lon: number
}

export interface RouteGeometryComparison {
  similar: boolean
  distanceDifferenceMeters: number | null
  distanceDifferenceRatio: number | null
  geometrySimilarity: number
  distanceSimilar: boolean
  geometrySimilar: boolean
}

const EARTH_RADIUS_METERS = 6_371_000
const SAMPLE_LIMIT = 160

function toRadians(value: number): number {
  return value * Math.PI / 180
}

function haversineDistance(left: LatLonPoint, right: LatLonPoint): number {
  const lat1 = toRadians(left.lat)
  const lat2 = toRadians(right.lat)
  const deltaLat = lat2 - lat1
  const deltaLon = toRadians(right.lon - left.lon)
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(value)))
}

function samplePoints(points: readonly LatLonPoint[]): LatLonPoint[] {
  if (points.length <= SAMPLE_LIMIT) return points.map((point) => ({ ...point }))
  return Array.from({ length: SAMPLE_LIMIT }, (_value, index) => {
    const sourceIndex = Math.round(index * (points.length - 1) / (SAMPLE_LIMIT - 1))
    return { ...points[sourceIndex] }
  })
}

function pointCoverage(source: readonly LatLonPoint[], target: readonly LatLonPoint[]): number {
  if (source.length === 0 || target.length === 0) return 0
  let closeCount = 0
  for (const point of samplePoints(source)) {
    let nearest = Number.POSITIVE_INFINITY
    for (const candidate of samplePoints(target)) {
      nearest = Math.min(nearest, haversineDistance(point, candidate))
      if (nearest <= HISTORICAL_ROUTE_POINT_TOLERANCE_METERS) break
    }
    if (nearest <= HISTORICAL_ROUTE_POINT_TOLERANCE_METERS) closeCount += 1
  }
  return closeCount / Math.min(source.length, SAMPLE_LIMIT)
}

function normalizePlannedPoints(points: readonly [number, number][]): LatLonPoint[] {
  return points.map(([lat, lon]) => ({ lat, lon }))
}

function getPolylineDistance(points: readonly LatLonPoint[]): number | undefined {
  if (points.length < 2) return undefined
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += haversineDistance(points[index - 1], points[index])
  }
  return total > 0 ? total : undefined
}

export function compareRouteGeometry(
  savedPoints: readonly CoordPoint[],
  plannedPoints: readonly [number, number][],
  savedDistanceMeters?: number,
  plannedDistanceMeters?: number,
): RouteGeometryComparison {
  const normalizedPlanned = normalizePlannedPoints(plannedPoints)
  const forwardCoverage = pointCoverage(savedPoints, normalizedPlanned)
  const reverseCoverage = pointCoverage(normalizedPlanned, savedPoints)
  const geometrySimilarity = Math.min(forwardCoverage, reverseCoverage)
  const effectiveSavedDistance = typeof savedDistanceMeters === 'number' && savedDistanceMeters > 0
    ? savedDistanceMeters
    : getPolylineDistance(savedPoints)
  const effectivePlannedDistance = typeof plannedDistanceMeters === 'number' && plannedDistanceMeters > 0
    ? plannedDistanceMeters
    : getPolylineDistance(normalizedPlanned)
  const hasComparableDistance = effectiveSavedDistance !== undefined && effectivePlannedDistance !== undefined
  const distanceDifferenceMeters = hasComparableDistance
    ? Math.abs(effectiveSavedDistance - effectivePlannedDistance)
    : null
  const distanceDifferenceRatio = distanceDifferenceMeters === null
    ? null
    : distanceDifferenceMeters / Math.max(effectiveSavedDistance as number, effectivePlannedDistance as number)
  const distanceSimilar = distanceDifferenceRatio !== null
    && distanceDifferenceRatio <= HISTORICAL_ROUTE_DISTANCE_DIFFERENCE_RATIO
  const geometrySimilar = geometrySimilarity >= HISTORICAL_ROUTE_GEOMETRY_SIMILARITY

  return {
    similar: distanceSimilar && geometrySimilar,
    distanceDifferenceMeters,
    distanceDifferenceRatio,
    geometrySimilarity,
    distanceSimilar,
    geometrySimilar,
  }
}

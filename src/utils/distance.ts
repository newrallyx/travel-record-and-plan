import type { CoordPoint, RouteSegment, Trip } from '../types/trip'

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function calcPolylineDistanceMeters(points: CoordPoint[]): number | null {
  if (points.length < 2) return null

  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const next = points[i]
    const dLat = toRadians(next.lat - prev.lat)
    const dLon = toRadians(next.lon - prev.lon)
    const lat1 = toRadians(prev.lat)
    const lat2 = toRadians(next.lat)

    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    total += 6371000 * c
  }

  return Number.isFinite(total) && total > 0 ? total : null
}

export function getTrackDistanceMeters(segment: RouteSegment): number | null {
  if (typeof segment.distanceMeters === 'number' && Number.isFinite(segment.distanceMeters) && segment.distanceMeters > 0) {
    return segment.distanceMeters
  }

  if (segment.points?.length) {
    return calcPolylineDistanceMeters(segment.points)
  }

  return null
}

export function getDayDistanceMeters(segments: RouteSegment[]): number | null {
  const values = segments.map(getTrackDistanceMeters).filter((value): value is number => typeof value === 'number')
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0)
}

export function getTripDistanceMeters(trip: Trip): number | null {
  const values = trip.days
    .map((day) => getDayDistanceMeters(day.routeSegments))
    .filter((value): value is number => typeof value === 'number')
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0)
}

export function formatDistance(meters: number | null | undefined, fallback = '待生成'): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) return fallback
  return `${(meters / 1000).toFixed(1)} 公里`
}

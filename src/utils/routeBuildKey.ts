import type { RouteSegment } from '../types/trip'

function formatCoord(lat?: number, lon?: number): string {
  if (typeof lat !== 'number' || typeof lon !== 'number') return ','
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

export function buildSegmentRouteKey(segment: RouteSegment): string {
  const waypointSignature = (segment.waypoints ?? [])
    .map((point) => {
      const lat = typeof point.lat === 'number' ? point.lat.toFixed(6) : ''
      const lng = typeof point.lng === 'number' ? point.lng.toFixed(6) : ''
      return `${point.name}|${lat},${lng}`
    })
    .join('||')

  return [
    segment.startPoint.trim(),
    segment.endPoint.trim(),
    formatCoord(segment.startCoord?.lat, segment.startCoord?.lon),
    formatCoord(segment.endCoord?.lat, segment.endCoord?.lon),
    waypointSignature,
    segment.routeType ?? 'DRIVING',
    segment.preference,
  ].join('::')
}

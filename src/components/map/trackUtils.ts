import type { LatLngExpression } from 'leaflet'
import type { CoordPoint } from '../../types/trip'

export const DEFAULT_MAP_CENTER: [number, number] = [35.8617, 104.1954]
export const OVERVIEW_MAX_POINTS_PER_SEGMENT = 220

export function toLatLng(points: CoordPoint[]): LatLngExpression[] {
  return points.map((point) => [point.lat, point.lon] as LatLngExpression)
}

export function fallbackLineFromPoints(points: Array<{ lat: number; lon: number }>): CoordPoint[] {
  return points.map((point) => ({ lat: point.lat, lon: point.lon }))
}

export function downsampleLine(points: CoordPoint[], targetSize: number): CoordPoint[] {
  if (points.length <= targetSize || targetSize < 3) return points
  const step = (points.length - 1) / (targetSize - 1)
  const sampled: CoordPoint[] = []
  for (let index = 0; index < targetSize; index += 1) {
    const sourceIndex = index === targetSize - 1 ? points.length - 1 : Math.round(index * step)
    sampled.push(points[sourceIndex])
  }
  return sampled
}

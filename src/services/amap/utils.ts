import type { RoutePreference } from '../../types/trip'
import type { DrivingRequestPoint } from './types'

export function toLonLatText(point: DrivingRequestPoint): string {
  return `${point.lng},${point.lat}`
}

export function parseLocationText(location: string): { lat: number; lng: number } | null {
  const [lngText, latText] = location.split(',')
  const lng = Number(lngText)
  const lat = Number(latText)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

export function preferenceToStrategy(preference: RoutePreference): string {
  if (preference === 'HIGHWAY_FIRST') return '34'
  if (preference === 'SPEED_FIRST') return '0'
  if (preference === 'AVOID_TOLL') return '1'
  return '34'
}

export function buildRouteKey(points: DrivingRequestPoint[], preference: RoutePreference): string {
  const origin = toLonLatText(points[0])
  const destination = toLonLatText(points[points.length - 1])
  const via = points.length > 2 ? points.slice(1, -1).map(toLonLatText).join(';') : ''
  const strategy = preferenceToStrategy(preference)
  return `amap-v5|${origin}|${destination}|${via}|${strategy}`
}

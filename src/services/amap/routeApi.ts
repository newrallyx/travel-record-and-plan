import { LOCAL_API_CLIENT_HEADERS } from '../localApiClient.ts'
import type { RouteApiResult } from './types'
import type { RouteRoadPart } from '../../types/roadStatistics.ts'
import { classifyRoad, classifyRoadPartEvidence, normalizeRoadText, reclassifyRoadParts } from '../../utils/roadClassifier.ts'
import {
  applyProvinceResolution,
  collectProvinceEvidence,
  isProvinceSensitiveRoadPart,
  resolveProvinceEvidence,
} from '../../utils/province.ts'
import { parseLocationText } from './utils.ts'

export function parsePolyline(steps: Array<{ polyline?: string }> | undefined): Array<[number, number]> {
  const points: Array<[number, number]> = []
  let previousKey = ''

  for (const step of steps ?? []) {
    if (!step.polyline) continue
    for (const rawPair of step.polyline.split(';')) {
      const parsed = parseLocationText(rawPair)
      if (!parsed) continue
      const key = `${parsed.lat.toFixed(6)},${parsed.lng.toFixed(6)}`
      if (key === previousKey) continue
      points.push([parsed.lat, parsed.lng])
      previousKey = key
    }
  }

  return points
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

interface AmapDrivingPath {
  distance?: string | number
  duration?: string | number
  tolls?: string | number
  toll_distance?: string | number
  steps?: AmapDrivingStep[]
}

interface AmapDrivingStep {
  road?: string
  distance?: string | number
  toll_distance?: string | number
  toll_road?: string
  instruction?: string
  polyline?: string
  adcode?: unknown
  cities?: unknown
  districts?: unknown
}

interface AmapCyclingPath {
  distance?: number
  duration?: number
  steps?: AmapCyclingStep[]
}

interface AmapCyclingStep {
  road?: string
  distance?: string | number
  duration?: string | number
  instruction?: string
  polyline?: string
  adcode?: unknown
  cities?: unknown
  districts?: unknown
}

function parseOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function applyStepProvinceEvidence(part: RouteRoadPart, step: { adcode?: unknown; cities?: unknown; districts?: unknown }): RouteRoadPart {
  if (!isProvinceSensitiveRoadPart(part)) return part
  const resolution = resolveProvinceEvidence(
    collectProvinceEvidence({ adcode: step.adcode, cities: step.cities, districts: step.districts }),
    'NAVIGATION',
  )
  return applyProvinceResolution(part, resolution)
}

/** 按高德 step 原始顺序生成道路片段；此处有意不做相邻合并。 */
export function parseDrivingRoadParts(steps: AmapDrivingStep[] | undefined): RouteRoadPart[] {
  const sourceSteps = steps ?? []
  const tollCovered = sourceSteps.map((step) => {
    const distanceMeters = parseNonNegativeNumber(step.distance) ?? 0
    const tollDistanceMeters = parseNonNegativeNumber(step.toll_distance) ?? 0
    return tollDistanceMeters > 0 && (distanceMeters === 0 || tollDistanceMeters >= distanceMeters * 0.9)
  })
  const roadParts = sourceSteps.map((step) => {
    const { normalizedRoadName, ...classification } = classifyRoadPartEvidence({
      roadName: step.road,
      tollRoad: step.toll_road,
      instruction: step.instruction,
    })
    const tollRoad = normalizeRoadText(step.toll_road) || undefined
    const instruction = parseOptionalText(step.instruction)
    return applyStepProvinceEvidence({
      ...classification,
      distanceMeters: parseNonNegativeNumber(step.distance) ?? 0,
      distanceSource: 'NAVIGATION' as const,
      ...(normalizedRoadName ? { roadName: normalizedRoadName } : {}),
      ...(tollRoad ? { tollRoad } : {}),
      ...(instruction ? { instruction } : {}),
      polyline: parsePolyline([step]),
    }, step)
  })
  return reclassifyRoadParts(roadParts, { tollCovered })
}

/** 骑行 step 不使用收费道路或导航指令推断当前道路；road 为空时保留未知片段。 */
export function parseCyclingRoadParts(steps: AmapCyclingStep[] | undefined): RouteRoadPart[] {
  return (steps ?? []).map((step) => {
    const { normalizedRoadName, ...classification } = classifyRoad(step.road)
    const instruction = parseOptionalText(step.instruction)
    const part = applyStepProvinceEvidence({
      ...classification,
      distanceMeters: parseNonNegativeNumber(step.distance) ?? 0,
      distanceSource: 'NAVIGATION' as const,
      ...(normalizedRoadName ? { roadName: normalizedRoadName } : {}),
      ...(instruction ? { instruction } : {}),
      polyline: parsePolyline([step]),
    }, step)
    return part
  })
}

export function parseDrivingPath(path: AmapDrivingPath): RouteApiResult {
  const distanceMeters = parseNonNegativeNumber(path.distance)
  const durationSeconds = parseNonNegativeNumber(path.duration)
  return {
    polyline: parsePolyline(path.steps),
    roadParts: parseDrivingRoadParts(path.steps),
    distanceText: typeof distanceMeters === 'number' ? `${distanceMeters} 米` : '未知',
    durationText: typeof durationSeconds === 'number' ? `${durationSeconds} 秒` : '未知',
    durationSeconds,
    distanceMeters,
    estimatedTollYuan: parseNonNegativeNumber(path.tolls),
    tollDistanceMeters: parseNonNegativeNumber(path.toll_distance),
  }
}

export function parseCyclingPath(path: AmapCyclingPath): RouteApiResult {
  const distanceMeters = parseNonNegativeNumber(path.distance)
  const durationSeconds = parseNonNegativeNumber(path.duration)
  return {
    polyline: parsePolyline(path.steps),
    roadParts: parseCyclingRoadParts(path.steps),
    distanceText: typeof distanceMeters === 'number' ? `${distanceMeters} 米` : '未知',
    durationText: typeof durationSeconds === 'number' ? `${durationSeconds} 秒` : '未知',
    durationSeconds,
    distanceMeters,
  }
}

export async function requestDrivingRoute(
  originLngLat: string,
  destinationLngLat: string,
  strategy = '0',
  waypoints?: string,
): Promise<RouteApiResult> {
  const url = new URL('/api/amap/direction', window.location.origin)
  url.searchParams.set('origin', originLngLat)
  url.searchParams.set('destination', destinationLngLat)
  url.searchParams.set('strategy', strategy)
  if (waypoints) url.searchParams.set('waypoints', waypoints)

  const response = await fetch(`${url.pathname}${url.search}`, {
    headers: LOCAL_API_CLIENT_HEADERS,
  })
  const raw = (await response.json()) as {
    ok?: boolean
    message?: string
    detail?: unknown
    data?: {
      status?: string
      info?: string
      infocode?: string
      route?: {
        paths?: AmapDrivingPath[]
      }
    }
  }

  if (!response.ok || !raw.ok) {
    if (import.meta.env.DEV) console.error('Direction raw response', raw)
    throw new Error(raw.message || 'direction failed')
  }

  const payload = raw.data
  if (!payload || payload.status !== '1') {
    if (import.meta.env.DEV) console.error('Direction amap payload', payload)
    throw new Error(payload?.info || payload?.infocode || 'direction failed')
  }

  const path = payload.route?.paths?.[0]
  if (!path) throw new Error('高德未返回可用路线。')

  const result = parseDrivingPath(path)
  if (!result.polyline.length) throw new Error('高德返回路线为空。')
  return result
}

export async function requestCyclingRoute(
  originLngLat: string,
  destinationLngLat: string,
): Promise<RouteApiResult> {
  const url = new URL('/api/amap/cycling-direction', window.location.origin)
  url.searchParams.set('origin', originLngLat)
  url.searchParams.set('destination', destinationLngLat)

  const response = await fetch(`${url.pathname}${url.search}`, {
    headers: LOCAL_API_CLIENT_HEADERS,
  })
  const raw = (await response.json()) as {
    ok?: boolean
    message?: string
    data?: {
      errcode?: number
      errmsg?: string
      data?: {
        paths?: Array<{
          distance?: number
          duration?: number
          steps?: AmapCyclingStep[]
        }>
      }
    }
  }

  if (!response.ok || !raw.ok) {
    throw new Error(raw.message || 'cycling direction failed')
  }

  const payload = raw.data
  if (!payload || payload.errcode !== 0) {
    throw new Error(payload?.errmsg || 'cycling direction failed')
  }

  const path = payload.data?.paths?.[0]
  if (!path) throw new Error('高德未返回可用骑行路线。')

  const result = parseCyclingPath(path)
  if (!result.polyline.length) throw new Error('高德返回骑行路线为空。')
  return result
}

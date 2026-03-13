import { mockTripReview } from './mockData'
import type { CoordPoint, RouteSegment, TripReview, Waypoint } from '../types/trip'

// 本地存储服务：统一处理 TripReview 的读取与保存，避免组件直接操作 localStorage。
const STORAGE_KEY = 'trip-review-data-v1'

function normalizeCoordPoint(value: unknown): CoordPoint | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as Partial<CoordPoint>
  if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') return undefined

  const point: CoordPoint = {
    lat: candidate.lat,
    lon: candidate.lon,
  }

  if (typeof candidate.timestamp === 'string') {
    point.timestamp = candidate.timestamp
  }

  return point
}

function normalizeWaypoint(value: unknown): Waypoint | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as Partial<Waypoint>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return undefined

  const waypoint: Waypoint = {
    id: candidate.id,
    name: candidate.name,
  }

  if (typeof candidate.lat === 'number') waypoint.lat = candidate.lat
  if (typeof candidate.lng === 'number') waypoint.lng = candidate.lng
  if (typeof candidate.amapId === 'string') waypoint.amapId = candidate.amapId
  if (typeof candidate.timestamp === 'string') waypoint.timestamp = candidate.timestamp

  return waypoint
}

function normalizeWaypoints(value: unknown): Waypoint[] | undefined {
  if (!Array.isArray(value)) return undefined

  const waypoints = value
    .map((item) => normalizeWaypoint(item))
    .filter((item): item is Waypoint => Boolean(item))

  return waypoints.length > 0 ? waypoints : undefined
}

function normalizeLegacyViaPointsText(viaPointsText: unknown): Waypoint[] | undefined {
  if (typeof viaPointsText !== 'string') return undefined
  const names = viaPointsText
    .split(/[，,;；|]/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (!names.length) return undefined

  return names.map((name, index) => ({
    id: `legacy-wp-${index}-${name}`,
    name,
  }))
}

function normalizeRouteSegment(segment: RouteSegment): RouteSegment {
  const normalizedStartCoord = normalizeCoordPoint(segment.startCoord)
  const normalizedEndCoord = normalizeCoordPoint(segment.endCoord)
  const normalizedWaypoints = normalizeWaypoints(segment.waypoints)

  return {
    ...segment,
    routeType: segment.routeType ?? 'DRIVING',
    preference: segment.preference === 'AVOID_TOLL' ? 'AVOID_TOLL' : 'HIGHWAY_FIRST',
    startCoord: normalizedStartCoord,
    endCoord: normalizedEndCoord,
    // points 已迁移到 IndexedDB，此处兼容旧数据但不再从 localStorage 回填。
    points: undefined,
    waypoints: normalizedWaypoints ?? normalizeLegacyViaPointsText(segment.viaPointsText),
    // 新主流程不再依赖 viaPointsText。
    viaPointsText: undefined,
  }
}

function normalizeTripReview(input: TripReview): TripReview {
  return {
    ...input,
    trips: (input.trips ?? []).map((trip) => ({
      ...trip,
      category: trip.category === 'plan' ? 'plan' : 'review',
      days: (trip.days ?? []).map((day) => ({
        ...day,
        routeSegments: (day.routeSegments ?? []).map((segment) => normalizeRouteSegment(segment)),
      })),
    })),
  }
}

function toPersistedRouteSegment(segment: RouteSegment): RouteSegment {
  return {
    id: segment.id,
    name: segment.name,
    date: segment.date,
    startPoint: segment.startPoint,
    endPoint: segment.endPoint,
    startCoord: normalizeCoordPoint(segment.startCoord),
    endCoord: normalizeCoordPoint(segment.endCoord),
    waypoints: normalizeWaypoints(segment.waypoints),
    routeType: segment.routeType ?? 'DRIVING',
    preference: segment.preference === 'AVOID_TOLL' ? 'AVOID_TOLL' : 'HIGHWAY_FIRST',
    distanceMeters: segment.distanceMeters,
    routeBuildKey: segment.routeBuildKey,
    startPlaceId: segment.startPlaceId,
    endPlaceId: segment.endPlaceId,
    order: segment.order,
  }
}

export function toPersistedTripReview(data: TripReview): TripReview {
  return {
    trips: data.trips.map((trip) => ({
      ...trip,
      days: trip.days.map((day) => ({
        ...day,
        routeSegments: day.routeSegments.map((segment) => toPersistedRouteSegment(segment)),
      })),
    })),
  }
}

function resetToMockData(): TripReview {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedTripReview(mockTripReview)))
  } catch (error) {
    console.error('[tripStorage] Failed to reset trip review cache with mock data.', error)
  }
  return mockTripReview
}

export function loadTripReview(): TripReview {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return resetToMockData()
  }

  try {
    return normalizeTripReview(JSON.parse(raw) as TripReview)
  } catch (error) {
    console.error('[tripStorage] Failed to parse trip review cache, fallback to mock data.', error)
    return resetToMockData()
  }
}

export function saveTripReview(data: TripReview): void {
  try {
    const persisted = toPersistedTripReview(data)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch (error) {
    console.error('[tripStorage] Failed to persist trip review into localStorage.', error)
  }
}

import { buildSegmentRouteKey } from '../utils/routeBuildKey'
import type { CoordPoint, RouteSegment, TripReview, Waypoint } from '../types/trip'
import { normalizeScore, normalizeSegmentNote } from '../utils/segmentScores'

const DEMO_DATA_PATH = '/demo-data.json'

function normalizeCoordPoint(value: unknown): CoordPoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<CoordPoint>
  if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') return undefined
  return {
    lat: candidate.lat,
    lon: candidate.lon,
    ...(typeof candidate.timestamp === 'string' ? { timestamp: candidate.timestamp } : {}),
  }
}

function normalizeWaypoint(value: unknown): Waypoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<Waypoint>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return undefined

  return {
    id: candidate.id,
    name: candidate.name,
    ...(typeof candidate.lat === 'number' ? { lat: candidate.lat } : {}),
    ...(typeof candidate.lng === 'number' ? { lng: candidate.lng } : {}),
    ...(typeof candidate.amapId === 'string' ? { amapId: candidate.amapId } : {}),
    ...(typeof candidate.timestamp === 'string' ? { timestamp: candidate.timestamp } : {}),
  }
}

function normalizeSegment(segment: RouteSegment): RouteSegment {
  const points = Array.isArray(segment.points)
    ? segment.points.map((point) => normalizeCoordPoint(point)).filter((point): point is CoordPoint => Boolean(point))
    : undefined

  const waypoints = Array.isArray(segment.waypoints)
    ? segment.waypoints.map((waypoint) => normalizeWaypoint(waypoint)).filter((waypoint): waypoint is Waypoint => Boolean(waypoint))
    : undefined

  const normalized: RouteSegment = {
    ...segment,
    routeType: segment.routeType ?? 'DRIVING',
    preference: segment.preference === 'AVOID_TOLL' ? 'AVOID_TOLL' : 'HIGHWAY_FIRST',
    startCoord: normalizeCoordPoint(segment.startCoord),
    endCoord: normalizeCoordPoint(segment.endCoord),
    points,
    waypoints,
    viaPointsText: undefined,
    scenicScore: normalizeScore(segment.scenicScore),
    difficultyScore: normalizeScore(segment.difficultyScore),
    note: normalizeSegmentNote(segment.note),
  }

  return {
    ...normalized,
    routeBuildKey: normalized.routeBuildKey ?? buildSegmentRouteKey(normalized),
  }
}

function normalizeTripReview(input: TripReview): TripReview {
  return {
    trips: (input.trips ?? []).map((trip) => ({
      ...trip,
      category: trip.category === 'plan' ? 'plan' : 'review',
      days: (trip.days ?? []).map((day) => ({
        ...day,
        routeSegments: (day.routeSegments ?? []).map((segment) => normalizeSegment(segment)),
      })),
    })),
  }
}

export async function loadReadonlyDemoTripReview(): Promise<TripReview> {
  const response = await fetch(DEMO_DATA_PATH, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`加载展示数据失败（${response.status} ${response.statusText}）`)
  }

  const json = (await response.json()) as TripReview
  return normalizeTripReview(json)
}

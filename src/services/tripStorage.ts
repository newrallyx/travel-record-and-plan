import { mockTripReview } from './mockData'
import type { RoutePreference, RouteSegment, RouteType, TripReview } from '../types/trip'

const STORAGE_KEY = 'trip-review-data-v1'

function normalizePreference(preference: RoutePreference | undefined): RoutePreference {
  return preference === 'AVOID_TOLL' ? 'AVOID_TOLL' : 'HIGHWAY_FIRST'
}

function normalizeRouteType(routeType: RouteType | undefined): RouteType {
  return routeType === 'bicycling' ? 'bicycling' : 'driving'
}

function normalizeSegment(segment: RouteSegment): RouteSegment {
  const routeType = normalizeRouteType(segment.routeType)
  return {
    ...segment,
    routeType,
    // 兼容历史数据：旧数据可能无 routeType/preference，统一按驾车+高速优先处理。
    preference: routeType === 'driving' ? normalizePreference(segment.preference) : undefined,
  }
}

function normalizeReview(data: TripReview): TripReview {
  return {
    trips: data.trips.map((trip) => ({
      ...trip,
      days: trip.days.map((day) => ({
        ...day,
        routeSegments: day.routeSegments.map(normalizeSegment),
      })),
    })),
  }
}

export function loadTripReview(): TripReview {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const normalized = normalizeReview(mockTripReview)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  }

  try {
    return normalizeReview(JSON.parse(raw) as TripReview)
  } catch {
    const normalized = normalizeReview(mockTripReview)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  }
}

export function saveTripReview(data: TripReview): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeReview(data)))
}

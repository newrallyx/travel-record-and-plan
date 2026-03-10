import { mockTripReview } from './mockData'
import type { TripReview } from '../types/trip'

// 本地存储服务：统一处理 TripReview 的读取与保存，避免组件直接操作 localStorage。
const STORAGE_KEY = 'trip-review-data-v1'

function normalizeTripReview(input: TripReview): TripReview {
  return {
    ...input,
    trips: input.trips.map((trip) => ({
      ...trip,
      days: trip.days.map((day) => ({
        ...day,
        routeSegments: day.routeSegments.map((segment) => ({
          ...segment,
          routeType: segment.routeType ?? 'DRIVING',
          preference: segment.preference === 'AVOID_TOLL' ? 'AVOID_TOLL' : 'HIGHWAY_FIRST',
        })),
      })),
    })),
  }
}

export function loadTripReview(): TripReview {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockTripReview))
    return mockTripReview
  }

  try {
    return normalizeTripReview(JSON.parse(raw) as TripReview)
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockTripReview))
    return mockTripReview
  }
}

export function saveTripReview(data: TripReview): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

import { useMemo } from 'react'
import type { FilterState, RouteSegment, Trip } from '../types/trip'

// 筛选计算 Hook：只负责根据 trip/day/segment 条件计算结果，不关心 UI 如何展示。
export function useFilteredSegments(trips: Trip[], filters: FilterState): RouteSegment[] {
  return useMemo(() => {
    if (!filters.tripId) {
      return trips.flatMap((trip) => trip.days.flatMap((day) => day.routeSegments))
    }

    const selectedTrip = trips.find((trip) => trip.id === filters.tripId)
    if (!selectedTrip) {
      return []
    }

    if (!filters.dayId) {
      return selectedTrip.days.flatMap((day) => day.routeSegments)
    }

    const selectedDay = selectedTrip.days.find((day) => day.id === filters.dayId)
    if (!selectedDay) {
      return []
    }

    if (!filters.segmentId) {
      return selectedDay.routeSegments
    }

    return selectedDay.routeSegments.filter((segment) => segment.id === filters.segmentId)
  }, [trips, filters.tripId, filters.dayId, filters.segmentId])
}

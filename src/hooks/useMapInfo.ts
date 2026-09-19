import { useMemo } from 'react'
import type { FilterState, RouteSegment, Trip, TripDay } from '../types/trip'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters, getTripDistanceMeters } from '../utils/distance'
import { formatDurationSummary, summarizeEstimatedDurations } from '../utils/durations'
import { formatTollSummary, summarizeEstimatedTolls } from '../utils/tolls'

interface UseMapInfoParams {
  activeSegment: RouteSegment | null
  activeSegmentDate: string
  isAllTripsSelected: boolean
  selectedDay: TripDay | null
  selectedTrip: Trip | null
  filters: FilterState
  mapRenderSegments: RouteSegment[]
  fallbackDayDate: string
}

export function useMapInfo({
  activeSegment,
  activeSegmentDate,
  isAllTripsSelected,
  selectedDay,
  selectedTrip,
  filters,
  mapRenderSegments,
  fallbackDayDate,
}: UseMapInfoParams) {
  return useMemo(() => {
    const dateLabel = selectedDay?.date ?? (isAllTripsSelected ? '全部日期' : fallbackDayDate)
    const cacheStatus = filters.tripId && filters.dayId && filters.segmentId && mapRenderSegments.length <= 3
      ? '按需规划'
      : '缓存优先'

    const mapDistanceText = (() => {
      if (activeSegment) return formatDistance(getTrackDistanceMeters(activeSegment))
      if (selectedDay) return formatDistance(getDayDistanceMeters(selectedDay.routeSegments))
      if (selectedTrip) return formatDistance(getTripDistanceMeters(selectedTrip))
      return formatDistance(getDayDistanceMeters(mapRenderSegments))
    })()
    const tollSegments = activeSegment
      ? [activeSegment]
      : selectedDay?.routeSegments
        ?? selectedTrip?.days.flatMap((day) => day.routeSegments)
        ?? mapRenderSegments
    const mapTollText = formatTollSummary(summarizeEstimatedTolls(tollSegments))
    const mapDurationText = formatDurationSummary(summarizeEstimatedDurations(tollSegments))

    if (activeSegment) {
      return {
        summary: `${activeSegment.name} · ${activeSegmentDate || dateLabel} · 路段数 ${mapRenderSegments.length} · 距离 ${mapDistanceText} · 预计行驶时间 ${mapDurationText} · 预估过路费 ${mapTollText} · 缓存状态 ${cacheStatus}`,
      }
    }

    if (isAllTripsSelected) {
      return {
        summary: `全部路线 · ${dateLabel} · 路段数 ${mapRenderSegments.length} · 距离 ${mapDistanceText} · 预计行驶时间 ${mapDurationText} · 预估过路费 ${mapTollText} · 缓存状态 ${cacheStatus}`,
      }
    }

    return {
      summary: `${selectedTrip?.title ?? '当前路线'} · ${dateLabel} · 路段数 ${mapRenderSegments.length} · 距离 ${mapDistanceText} · 预计行驶时间 ${mapDurationText} · 预估过路费 ${mapTollText} · 缓存状态 ${cacheStatus}`,
    }
  }, [
    activeSegment,
    activeSegmentDate,
    fallbackDayDate,
    filters.dayId,
    filters.segmentId,
    filters.tripId,
    isAllTripsSelected,
    mapRenderSegments,
    selectedDay,
    selectedTrip,
  ])
}

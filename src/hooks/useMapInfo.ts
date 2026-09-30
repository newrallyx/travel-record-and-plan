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

    const title = activeSegment?.name ?? (isAllTripsSelected
      ? filters.year ? filters.year === 'unknown' ? '未注明年份路线' : `${filters.year}年全部路线` : '全部路线'
      : selectedTrip?.title ?? '当前路线')
    return {
      title,
      date: activeSegment ? activeSegmentDate || dateLabel : dateLabel,
      cacheStatus,
      metrics: [
        { label: '路段', value: String(mapRenderSegments.length) },
        { label: '距离', value: mapDistanceText },
        { label: '预计行驶', value: mapDurationText },
        { label: '预估过路费', value: mapTollText },
      ],
    }
  }, [
    activeSegment,
    activeSegmentDate,
    fallbackDayDate,
    filters.dayId,
    filters.segmentId,
    filters.tripId,
    filters.year,
    isAllTripsSelected,
    mapRenderSegments,
    selectedDay,
    selectedTrip,
  ])
}

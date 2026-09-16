import { useEffect, useMemo, useRef, useState } from 'react'
import { isReadonlyDemoMode } from '../config/appMode'
import type {
  FilterState,
  RouteColorMode,
  RouteSegment,
  RouteSummary,
  Trip,
  TripCategory,
  TripReview,
} from '../types/trip'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters, getTripDistanceMeters } from '../utils/distance'
import { formatDurationSummary, summarizeEstimatedDurations } from '../utils/durations'
import { sortTripsByOrder } from '../utils/tripOrder'
import { formatTollSummary, summarizeEstimatedTolls } from '../utils/tolls'
import { useFilteredSegments } from './useFilteredSegments'
import {
  DEFAULT_ROAD_TYPE_VISIBILITY,
  type RoadTypeVisibility,
} from '../components/map/roadTypeVisualization'

interface UseTripWorkspaceParams {
  trips: TripReview['trips']
  editingSegmentId: string | null
  resetEditingState: () => void
}

export interface TripBookItem {
  id: string
  title: string
  startDate: string
  endDate: string
  dayCount: number
  segmentCount: number
  photoCount: number
  tripDistanceText: string
  tripDurationText: string
  tripTollText: string
}

function countTripPhotoIds(trip: Trip): number {
  const photoIds = new Set<string>()
  for (const day of trip.days) {
    for (const segment of day.routeSegments) {
      for (const photoId of segment.photoIds ?? []) photoIds.add(photoId)
    }
  }
  return photoIds.size
}

export function useTripWorkspace({
  trips,
  editingSegmentId,
  resetEditingState,
}: UseTripWorkspaceParams) {
  const [activeWorkspace, setActiveWorkspace] = useState<TripCategory>('review')
  const [filters, setFilters] = useState<FilterState>({ tripId: '', dayId: '', segmentId: '' })
  const [tripManagerOpen, setTripManagerOpen] = useState(false)
  const [routeColorMode, setRouteColorMode] = useState<RouteColorMode>('default')
  const [roadTypeVisibility, setRoadTypeVisibility] = useState<RoadTypeVisibility>(DEFAULT_ROAD_TYPE_VISIBILITY)
  const filtersRef = useRef(filters)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const workspaceTrips = useMemo(
    () =>
      sortTripsByOrder(trips.filter((trip) => trip.category === activeWorkspace)),
    [trips, activeWorkspace],
  )

  const isAllTripsSelected = !filters.tripId
  const canUseScoreColoring = !isAllTripsSelected
  const placeholderMode: 'trip-list' | 'segment-list' = isAllTripsSelected ? 'trip-list' : 'segment-list'
  const mapRenderSegments = useFilteredSegments(workspaceTrips, filters)
  const listViewSegments = placeholderMode === 'segment-list' ? mapRenderSegments : []

  const segmentDayDateMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const trip of workspaceTrips) {
      for (const day of trip.days) {
        for (const segment of day.routeSegments) {
          if (!map.has(segment.id) && day.date) {
            map.set(segment.id, day.date)
          }
        }
      }
    }
    return map
  }, [workspaceTrips])

  const detailSegments = useMemo(
    () =>
      listViewSegments.map((segment) => ({
        ...segment,
        dayDate: (segment as RouteSegment & { dayDate?: string }).dayDate ?? segmentDayDateMap.get(segment.id),
      })),
    [listViewSegments, segmentDayDateMap],
  )

  const activeSegmentId = useMemo(() => {
    if (editingSegmentId && listViewSegments.some((segment) => segment.id === editingSegmentId)) {
      return editingSegmentId
    }
    if (filters.segmentId && listViewSegments.some((segment) => segment.id === filters.segmentId)) {
      return filters.segmentId
    }
    return null
  }, [editingSegmentId, filters.segmentId, listViewSegments])

  useEffect(() => {
    const currentFilters = filtersRef.current
    const firstTrip = workspaceTrips[0]
    if (!firstTrip) {
      if (currentFilters.tripId || currentFilters.dayId || currentFilters.segmentId) {
        setFilters({ tripId: '', dayId: '', segmentId: '' })
        resetEditingState()
      }
      return
    }

    if (isReadonlyDemoMode && !currentFilters.tripId) {
      if (currentFilters.dayId || currentFilters.segmentId) {
        setFilters({ tripId: '', dayId: '', segmentId: '' })
        resetEditingState()
      }
      return
    }

    const selectedTrip = workspaceTrips.find((trip) => trip.id === currentFilters.tripId) ?? firstTrip
    const selectedDay = selectedTrip.days.find((day) => day.id === currentFilters.dayId) ?? selectedTrip.days[0]
    const selectedSegment =
      selectedDay?.routeSegments.find((segment) => segment.id === currentFilters.segmentId) ?? selectedDay?.routeSegments[0]

    const nextFilters: FilterState = {
      tripId: selectedTrip.id,
      dayId: selectedDay?.id ?? '',
      segmentId: selectedSegment?.id ?? '',
    }

    if (
      nextFilters.tripId !== currentFilters.tripId
      || nextFilters.dayId !== currentFilters.dayId
      || nextFilters.segmentId !== currentFilters.segmentId
    ) {
      setFilters(nextFilters)
      resetEditingState()
    }
  }, [activeWorkspace, workspaceTrips, isReadonlyDemoMode, resetEditingState, setFilters])

  useEffect(() => {
    if (canUseScoreColoring || routeColorMode === 'default' || routeColorMode === 'roadType') return
    setRouteColorMode('default')
  }, [canUseScoreColoring, routeColorMode])

  const selectedTrip = useMemo(
    () => workspaceTrips.find((trip) => trip.id === filters.tripId) ?? null,
    [workspaceTrips, filters.tripId],
  )
  const selectedDay = useMemo(
    () => selectedTrip?.days.find((day) => day.id === filters.dayId) ?? null,
    [selectedTrip, filters.dayId],
  )
  const activeSegment = useMemo(
    () => listViewSegments.find((segment) => segment.id === activeSegmentId) ?? null,
    [listViewSegments, activeSegmentId],
  )

  const tripListItems = useMemo(
    () =>
      workspaceTrips.map((trip) => ({
        id: trip.id,
        title: trip.title,
        startDate: trip.startDate,
        endDate: trip.endDate,
        segmentCount: trip.days.reduce((sum, day) => sum + day.routeSegments.length, 0),
        tripDistanceText: formatDistance(getTripDistanceMeters(trip)),
        tripDurationText: formatDurationSummary(summarizeEstimatedDurations(trip.days.flatMap((day) => day.routeSegments))),
        tripTollText: formatTollSummary(summarizeEstimatedTolls(trip.days.flatMap((day) => day.routeSegments))),
      })),
    [workspaceTrips],
  )

  const tripBookItems = useMemo<TripBookItem[]>(
    () =>
      workspaceTrips.map((trip) => ({
        id: trip.id,
        title: trip.title,
        startDate: trip.startDate,
        endDate: trip.endDate,
        dayCount: trip.days.length,
        segmentCount: trip.days.reduce((sum, day) => sum + day.routeSegments.length, 0),
        photoCount: countTripPhotoIds(trip),
        tripDistanceText: formatDistance(getTripDistanceMeters(trip)),
        tripDurationText: formatDurationSummary(summarizeEstimatedDurations(trip.days.flatMap((day) => day.routeSegments))),
        tripTollText: formatTollSummary(summarizeEstimatedTolls(trip.days.flatMap((day) => day.routeSegments))),
      })),
    [workspaceTrips],
  )

  const tripDistanceText = useMemo(
    () => formatDistance(selectedTrip ? getTripDistanceMeters(selectedTrip) : null),
    [selectedTrip],
  )
  const dayDistanceText = useMemo(
    () => formatDistance(selectedDay ? getDayDistanceMeters(selectedDay.routeSegments) : null),
    [selectedDay],
  )
  const tripTollText = useMemo(
    () => formatTollSummary(summarizeEstimatedTolls(selectedTrip?.days.flatMap((day) => day.routeSegments) ?? [])),
    [selectedTrip],
  )
  const dayTollText = useMemo(
    () => formatTollSummary(summarizeEstimatedTolls(selectedDay?.routeSegments ?? [])),
    [selectedDay],
  )
  const tripDurationText = useMemo(
    () => formatDurationSummary(summarizeEstimatedDurations(selectedTrip?.days.flatMap((day) => day.routeSegments) ?? [])),
    [selectedTrip],
  )
  const dayDurationText = useMemo(
    () => formatDurationSummary(summarizeEstimatedDurations(selectedDay?.routeSegments ?? [])),
    [selectedDay],
  )

  const filterContext = useMemo(() => {
    const currentTrip = workspaceTrips.find((trip) => trip.id === filters.tripId)
    const currentDay = currentTrip?.days.find((day) => day.id === filters.dayId)
    const currentSegment = currentDay?.routeSegments.find((segment) => segment.id === filters.segmentId)

    return {
      tripName: currentTrip?.title ?? '全部旅程',
      dayDate: currentDay?.date ?? '全部日期',
      segmentName: currentSegment?.name ?? '全部路段',
    }
  }, [workspaceTrips, filters.tripId, filters.dayId, filters.segmentId])

  const summary: RouteSummary = useMemo(
    () => ({
      totalDistanceText: formatDistance(activeSegment ? getTrackDistanceMeters(activeSegment) : null),
      totalEstimatedDurationText: formatDurationSummary(summarizeEstimatedDurations(activeSegment ? [activeSegment] : [])),
      totalEstimatedTollText: formatTollSummary(summarizeEstimatedTolls(activeSegment ? [activeSegment] : [])),
    }),
    [activeSegment],
  )

  return {
    activeWorkspace,
    setActiveWorkspace,
    filters,
    setFilters,
    tripManagerOpen,
    setTripManagerOpen,
    routeColorMode,
    setRouteColorMode,
    roadTypeVisibility,
    setRoadTypeVisibility,
    workspaceTrips,
    isAllTripsSelected,
    canUseScoreColoring,
    placeholderMode,
    mapRenderSegments,
    listViewSegments,
    detailSegments,
    activeSegmentId,
    selectedTrip,
    selectedDay,
    activeSegment,
    tripListItems,
    tripBookItems,
    tripDistanceText,
    dayDistanceText,
    tripTollText,
    dayTollText,
    tripDurationText,
    dayDurationText,
    filterContext,
    summary,
  }
}

import { useCallback } from 'react'
import { confirmDialog } from '../../components/ConfirmDialog'
import { deleteSegmentRouteCache } from '../../services/routeCacheDb'
import type {
  CoordPoint,
  FilterState,
  RoutePreference,
  RouteSegment,
  RouteType,
  Waypoint,
} from '../../types/trip'
import { sortTripDaysByDate } from '../../utils/date'
import { moveSegmentById, reorderSegmentsById } from '../../utils/segmentOrder'
import { normalizeScore, normalizeSegmentNote } from '../../utils/segmentScores'
import type {
  BlockReadonlyWrite,
  DeleteLinkedPhotos,
  EditingStateControls,
  FindSegmentRef,
  SetFilters,
  SetTripReview,
} from './types'
import { createId, getSavedSegmentSelection } from './utils'

interface UseSegmentActionsParams extends EditingStateControls {
  activeSegmentId: string | null
  filters: FilterState
  setFilters: SetFilters
  listViewSegments: RouteSegment[]
  setTripReview: SetTripReview
  blockReadonlyWrite: BlockReadonlyWrite
  findSegmentRef: FindSegmentRef
  onDeleteLinkedPhotos: DeleteLinkedPhotos
}

export function useSegmentActions({
  activeSegmentId,
  filters,
  setFilters,
  listViewSegments,
  editingSegmentId,
  setEditingSegmentId,
  editingWaypointSegmentId,
  setEditingWaypointSegmentId,
  setWaypointDrafts,
  setSelectedWaypointId,
  editingEndpointsSegmentId,
  setEditingEndpointsSegmentId,
  setEndpointDraft,
  setTripReview,
  blockReadonlyWrite,
  findSegmentRef,
  onDeleteLinkedPhotos,
}: UseSegmentActionsParams) {
  const getSegmentDate = useCallback((segmentId: string | null): string => {
    if (!segmentId) return ''
    return findSegmentRef(segmentId)?.day.date ?? ''
  }, [findSegmentRef])

  const updateSegment = useCallback((segmentId: string, updater: (segment: RouteSegment) => RouteSegment) => {
    if (blockReadonlyWrite('updateSegment')) return
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => ({
        ...trip,
        days: trip.days.map((day) => ({
          ...day,
          routeSegments: day.routeSegments.map((segment) => (segment.id === segmentId ? updater(segment) : segment)),
        })),
      })),
    }))
  }, [blockReadonlyWrite, setTripReview])

  const updateSegmentMeta = useCallback((segmentId: string, patch: { name: string; date: string }) => {
    if (blockReadonlyWrite('updateSegmentMeta')) return
    const currentRef = findSegmentRef(segmentId)
    const savedSelection = currentRef
      ? getSavedSegmentSelection(currentRef, patch.date || currentRef.day.date)
      : null

    setTripReview((prev) => {
      const ref = findSegmentRef(segmentId, prev)
      if (!ref) return prev
      const nextName = patch.name.trim() ? patch.name : ref.segment.name
      const nextDate = patch.date || ref.day.date
      const movingDay = nextDate !== ref.day.date

      const nextTrips = prev.trips.map((trip, tripIndex) => {
        if (tripIndex !== ref.tripIndex) return trip

        if (!movingDay) {
          const days = trip.days.map((day, dayIndex) =>
            dayIndex !== ref.dayIndex
              ? day
              : {
                  ...day,
                  routeSegments: day.routeSegments.map((segment) =>
                    segment.id === segmentId ? { ...segment, name: nextName, date: nextDate } : segment,
                  ),
                },
          )
          return { ...trip, days }
        }

        const sourceDay = trip.days[ref.dayIndex]
        const movingSegment = sourceDay.routeSegments[ref.segmentIndex]
        const nextSegment = { ...movingSegment, name: nextName, date: nextDate }

        const daysWithoutSource = trip.days
          .map((day, dayIndex) => {
            if (dayIndex !== ref.dayIndex) return day
            const routeSegments = day.routeSegments.filter((segment) => segment.id !== segmentId)
            return { ...day, routeSegments }
          })
          .filter((day) => day.routeSegments.length > 0)

        const targetDayIndex = daysWithoutSource.findIndex((day) => day.date === nextDate)
        if (targetDayIndex >= 0) {
          const days = daysWithoutSource.map((day, dayIndex) =>
            dayIndex !== targetDayIndex ? day : { ...day, routeSegments: [...day.routeSegments, nextSegment] },
          )
          return { ...trip, days: sortTripDaysByDate(days) }
        }

        return {
          ...trip,
          days: sortTripDaysByDate([
            ...daysWithoutSource,
            { id: nextDate, date: nextDate, routeSegments: [nextSegment] },
          ]),
        }
      })

      return { trips: nextTrips }
    })

    setFilters((prev) => {
      if (prev.segmentId !== segmentId && activeSegmentId !== segmentId) return prev
      if (!savedSelection) return prev
      return { ...prev, dayId: savedSelection.dayId, segmentId: savedSelection.segmentId }
    })
  }, [activeSegmentId, blockReadonlyWrite, findSegmentRef, setFilters, setTripReview])

  const moveSegmentInTrip = useCallback((segmentId: string, direction: 'up' | 'down') => {
    if (blockReadonlyWrite('moveSegmentInTrip')) return
    setTripReview((prev) => {
      const ref = findSegmentRef(segmentId, prev)
      if (!ref) return prev

      const nextTrips = prev.trips.map((trip, tripIndex) => {
        if (tripIndex !== ref.tripIndex) return trip
        return {
          ...trip,
          days: trip.days.map((day, dayIndex) => {
            if (dayIndex !== ref.dayIndex) return day
            const nextRouteSegments = moveSegmentById(day.routeSegments, segmentId, direction)
            if (nextRouteSegments === day.routeSegments) return day
            return { ...day, routeSegments: nextRouteSegments }
          }),
        }
      })

      return { trips: nextTrips }
    })
  }, [blockReadonlyWrite, findSegmentRef, setTripReview])

  const canMoveSegment = useCallback((segmentId: string | null, direction: 'up' | 'down'): boolean => {
    if (!segmentId || !filters.tripId) return false
    const ref = findSegmentRef(segmentId)
    if (!ref || ref.trip.id !== filters.tripId) return false
    const current = ref.day.routeSegments.findIndex((segment) => segment.id === segmentId)
    const target = direction === 'up' ? current - 1 : current + 1
    return current >= 0 && target >= 0 && target < ref.day.routeSegments.length
  }, [filters.tripId, findSegmentRef])

  const reorderDaySegments = useCallback((tripId: string, dayId: string, orderedSegmentIds: string[]) => {
    if (blockReadonlyWrite('reorderDaySegments')) return
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => {
        if (trip.id !== tripId) return trip
        return {
          ...trip,
          days: trip.days.map((day) => {
            if (day.id !== dayId) return day
            const nextRouteSegments = reorderSegmentsById(day.routeSegments, orderedSegmentIds)
            if (nextRouteSegments === day.routeSegments) return day
            return { ...day, routeSegments: nextRouteSegments }
          }),
        }
      }),
    }))
  }, [blockReadonlyWrite, setTripReview])

  const addSegment = useCallback((payload: {
    tripId: string
    dayDate: string
    name: string
    startPoint: string
    endPoint: string
    waypoints: Waypoint[]
    preference: RoutePreference
    routeType: RouteType
    startCoord?: CoordPoint
    endCoord?: CoordPoint
    startPlaceId?: string
    endPlaceId?: string
    scenicScore?: number | null
    difficultyScore?: number | null
    note?: string
  }) => {
    if (blockReadonlyWrite('addSegment')) return
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => {
        if (trip.id !== payload.tripId) return trip

        const matchedDay = trip.days.find((day) => day.date === payload.dayDate)
        const nextSegment: RouteSegment = {
          id: createId('segment'),
          name: payload.name,
          date: payload.dayDate,
          startPoint: payload.startPoint,
          endPoint: payload.endPoint,
          waypoints: payload.waypoints.length ? payload.waypoints : undefined,
          preference: payload.preference,
          routeType: payload.routeType,
          startCoord: payload.startCoord,
          endCoord: payload.endCoord,
          startPlaceId: payload.startPlaceId,
          endPlaceId: payload.endPlaceId,
          order: matchedDay?.routeSegments.length ?? 0,
          scenicScore: normalizeScore(payload.scenicScore),
          difficultyScore: normalizeScore(payload.difficultyScore),
          note: normalizeSegmentNote(payload.note),
        }

        if (!matchedDay) {
          return {
            ...trip,
            days: sortTripDaysByDate([
              ...trip.days,
              { id: payload.dayDate, date: payload.dayDate, routeSegments: [nextSegment] },
            ]),
          }
        }

        return {
          ...trip,
          days: sortTripDaysByDate(
            trip.days.map((day) =>
              day.date !== payload.dayDate ? day : { ...day, routeSegments: [...day.routeSegments, nextSegment] },
            ),
          ),
        }
      }),
    }))
  }, [blockReadonlyWrite, setTripReview])

  const deleteSegment = useCallback(async (payload: { segmentId?: string; index: number; name: string }) => {
    if (blockReadonlyWrite('deleteSegment')) return
    const confirmed = await confirmDialog({
      title: '删除路段',
      message: `确定删除“${payload.name}”这段路段吗？此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return

    const fallbackSegment = listViewSegments[payload.index]
    const targetId = payload.segmentId ?? fallbackSegment?.id ?? null
    const targetSegment = targetId ? findSegmentRef(targetId)?.segment ?? fallbackSegment : fallbackSegment
    const deletedPhotoIds = targetSegment?.photoIds ?? []
    if (targetId) {
      void deleteSegmentRouteCache(targetId)
    }
    if (deletedPhotoIds.length > 0) onDeleteLinkedPhotos(deletedPhotoIds)

    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => ({
        ...trip,
        days: trip.days
          .map((day) => {
            let fallbackUsed = false
            const nextRouteSegments = day.routeSegments.filter((segment) => {
              if (payload.segmentId && segment.id) return segment.id !== payload.segmentId
              if (!fallbackSegment) return true
              if (!fallbackUsed && segment === fallbackSegment) {
                fallbackUsed = true
                return false
              }
              return true
            })
            return { ...day, routeSegments: nextRouteSegments }
          })
          .filter((day) => day.routeSegments.length > 0),
      })),
    }))

    if (targetId && editingSegmentId === targetId) setEditingSegmentId(null)
    if (targetId && editingWaypointSegmentId === targetId) {
      setEditingWaypointSegmentId(null)
      setWaypointDrafts([])
      setSelectedWaypointId(null)
    }
    if (targetId && editingEndpointsSegmentId === targetId) {
      setEditingEndpointsSegmentId(null)
      setEndpointDraft(null)
    }
  }, [blockReadonlyWrite, editingEndpointsSegmentId, editingSegmentId, editingWaypointSegmentId, findSegmentRef, listViewSegments, onDeleteLinkedPhotos, setEditingEndpointsSegmentId, setEditingSegmentId, setEditingWaypointSegmentId, setEndpointDraft, setSelectedWaypointId, setTripReview, setWaypointDrafts])

  return {
    getSegmentDate,
    updateSegment,
    updateSegmentMeta,
    moveSegmentInTrip,
    canMoveSegment,
    reorderDaySegments,
    addSegment,
    deleteSegment,
  }
}

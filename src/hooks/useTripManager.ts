import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { deleteSegmentRouteCache } from '../services/routeCacheDb'
import type {
  CoordPoint,
  FilterState,
  RoutePreference,
  RouteType,
  RouteSegment,
  Trip,
  TripCategory,
  TripDay,
  TripReview,
  Waypoint,
} from '../types/trip'
import { normalizeSegmentNote, normalizeScore } from '../utils/segmentScores'

interface SegmentRef {
  tripIndex: number
  dayIndex: number
  segmentIndex: number
  trip: Trip
  day: TripDay
  segment: RouteSegment
}

interface UseTripManagerParams {
  isReadonlyMode: boolean
  activeWorkspace: TripCategory
  filters: FilterState
  setFilters: Dispatch<SetStateAction<FilterState>>
  listViewSegments: RouteSegment[]
  workspaceTrips: Trip[]
  editingSegmentId: string | null
  setEditingSegmentId: Dispatch<SetStateAction<string | null>>
  editingWaypointSegmentId: string | null
  setEditingWaypointSegmentId: Dispatch<SetStateAction<string | null>>
  setWaypointDrafts: Dispatch<SetStateAction<Waypoint[]>>
  setSelectedWaypointId: Dispatch<SetStateAction<string | null>>
  editingEndpointsSegmentId: string | null
  setEditingEndpointsSegmentId: Dispatch<SetStateAction<string | null>>
  setEndpointDraft: Dispatch<SetStateAction<EndpointDraft | null>>
  setTripReview: Dispatch<SetStateAction<TripReview>>
  tripReview: TripReview
  activeSegmentId: string | null
}

export interface EndpointDraft {
  segmentId: string
  startPoint: string
  endPoint: string
  startCoord?: CoordPoint
  endCoord?: CoordPoint
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

export function useTripManager({
  isReadonlyMode,
  activeWorkspace,
  filters,
  setFilters,
  listViewSegments,
  workspaceTrips,
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
  tripReview,
  activeSegmentId,
}: UseTripManagerParams) {
  const blockReadonlyWrite = useCallback((actionName: string): boolean => {
    if (!isReadonlyMode) return false
    console.warn(`[readonly-demo] Blocked write action: ${actionName}`)
    return true
  }, [isReadonlyMode])

  const findSegmentRef = useCallback((segmentId: string, data = tripReview): SegmentRef | null => {
    for (let t = 0; t < data.trips.length; t += 1) {
      const trip = data.trips[t]
      for (let d = 0; d < trip.days.length; d += 1) {
        const day = trip.days[d]
        const segmentIndex = day.routeSegments.findIndex((segment) => segment.id === segmentId)
        if (segmentIndex >= 0) {
          return {
            tripIndex: t,
            dayIndex: d,
            segmentIndex,
            trip,
            day,
            segment: day.routeSegments[segmentIndex],
          }
        }
      }
    }
    return null
  }, [tripReview])

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
          return { ...trip, days }
        }

        return {
          ...trip,
          days: [...daysWithoutSource, { id: nextDate, date: nextDate, routeSegments: [nextSegment] }],
        }
      })

      return { trips: nextTrips }
    })

    setFilters((prev) => {
      if (prev.segmentId !== segmentId && activeSegmentId !== segmentId) return prev
      return { ...prev, dayId: patch.date || prev.dayId }
    })
  }, [activeSegmentId, blockReadonlyWrite, findSegmentRef, setFilters, setTripReview])

  const moveSegmentInTrip = useCallback((segmentId: string, direction: 'up' | 'down') => {
    if (blockReadonlyWrite('moveSegmentInTrip')) return
    setTripReview((prev) => {
      const ref = findSegmentRef(segmentId, prev)
      if (!ref) return prev

      const segmentIdsInTrip = ref.trip.days.flatMap((day) => day.routeSegments.map((segment) => segment.id))
      const currentFlatIndex = segmentIdsInTrip.findIndex((id) => id === segmentId)
      const nextFlatIndex = direction === 'up' ? currentFlatIndex - 1 : currentFlatIndex + 1
      if (currentFlatIndex < 0 || nextFlatIndex < 0 || nextFlatIndex >= segmentIdsInTrip.length) return prev

      const targetId = segmentIdsInTrip[nextFlatIndex]
      const targetRefInTrip = ref.trip.days
        .flatMap((day, dayIdx) => day.routeSegments.map((segment, segIdx) => ({ dayIdx, segIdx, id: segment.id })))
        .find((item) => item.id === targetId)

      if (!targetRefInTrip || targetRefInTrip.dayIdx !== ref.dayIndex) return prev

      const nextTrips = prev.trips.map((trip, tripIndex) => {
        if (tripIndex !== ref.tripIndex) return trip
        return {
          ...trip,
          days: trip.days.map((day, dayIndex) => {
            if (dayIndex !== ref.dayIndex) return day
            const nextRouteSegments = [...day.routeSegments]
            const [moved] = nextRouteSegments.splice(ref.segmentIndex, 1)
            nextRouteSegments.splice(targetRefInTrip.segIdx, 0, moved)
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
    const flat = ref.trip.days.flatMap((day) => day.routeSegments.map((segment) => ({ id: segment.id, dayId: day.id })))
    const current = flat.findIndex((item) => item.id === segmentId)
    const target = direction === 'up' ? current - 1 : current + 1
    if (current < 0 || target < 0 || target >= flat.length) return false
    return flat[target].dayId === ref.day.id
  }, [filters.tripId, findSegmentRef])

  const addTrip = useCallback((payload: { title: string; startDate: string; endDate: string }) => {
    if (blockReadonlyWrite('addTrip')) return
    setTripReview((prev) => ({
      trips: [
        ...prev.trips,
        {
          id: createId('trip'),
          title: payload.title,
          startDate: payload.startDate,
          endDate: payload.endDate,
          category: activeWorkspace,
          order: prev.trips.filter((trip) => trip.category === activeWorkspace).length,
          days: [],
        },
      ],
    }))
  }, [activeWorkspace, blockReadonlyWrite, setTripReview])

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
            days: [...trip.days, { id: payload.dayDate, date: payload.dayDate, routeSegments: [nextSegment] }],
          }
        }

        return {
          ...trip,
          days: trip.days.map((day) =>
            day.date !== payload.dayDate ? day : { ...day, routeSegments: [...day.routeSegments, nextSegment] },
          ),
        }
      }),
    }))
  }, [blockReadonlyWrite, setTripReview])

  const deleteSegment = useCallback((payload: { segmentId?: string; index: number; name: string }) => {
    if (blockReadonlyWrite('deleteSegment')) return
    const confirmed = window.confirm(`确定删除“${payload.name}”这段路段吗？此操作不可恢复。`)
    if (!confirmed) return

    const fallbackSegment = listViewSegments[payload.index]
    const targetId = payload.segmentId ?? fallbackSegment?.id ?? null
    if (targetId) {
      void deleteSegmentRouteCache(targetId)
    }

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
  }, [blockReadonlyWrite, editingEndpointsSegmentId, editingSegmentId, editingWaypointSegmentId, listViewSegments, setEditingEndpointsSegmentId, setEditingSegmentId, setEditingWaypointSegmentId, setEndpointDraft, setSelectedWaypointId, setTripReview, setWaypointDrafts])

  const deleteTrip = useCallback((tripId: string) => {
    if (blockReadonlyWrite('deleteTrip')) return
    const target = workspaceTrips.find((trip) => trip.id === tripId)
    if (!target) return

    const deletedSegmentIds = new Set(target.days.flatMap((day) => day.routeSegments.map((segment) => segment.id)))
    const segmentCount = target.days.reduce((sum, day) => sum + day.routeSegments.length, 0)
    const confirmed = window.confirm(
      `确定删除旅程“${target.title}”吗？将同时删除该旅程下的全部日期与路段数据（${segmentCount} 条路段）。此操作不可恢复。`,
    )
    if (!confirmed) return

    for (const segmentId of deletedSegmentIds) {
      void deleteSegmentRouteCache(segmentId)
    }

    setTripReview((prev) => ({ trips: prev.trips.filter((trip) => trip.id !== tripId) }))

    if (filters.tripId === tripId) {
      setFilters({ tripId: '', dayId: '', segmentId: '' })
    }

    if (editingSegmentId && deletedSegmentIds.has(editingSegmentId)) setEditingSegmentId(null)
    if (editingWaypointSegmentId && deletedSegmentIds.has(editingWaypointSegmentId)) {
      setEditingWaypointSegmentId(null)
      setWaypointDrafts([])
      setSelectedWaypointId(null)
    }
    if (editingEndpointsSegmentId && deletedSegmentIds.has(editingEndpointsSegmentId)) {
      setEditingEndpointsSegmentId(null)
      setEndpointDraft(null)
    }
  }, [blockReadonlyWrite, editingEndpointsSegmentId, editingSegmentId, editingWaypointSegmentId, filters.tripId, setEditingEndpointsSegmentId, setEditingSegmentId, setEditingWaypointSegmentId, setEndpointDraft, setFilters, setSelectedWaypointId, setTripReview, setWaypointDrafts, workspaceTrips])

  const updateTrip = useCallback((tripId: string, patch: { title: string; startDate: string; endDate: string }): boolean => {
    if (blockReadonlyWrite('updateTrip')) return false
    if (patch.endDate < patch.startDate) return false
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) =>
        trip.id === tripId
          ? { ...trip, title: patch.title, startDate: patch.startDate, endDate: patch.endDate }
          : trip,
      ),
    }))
    return true
  }, [blockReadonlyWrite, setTripReview])

  const moveTrip = useCallback((tripId: string, direction: 'up' | 'down') => {
    if (blockReadonlyWrite('moveTrip')) return
    setTripReview((prev) => {
      const scopedTrips = prev.trips.filter((trip) => trip.category === activeWorkspace)
      const idx = scopedTrips.findIndex((trip) => trip.id === tripId)
      if (idx < 0) return prev
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= scopedTrips.length) return prev

      const movedScoped = [...scopedTrips]
      const [moved] = movedScoped.splice(idx, 1)
      movedScoped.splice(target, 0, moved)
      const orderMap = new Map(movedScoped.map((trip, order) => [trip.id, order]))

      return {
        trips: prev.trips.map((trip) =>
          trip.category === activeWorkspace ? { ...trip, order: orderMap.get(trip.id) ?? trip.order } : trip,
        ),
      }
    })
  }, [activeWorkspace, blockReadonlyWrite, setTripReview])

  const reorderTrips = useCallback((orderedTripIds: string[]) => {
    if (blockReadonlyWrite('reorderTrips')) return
    setTripReview((prev) => {
      const scopedTrips = prev.trips.filter((trip) => trip.category === activeWorkspace)
      if (orderedTripIds.length !== scopedTrips.length) return prev
      const scopedMap = new Map(scopedTrips.map((trip) => [trip.id, trip]))
      const orderedScoped = orderedTripIds
        .map((id) => scopedMap.get(id))
        .filter((trip): trip is (typeof prev.trips)[number] => Boolean(trip))
      if (orderedScoped.length !== scopedTrips.length) return prev

      const orderMap = new Map(orderedScoped.map((trip, order) => [trip.id, order]))
      return {
        trips: prev.trips.map((trip) =>
          trip.category === activeWorkspace ? { ...trip, order: orderMap.get(trip.id) ?? trip.order } : trip,
        ),
      }
    })
  }, [activeWorkspace, blockReadonlyWrite, setTripReview])

  return {
    findSegmentRef,
    getSegmentDate,
    addTrip,
    addSegment,
    updateSegment,
    updateSegmentMeta,
    moveSegmentInTrip,
    canMoveSegment,
    deleteSegment,
    deleteTrip,
    updateTrip,
    moveTrip,
    reorderTrips,
    createId,
  }
}

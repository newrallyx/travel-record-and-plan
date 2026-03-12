import { useCallback, useEffect, useMemo, useState } from 'react'
import FilterPanel from './components/FilterPanel'
import MapPlaceholder from './components/MapPlaceholder'
import MapPanel from './components/MapPanel'
import TripEditor from './components/TripEditor'
import TripManageModal from './components/TripManageModal'
import { useFilteredSegments } from './hooks/useFilteredSegments'
import { loadTripReview, saveTripReview } from './services/tripStorage'
import { deleteSegmentRouteCache, getSegmentRouteCache } from './services/routeCacheDb'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters, getTripDistanceMeters } from './utils/distance'
import { buildSegmentRouteKey } from './utils/routeBuildKey'
import type {
  CoordPoint,
  FilterState,
  RoutePreference,
  RouteType,
  RouteSegment,
  RouteSummary,
  Trip,
  TripCategory,
  TripDay,
  TripReview,
  Waypoint,
} from './types/trip'
import './styles/app.css'

interface EndpointDraft {
  segmentId: string
  startPoint: string
  endPoint: string
  startCoord?: CoordPoint
  endCoord?: CoordPoint
}

interface SegmentMetaDraft {
  segmentId: string
  name: string
  date: string
}

interface SegmentRef {
  tripIndex: number
  dayIndex: number
  segmentIndex: number
  trip: Trip
  day: TripDay
  segment: RouteSegment
}

function App() {
  const [tripReview, setTripReview] = useState<TripReview>(() => loadTripReview())
  const [activeWorkspace, setActiveWorkspace] = useState<TripCategory>('review')
  const [filters, setFilters] = useState<FilterState>({ tripId: '', dayId: '', segmentId: '' })
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null)

  const [editingWaypointSegmentId, setEditingWaypointSegmentId] = useState<string | null>(null)
  const [waypointDrafts, setWaypointDrafts] = useState<Waypoint[]>([])

  const [editingEndpointsSegmentId, setEditingEndpointsSegmentId] = useState<string | null>(null)
  const [endpointDraft, setEndpointDraft] = useState<EndpointDraft | null>(null)
  const [segmentMetaDraft, setSegmentMetaDraft] = useState<SegmentMetaDraft | null>(null)
  const [tripManagerOpen, setTripManagerOpen] = useState(false)

  useEffect(() => {
    saveTripReview(tripReview)
  }, [tripReview])

  useEffect(() => {
    let cancelled = false

    async function hydrateSegmentRouteCache() {
      try {
        const patchMap = new Map<string, CoordPoint[]>()

        for (const trip of tripReview.trips) {
          for (const day of trip.days) {
            for (const segment of day.routeSegments) {
              const cache = await getSegmentRouteCache(segment.id)
              if (!cache) continue

              const buildKey = buildSegmentRouteKey(segment)
              if (cache.routeBuildKey !== buildKey) continue

              const samePoints =
                Array.isArray(segment.points) &&
                segment.points.length === cache.points.length &&
                segment.points.every((point, idx) => point.lat === cache.points[idx].lat && point.lon === cache.points[idx].lon)

              if (!samePoints) {
                patchMap.set(segment.id, cache.points)
              }
            }
          }
        }

        if (cancelled || patchMap.size === 0) return

        setTripReview((prev) => {
          let changed = false
          const nextTrips = prev.trips.map((trip) => {
            let tripChanged = false
            const nextDays = trip.days.map((day) => {
              let dayChanged = false
              const nextSegments = day.routeSegments.map((segment) => {
                const points = patchMap.get(segment.id)
                if (!points) return segment

                changed = true
                dayChanged = true
                tripChanged = true
                return { ...segment, points }
              })
              return dayChanged ? { ...day, routeSegments: nextSegments } : day
            })
            return tripChanged ? { ...trip, days: nextDays } : trip
          })

          return changed ? { trips: nextTrips } : prev
        })
      } catch (error) {
        console.error('[App] Failed to hydrate route cache from IndexedDB.', error)
      }
    }

    void hydrateSegmentRouteCache()

    return () => {
      cancelled = true
    }
  }, [tripReview.trips])

  const workspaceTrips = useMemo(
    () =>
      tripReview.trips
        .filter((trip) => trip.category === activeWorkspace)
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)),
    [tripReview.trips, activeWorkspace],
  )

  useEffect(() => {
    setFilters((prev) => {
      const firstTrip = workspaceTrips[0]
      if (!firstTrip) return { tripId: '', dayId: '', segmentId: '' }

      const selectedTrip = workspaceTrips.find((trip) => trip.id === prev.tripId) ?? firstTrip
      const selectedDay = selectedTrip.days.find((day) => day.id === prev.dayId) ?? selectedTrip.days[0]
      const selectedSegment = selectedDay?.routeSegments.find((segment) => segment.id === prev.segmentId) ?? selectedDay?.routeSegments[0]

      return {
        tripId: selectedTrip.id,
        dayId: selectedDay?.id ?? '',
        segmentId: selectedSegment?.id ?? '',
      }
    })

    setEditingSegmentId(null)
    setSelectedWaypointId(null)
    setEditingWaypointSegmentId(null)
    setWaypointDrafts([])
    setEditingEndpointsSegmentId(null)
    setEndpointDraft(null)
    setSegmentMetaDraft(null)
  }, [activeWorkspace, workspaceTrips])

  const isAllTripsSelected = !filters.tripId
  // 占位区和底图渲染逻辑解耦：all 时占位区展示旅程列表，底图仍渲染 mapRenderSegments 总览轨迹。
  const placeholderMode: 'trip-list' | 'segment-list' = isAllTripsSelected ? 'trip-list' : 'segment-list'

  const mapRenderSegments = useFilteredSegments(workspaceTrips, filters)
  const listViewSegments = placeholderMode === 'segment-list' ? mapRenderSegments : []

  const selectedTrip = useMemo(() => workspaceTrips.find((trip) => trip.id === filters.tripId) ?? null, [workspaceTrips, filters.tripId])
  const selectedDay = useMemo(
    () => selectedTrip?.days.find((day) => day.id === filters.dayId) ?? null,
    [selectedTrip, filters.dayId],
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
      })),
    [workspaceTrips],
  )

  const tripDistanceText = useMemo(() => formatDistance(selectedTrip ? getTripDistanceMeters(selectedTrip) : null), [selectedTrip])
  const dayDistanceText = useMemo(() => formatDistance(selectedDay ? getDayDistanceMeters(selectedDay.routeSegments) : null), [selectedDay])

  const filterContext = useMemo(() => {
    const selectedTrip = workspaceTrips.find((trip) => trip.id === filters.tripId)
    const selectedDay = selectedTrip?.days.find((day) => day.id === filters.dayId)
    const selectedSegment = selectedDay?.routeSegments.find((segment) => segment.id === filters.segmentId)

    return {
      tripName: selectedTrip?.title ?? '全部旅程',
      dayDate: selectedDay?.date ?? '全部日期',
      segmentName: selectedSegment?.name ?? '全部路段',
    }
  }, [workspaceTrips, filters.tripId, filters.dayId, filters.segmentId])

  const activeSegmentId = useMemo(() => {
    if (editingSegmentId && listViewSegments.some((segment) => segment.id === editingSegmentId)) {
      return editingSegmentId
    }
    if (filters.segmentId && listViewSegments.some((segment) => segment.id === filters.segmentId)) {
      return filters.segmentId
    }
    return null
  }, [listViewSegments, editingSegmentId, filters.segmentId])

  const activeSegment = useMemo(
    () => listViewSegments.find((segment) => segment.id === activeSegmentId) ?? null,
    [listViewSegments, activeSegmentId],
  )

  const summary: RouteSummary = useMemo(
    () => ({ totalDistanceText: formatDistance(activeSegment ? getTrackDistanceMeters(activeSegment) : null) }),
    [activeSegment],
  )

  const displayedWaypoints = useMemo<Waypoint[]>(() => {
    if (!activeSegment) return []
    return activeSegment.waypoints ?? []
  }, [activeSegment])

  const selectedWaypoint = useMemo(() => {
    const source = editingWaypointSegmentId === activeSegmentId ? waypointDrafts : displayedWaypoints
    return source.find((waypoint) => waypoint.id === selectedWaypointId) ?? null
  }, [displayedWaypoints, editingWaypointSegmentId, activeSegmentId, waypointDrafts, selectedWaypointId])

  const effectiveEndpointDraft = useMemo(() => {
    if (!endpointDraft || endpointDraft.segmentId !== activeSegmentId) return null
    return endpointDraft
  }, [endpointDraft, activeSegmentId])

  const findSegmentRef = (segmentId: string, data = tripReview): SegmentRef | null => {
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
  }

  const getSegmentDate = (segmentId: string | null): string => {
    if (!segmentId) return ''
    return findSegmentRef(segmentId)?.day.date ?? ''
  }

  const activeSegmentDate = useMemo(() => getSegmentDate(activeSegmentId), [activeSegmentId, tripReview])

  const moveSegmentInTrip = (segmentId: string, direction: 'up' | 'down') => {
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
            const insertIndex = direction === 'up' ? targetRefInTrip.segIdx : targetRefInTrip.segIdx
            nextRouteSegments.splice(insertIndex, 0, moved)
            return { ...day, routeSegments: nextRouteSegments }
          }),
        }
      })

      return { trips: nextTrips }
    })
  }

  const canMoveSegment = (segmentId: string | null, direction: 'up' | 'down'): boolean => {
    if (!segmentId || !filters.tripId) return false
    const ref = findSegmentRef(segmentId)
    if (!ref || ref.trip.id !== filters.tripId) return false
    const flat = ref.trip.days.flatMap((day) => day.routeSegments.map((segment) => ({ id: segment.id, dayId: day.id })))
    const current = flat.findIndex((item) => item.id === segmentId)
    const target = direction === 'up' ? current - 1 : current + 1
    if (current < 0 || target < 0 || target >= flat.length) return false
    return flat[target].dayId === ref.day.id
  }
  const addTrip = (payload: { title: string; startDate: string; endDate: string }) => {
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
  }

  const addSegment = (payload: {
    tripId: string
    dayDate: string
    name: string
    startPoint: string
    endPoint: string
    viaPointsText: string
    preference: RoutePreference
    routeType: RouteType
    startCoord?: CoordPoint
    endCoord?: CoordPoint
    startPlaceId?: string
    endPlaceId?: string
  }) => {
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
          viaPointsText: payload.viaPointsText,
          preference: payload.preference,
          routeType: payload.routeType,
          startCoord: payload.startCoord,
          endCoord: payload.endCoord,
          startPlaceId: payload.startPlaceId,
          endPlaceId: payload.endPlaceId,
          order: matchedDay?.routeSegments.length ?? 0,
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
  }

  const updateSegment = (segmentId: string, updater: (segment: RouteSegment) => RouteSegment) => {
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => ({
        ...trip,
        days: trip.days.map((day) => ({
          ...day,
          routeSegments: day.routeSegments.map((segment) => (segment.id === segmentId ? updater(segment) : segment)),
        })),
      })),
    }))
  }

  const updateSegmentMeta = (segmentId: string, patch: { name: string; date: string }) => {
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

        const movedSegment = { ...ref.segment, name: nextName, date: nextDate }
        const daysAfterRemoval = trip.days
          .map((day, dayIndex) =>
            dayIndex !== ref.dayIndex
              ? day
              : { ...day, routeSegments: day.routeSegments.filter((segment) => segment.id !== segmentId) },
          )
          .filter((day) => day.routeSegments.length > 0)

        const targetDayIndex = daysAfterRemoval.findIndex((day) => day.date === nextDate)
        const days =
          targetDayIndex >= 0
            ? daysAfterRemoval.map((day, idx) =>
                idx !== targetDayIndex ? day : { ...day, routeSegments: [...day.routeSegments, movedSegment] },
              )
            : [...daysAfterRemoval, { id: nextDate, date: nextDate, routeSegments: [movedSegment] }]

        return { ...trip, days: days.sort((a, b) => a.date.localeCompare(b.date)) }
      })

      return { trips: nextTrips }
    })

    setFilters((prev) => {
      if (prev.segmentId !== segmentId && activeSegmentId !== segmentId) return prev
      return { ...prev, dayId: patch.date || prev.dayId }
    })
  }

  const saveSegmentTrack = (payload: {
    segmentId: string
    startCoord: CoordPoint
    endCoord: CoordPoint
    points: CoordPoint[]
  }) => {
    updateSegment(payload.segmentId, (segment) => {
      const nextSegment = {
        ...segment,
        startCoord: payload.startCoord,
        endCoord: payload.endCoord,
        points: payload.points,
      }
      return { ...nextSegment, routeBuildKey: buildSegmentRouteKey(nextSegment) }
    })
    setEditingSegmentId(null)
  }

  const saveResolvedRoutes = useCallback(
    (
      patches: Array<{
        segmentId: string
        points: CoordPoint[]
        distanceMeters: number | null
        routeBuildKey: string
      }>,
    ) => {
      if (!patches.length) return
      const patchMap = new Map(patches.map((item) => [item.segmentId, item]))

      setTripReview((prev) => {
        let changed = false

        const nextTrips = prev.trips.map((trip) => {
          let tripChanged = false
          const nextDays = trip.days.map((day) => {
            let dayChanged = false
            const nextSegments = day.routeSegments.map((segment) => {
              const patch = patchMap.get(segment.id)
              if (!patch) return segment

              const sameDistance =
                (typeof segment.distanceMeters === 'number' ? segment.distanceMeters : null) ===
                (typeof patch.distanceMeters === 'number' ? Math.round(patch.distanceMeters) : null)
              const sameRouteKey = segment.routeBuildKey === patch.routeBuildKey
              const samePoints =
                Array.isArray(segment.points) &&
                segment.points.length === patch.points.length &&
                segment.points.every((point, idx) => point.lat === patch.points[idx].lat && point.lon === patch.points[idx].lon)

              if (sameDistance && sameRouteKey && samePoints) return segment

              changed = true
              dayChanged = true
              tripChanged = true

              return {
                ...segment,
                points: patch.points,
                distanceMeters: typeof patch.distanceMeters === 'number' ? Math.round(patch.distanceMeters) : segment.distanceMeters,
                routeBuildKey: patch.routeBuildKey,
              }
            })
            return dayChanged ? { ...day, routeSegments: nextSegments } : day
          })
          return tripChanged ? { ...trip, days: nextDays } : trip
        })

        return changed ? { trips: nextTrips } : prev
      })
    },
    [],
  )

  const startSegmentMetaEdit = (segmentId: string) => {
    const ref = findSegmentRef(segmentId)
    if (!ref) return
    setSegmentMetaDraft({ segmentId, name: ref.segment.name, date: ref.day.date })
  }

  const cancelSegmentMetaEdit = () => {
    setSegmentMetaDraft(null)
  }

  const saveSegmentMetaEdit = () => {
    if (!segmentMetaDraft) return
    updateSegmentMeta(segmentMetaDraft.segmentId, { name: segmentMetaDraft.name, date: segmentMetaDraft.date })
    setSegmentMetaDraft(null)
  }

  const startWaypointEdit = (segmentId: string) => {
    const target = listViewSegments.find((segment) => segment.id === segmentId)
    setEditingWaypointSegmentId(segmentId)
    setWaypointDrafts([...(target?.waypoints ?? [])])
  }

  const saveWaypoints = () => {
    if (!editingWaypointSegmentId) return
    updateSegment(editingWaypointSegmentId, (segment) => ({ ...segment, waypoints: waypointDrafts }))
    setEditingWaypointSegmentId(null)
    setWaypointDrafts([])
  }

  const startEndpointsEdit = (segmentId: string) => {
    const target = listViewSegments.find((segment) => segment.id === segmentId)
    if (!target) return
    setEditingEndpointsSegmentId(segmentId)
    setEndpointDraft({
      segmentId,
      startPoint: target.startPoint,
      endPoint: target.endPoint,
      startCoord: target.startCoord,
      endCoord: target.endCoord,
    })
  }

  const saveEndpoints = () => {
    if (!editingEndpointsSegmentId || !endpointDraft) return

    updateSegment(editingEndpointsSegmentId, (segment) => {
      const nextPoints = segment.points ? [...segment.points] : undefined
      if (nextPoints?.length && endpointDraft.startCoord) nextPoints[0] = endpointDraft.startCoord
      if (nextPoints?.length && endpointDraft.endCoord) nextPoints[nextPoints.length - 1] = endpointDraft.endCoord

      return {
        ...segment,
        startPoint: endpointDraft.startPoint,
        endPoint: endpointDraft.endPoint,
        startCoord: endpointDraft.startCoord,
        endCoord: endpointDraft.endCoord,
        points: nextPoints,
      }
    })

    setEditingEndpointsSegmentId(null)
    setEndpointDraft(null)
  }

  const deleteSegment = (payload: { segmentId?: string; index: number; name: string }) => {
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

    if (targetId && editingSegmentId === targetId) {
      setEditingSegmentId(null)
    }

    if (targetId && editingWaypointSegmentId === targetId) {
      setEditingWaypointSegmentId(null)
      setWaypointDrafts([])
      setSelectedWaypointId(null)
    }

    if (targetId && editingEndpointsSegmentId === targetId) {
      setEditingEndpointsSegmentId(null)
      setEndpointDraft(null)
    }
  }

  const deleteTrip = (tripId: string) => {
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

    setTripReview((prev) => ({
      trips: prev.trips.filter((trip) => trip.id !== tripId),
    }))

    if (filters.tripId === tripId) {
      setFilters({ tripId: '', dayId: '', segmentId: '' })
    }

    if (editingSegmentId && deletedSegmentIds.has(editingSegmentId)) {
      setEditingSegmentId(null)
    }
    if (editingWaypointSegmentId && deletedSegmentIds.has(editingWaypointSegmentId)) {
      setEditingWaypointSegmentId(null)
      setWaypointDrafts([])
      setSelectedWaypointId(null)
    }
    if (editingEndpointsSegmentId && deletedSegmentIds.has(editingEndpointsSegmentId)) {
      setEditingEndpointsSegmentId(null)
      setEndpointDraft(null)
    }
  }

  const updateTrip = (tripId: string, patch: { title: string; startDate: string; endDate: string }): boolean => {
    if (patch.endDate < patch.startDate) return false
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              title: patch.title,
              startDate: patch.startDate,
              endDate: patch.endDate,
            }
          : trip,
      ),
    }))
    return true
  }

  const moveTrip = (tripId: string, direction: 'up' | 'down') => {
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
  }

  const reorderTrips = (orderedTripIds: string[]) => {
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
  }

  const routePreferenceValue = activeSegment?.preference ?? 'HIGHWAY_FIRST'
  const routeModeValue = activeSegment?.routeType ?? 'DRIVING'

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>自驾旅行记录与规划工具（开发中）</h1>
        <div className="workspace-tabs" role="tablist" aria-label="总分类">
          <button
            type="button"
            className={activeWorkspace === 'review' ? 'active' : ''}
            onClick={() => setActiveWorkspace('review')}
          >
            复盘
          </button>
          <button
            type="button"
            className={activeWorkspace === 'plan' ? 'active' : ''}
            onClick={() => setActiveWorkspace('plan')}
          >
            规划
          </button>
        </div>
      </header>

      <TripEditor trips={workspaceTrips} onAddTrip={addTrip} onAddSegment={addSegment} />

      <FilterPanel
        trips={workspaceTrips}
        filters={filters}
        onChange={setFilters}
        onOpenTripManager={() => setTripManagerOpen(true)}
        tripDistanceText={tripDistanceText}
        dayDistanceText={dayDistanceText}
      />

      <TripManageModal
        open={tripManagerOpen}
        trips={workspaceTrips}
        onClose={() => setTripManagerOpen(false)}
        onDeleteTrip={deleteTrip}
        onMoveTrip={moveTrip}
        onReorderTrips={reorderTrips}
        onUpdateTrip={updateTrip}
      />

      <MapPlaceholder
        placeholderMode={placeholderMode}
        tripListItems={tripListItems}
        onViewTrip={(tripId) => setFilters({ tripId, dayId: '', segmentId: '' })}
        onOpenTripManager={() => setTripManagerOpen(true)}
        onDeleteTrip={deleteTrip}
        filteredSegments={listViewSegments}
        summary={summary}
        filterContext={filterContext}
        editingSegmentId={editingSegmentId}
        activeSegmentId={activeSegmentId}
        activeSegment={activeSegment}
        activeSegmentDate={activeSegmentDate}
        segmentMetaDraft={segmentMetaDraft}
        onEditSegment={(segmentId) => setEditingSegmentId(segmentId)}
        onDeleteSegment={deleteSegment}
        onStartSegmentMetaEdit={startSegmentMetaEdit}
        onCancelSegmentMetaEdit={cancelSegmentMetaEdit}
        onSaveSegmentMetaEdit={saveSegmentMetaEdit}
        onUpdateSegmentMetaDraft={(patch) => {
          setSegmentMetaDraft((prev) => (prev ? { ...prev, ...patch } : prev))
        }}
        routePreference={routePreferenceValue}
        routeMode={routeModeValue}
        onChangeRouteMode={(value) => {
          if (!activeSegmentId) return
          updateSegment(activeSegmentId, (segment) => ({ ...segment, routeType: value }))
        }}
        onChangeRoutePreference={(value) => {
          if (!activeSegmentId) return
          updateSegment(activeSegmentId, (segment) => ({ ...segment, preference: value }))
        }}
        onMoveSegmentInTrip={moveSegmentInTrip}
        canMoveSegmentUp={canMoveSegment(activeSegmentId, 'up')}
        canMoveSegmentDown={canMoveSegment(activeSegmentId, 'down')}
        waypoints={editingWaypointSegmentId === activeSegmentId ? waypointDrafts : displayedWaypoints}
        onLocateWaypoint={(waypoint) => setSelectedWaypointId(waypoint.id)}
        waypointEditMode={editingWaypointSegmentId === activeSegmentId}
        onStartWaypointEdit={() => {
          if (activeSegmentId) startWaypointEdit(activeSegmentId)
        }}
        onCancelWaypointEdit={() => {
          setEditingWaypointSegmentId(null)
          setWaypointDrafts([])
        }}
        onSaveWaypoints={saveWaypoints}
        onAddWaypoint={() => {
          setWaypointDrafts((prev) => [...prev, { id: createId('wp'), name: '' }])
        }}
        onUpdateWaypointName={(id, name) => {
          setWaypointDrafts((prev) =>
            prev.map((item) => (item.id === id ? { ...item, name, lat: undefined, lng: undefined, amapId: undefined } : item)),
          )
        }}
        onSelectWaypointPlace={(id, payload) => {
          setWaypointDrafts((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, name: payload.label, lat: payload.lat, lng: payload.lng, amapId: payload.amapId }
                : item,
            ),
          )
        }}
        onMoveWaypoint={(id, direction) => {
          setWaypointDrafts((prev) => {
            const idx = prev.findIndex((item) => item.id === id)
            if (idx < 0) return prev
            const target = direction === 'up' ? idx - 1 : idx + 1
            if (target < 0 || target >= prev.length) return prev
            const cloned = [...prev]
            const [item] = cloned.splice(idx, 1)
            cloned.splice(target, 0, item)
            return cloned
          })
        }}
        onDeleteWaypoint={(id) => {
          setWaypointDrafts((prev) => prev.filter((item) => item.id !== id))
        }}
        endpointEditMode={editingEndpointsSegmentId === activeSegmentId}
        endpointDraft={effectiveEndpointDraft}
        onStartEndpointEdit={() => {
          if (activeSegmentId) startEndpointsEdit(activeSegmentId)
        }}
        onCancelEndpointEdit={() => {
          setEditingEndpointsSegmentId(null)
          setEndpointDraft(null)
        }}
        onSaveEndpoints={saveEndpoints}
        onUpdateEndpointText={(field, text) => {
          setEndpointDraft((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              [field]: text,
              ...(field === 'startPoint' ? { startCoord: undefined } : { endCoord: undefined }),
            }
          })
        }}
        onSelectEndpointPlace={(field, payload) => {
          setEndpointDraft((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              [field]: payload.label,
              ...(field === 'startPoint'
                ? { startCoord: { lat: payload.lat, lon: payload.lng } }
                : { endCoord: { lat: payload.lat, lon: payload.lng } }),
            }
          })
        }}
      />

      <MapPanel
        filteredSegments={mapRenderSegments}
        editingSegmentId={editingSegmentId}
        onStartEdit={(segmentId) => setEditingSegmentId(segmentId)}
        onCancelEdit={() => setEditingSegmentId(null)}
        onSaveEdit={saveSegmentTrack}
        selectedWaypoint={selectedWaypoint}
        onRouteResolved={saveResolvedRoutes}
        allowAutoBuild={Boolean(filters.tripId)}
        onEndpointDraftChange={(payload) => {
          setEndpointDraft((prev) => {
            if (!prev || prev.segmentId !== payload.segmentId) return prev
            return {
              ...prev,
              startCoord: payload.startCoord,
              endCoord: payload.endCoord,
            }
          })
        }}
      />
    </main>
  )
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

export default App

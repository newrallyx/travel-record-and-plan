import { useEffect, useMemo, useState } from 'react'
import FilterPanel from './components/FilterPanel'
import MapPlaceholder from './components/MapPlaceholder'
import MapPanel from './components/MapPanel'
import TripEditor from './components/TripEditor'
import TripManageModal from './components/TripManageModal'
import { useFilteredSegments } from './hooks/useFilteredSegments'
import { loadTripReview, saveTripReview } from './services/tripStorage'
import type {
  CoordPoint,
  FilterState,
  RoutePreference,
  RouteType,
  RouteSegment,
  RouteSummary,
  Trip,
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
  const [filters, setFilters] = useState<FilterState>({ tripId: '', dayId: '', segmentId: '' })
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null)
  const [, setSegmentTrackPoints] = useState<Record<string, CoordPoint[]>>({})

  const [editingWaypointSegmentId, setEditingWaypointSegmentId] = useState<string | null>(null)
  const [waypointDrafts, setWaypointDrafts] = useState<Waypoint[]>([])

  const [editingEndpointsSegmentId, setEditingEndpointsSegmentId] = useState<string | null>(null)
  const [endpointDraft, setEndpointDraft] = useState<EndpointDraft | null>(null)
  const [tripManagerOpen, setTripManagerOpen] = useState(false)

  useEffect(() => {
    saveTripReview(tripReview)
  }, [tripReview])

  const isAllTripsSelected = !filters.tripId
  // 占位区和底图渲染逻辑解耦：all 时占位区展示旅程列表，底图仍渲染 mapRenderSegments 总览轨迹。
  const placeholderMode: 'trip-list' | 'segment-list' = isAllTripsSelected ? 'trip-list' : 'segment-list'

  const mapRenderSegments = useFilteredSegments(tripReview.trips, filters)
  const listViewSegments = placeholderMode === 'segment-list' ? mapRenderSegments : []

  const summary: RouteSummary = useMemo(
    () => ({ totalDistanceText: '待生成', totalDurationText: '待生成' }),
    [],
  )

  const tripListItems = useMemo(
    () =>
      tripReview.trips.map((trip) => ({
        id: trip.id,
        title: trip.title,
        startDate: trip.startDate,
        endDate: trip.endDate,
        segmentCount: trip.days.reduce((sum, day) => sum + day.routeSegments.length, 0),
      })),
    [tripReview.trips],
  )

  const filterContext = useMemo(() => {
    const selectedTrip = tripReview.trips.find((trip) => trip.id === filters.tripId)
    const selectedDay = selectedTrip?.days.find((day) => day.id === filters.dayId)
    const selectedSegment = selectedDay?.routeSegments.find((segment) => segment.id === filters.segmentId)

    return {
      tripName: selectedTrip?.title ?? '全部旅程',
      dayDate: selectedDay?.date ?? '全部日期',
      segmentName: selectedSegment?.name ?? '全部路段',
    }
  }, [tripReview.trips, filters.tripId, filters.dayId, filters.segmentId])

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
          order: prev.trips.length,
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
    updateSegment(payload.segmentId, (segment) => ({
      ...segment,
      startCoord: payload.startCoord,
      endCoord: payload.endCoord,
      points: payload.points,
    }))
    setEditingSegmentId(null)
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

    const targetId = payload.segmentId ?? fallbackSegment?.id ?? null

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
    const target = tripReview.trips.find((trip) => trip.id === tripId)
    if (!target) return

    const segmentCount = target.days.reduce((sum, day) => sum + day.routeSegments.length, 0)
    const confirmed = window.confirm(
      `确定删除旅程“${target.title}”吗？将同时删除该旅程下的全部日期与路段数据（${segmentCount} 条路段）。此操作不可恢复。`,
    )
    if (!confirmed) return

    setTripReview((prev) => ({
      trips: prev.trips.filter((trip) => trip.id !== tripId),
    }))

    if (filters.tripId === tripId) {
      setFilters({ tripId: '', dayId: '', segmentId: '' })
    }

    const deletedSegmentIds = new Set(target.days.flatMap((day) => day.routeSegments.map((segment) => segment.id)))
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
      const idx = prev.trips.findIndex((trip) => trip.id === tripId)
      if (idx < 0) return prev
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= prev.trips.length) return prev
      const nextTrips = [...prev.trips]
      const [moved] = nextTrips.splice(idx, 1)
      nextTrips.splice(target, 0, moved)
      return { trips: nextTrips.map((trip, order) => ({ ...trip, order })) }
    })
  }

  const reorderTrips = (orderedTripIds: string[]) => {
    setTripReview((prev) => {
      if (orderedTripIds.length !== prev.trips.length) return prev
      const map = new Map(prev.trips.map((trip) => [trip.id, trip]))
      const nextTrips = orderedTripIds
        .map((id) => map.get(id))
        .filter((trip): trip is (typeof prev.trips)[number] => Boolean(trip))
      if (nextTrips.length !== prev.trips.length) return prev
      return { trips: nextTrips.map((trip, order) => ({ ...trip, order })) }
    })
  }

  const routePreferenceValue = activeSegment?.preference ?? 'HIGHWAY_FIRST'
  const routeModeValue = activeSegment?.routeType ?? 'DRIVING'

  return (
    <main className="app-shell">
      <h1>自驾旅行复盘工具（开发中）</h1>

      <TripEditor trips={tripReview.trips} onAddTrip={addTrip} onAddSegment={addSegment} />

      <FilterPanel
        trips={tripReview.trips}
        filters={filters}
        onChange={setFilters}
        onOpenTripManager={() => setTripManagerOpen(true)}
      />

      <TripManageModal
        open={tripManagerOpen}
        trips={tripReview.trips}
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
        onEditSegment={(segmentId) => setEditingSegmentId(segmentId)}
        onDeleteSegment={deleteSegment}
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
        onUpdateSegmentMeta={updateSegmentMeta}
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
        onTracksComputed={setSegmentTrackPoints}
        endpointDraft={effectiveEndpointDraft}
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

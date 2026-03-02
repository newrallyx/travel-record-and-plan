import { useEffect, useMemo, useState } from 'react'
import FilterPanel from './components/FilterPanel'
import MapPlaceholder from './components/MapPlaceholder'
import MapPanel from './components/MapPanel'
import TripEditor from './components/TripEditor'
import { useFilteredSegments } from './hooks/useFilteredSegments'
import { loadTripReview, saveTripReview } from './services/tripStorage'
import type {
  CoordPoint,
  FilterState,
  RoutePreference,
  RouteSegment,
  RouteSummary,
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

// 根组件：组装数据状态、编辑动作、筛选状态、占位区与地图轨迹联动。
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

  useEffect(() => {
    saveTripReview(tripReview)
  }, [tripReview])

  const filteredSegments = useFilteredSegments(tripReview.trips, filters)

  const summary: RouteSummary = useMemo(
    () => ({ totalDistanceText: '待生成', totalDurationText: '待生成' }),
    [],
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
    if (editingSegmentId && filteredSegments.some((segment) => segment.id === editingSegmentId)) {
      return editingSegmentId
    }
    return filteredSegments[0]?.id ?? null
  }, [filteredSegments, editingSegmentId])

  const activeSegment = useMemo(
    () => filteredSegments.find((segment) => segment.id === activeSegmentId) ?? null,
    [filteredSegments, activeSegmentId],
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

  const addTrip = (payload: { title: string; startDate: string; endDate: string }) => {
    setTripReview((prev) => ({
      trips: [
        ...prev.trips,
        { id: createId('trip'), title: payload.title, startDate: payload.startDate, endDate: payload.endDate, days: [] },
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
          startPoint: payload.startPoint,
          endPoint: payload.endPoint,
          viaPointsText: payload.viaPointsText,
          preference: payload.preference,
          startCoord: payload.startCoord,
          endCoord: payload.endCoord,
          startPlaceId: payload.startPlaceId,
          endPlaceId: payload.endPlaceId,
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
    const target = filteredSegments.find((segment) => segment.id === segmentId)
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
    const target = filteredSegments.find((segment) => segment.id === segmentId)
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

    const fallbackSegment = filteredSegments[payload.index]

    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => ({
        ...trip,
        days: trip.days.map((day) => {
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
        }),
      })),
    }))

    const targetId = payload.segmentId ?? fallbackSegment?.id ?? null

    if (targetId && editingSegmentId === targetId) {
      // 删除正在编辑的路段后，必须退出编辑态，避免地图继续持有无效草稿。
      setEditingSegmentId(null)
    }

    if (targetId && editingWaypointSegmentId === targetId) {
      // 删除路段后清空途经点编辑草稿，避免继续编辑已不存在的数据。
      setEditingWaypointSegmentId(null)
      setWaypointDrafts([])
      setSelectedWaypointId(null)
    }

    if (targetId && editingEndpointsSegmentId === targetId) {
      setEditingEndpointsSegmentId(null)
      setEndpointDraft(null)
    }
  }

  const routeTypeValue = activeSegment?.preference ?? 'HIGHWAY_FIRST'

  return (
    <main className="app-shell">
      <h1>自驾旅行复盘工具（开发中）</h1>

      <TripEditor trips={tripReview.trips} onAddTrip={addTrip} onAddSegment={addSegment} />

      <FilterPanel trips={tripReview.trips} filters={filters} onChange={setFilters} />

      <MapPlaceholder
        filteredSegments={filteredSegments}
        summary={summary}
        filterContext={filterContext}
        editingSegmentId={editingSegmentId}
        activeSegmentId={activeSegmentId}
        onEditSegment={(segmentId) => setEditingSegmentId(segmentId)}
        onDeleteSegment={deleteSegment}
        routeType={routeTypeValue}
        onChangeRouteType={(value) => {
          if (!activeSegmentId) return
          updateSegment(activeSegmentId, (segment) => ({ ...segment, preference: value }))
        }}
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
        filteredSegments={filteredSegments}
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

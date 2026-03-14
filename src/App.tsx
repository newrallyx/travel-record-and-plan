import { useCallback, useEffect, useMemo, useState } from 'react'
import { appMode, isReadonlyDemoMode } from './config/appMode'
import FilterPanel from './components/FilterPanel'
import MapPanel from './components/MapPanel'
import MapPlaceholder from './components/MapPlaceholder'
import TripEditor from './components/TripEditor'
import TripManageModal from './components/TripManageModal'
import { useFilteredSegments } from './hooks/useFilteredSegments'
import { useRouteCacheHydration } from './hooks/useRouteCacheHydration'
import { useSegmentEditing, type SegmentMetaDraft } from './hooks/useSegmentEditing'
import { useTripManager, type EndpointDraft } from './hooks/useTripManager'
import { useTripReviewState } from './hooks/useTripReviewState'
import type { CoordPoint, FilterState, RouteSegment, RouteSummary, TripCategory, Waypoint } from './types/trip'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters, getTripDistanceMeters } from './utils/distance'
import './styles/app.css'

function App() {
  const { tripReview, setTripReview, isLoading, loadError } = useTripReviewState()
  const [activeWorkspace, setActiveWorkspace] = useState<TripCategory>('review')
  const [filters, setFilters] = useState<FilterState>({ tripId: '', dayId: '', segmentId: '' })
  const [tripManagerOpen, setTripManagerOpen] = useState(false)

  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null)
  const [editingWaypointSegmentId, setEditingWaypointSegmentId] = useState<string | null>(null)
  const [waypointDrafts, setWaypointDrafts] = useState<Waypoint[]>([])
  const [editingEndpointsSegmentId, setEditingEndpointsSegmentId] = useState<string | null>(null)
  const [endpointDraft, setEndpointDraft] = useState<EndpointDraft | null>(null)
  const [segmentMetaDraft, setSegmentMetaDraft] = useState<SegmentMetaDraft | null>(null)

  useRouteCacheHydration({ trips: tripReview.trips, setTripReview, enabled: !isReadonlyDemoMode })

  const workspaceTrips = useMemo(
    () =>
      tripReview.trips
        .filter((trip) => trip.category === activeWorkspace)
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)),
    [tripReview.trips, activeWorkspace],
  )

  const isAllTripsSelected = !filters.tripId
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

  const tripManager = useTripManager({
    isReadonlyMode: isReadonlyDemoMode,
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
  })

  const segmentEditing = useSegmentEditing({
    activeSegmentId,
    listViewSegments,
    selectedWaypointId,
    editingWaypointSegmentId,
    waypointDrafts,
    endpointDraft,
    editingEndpointsSegmentId,
    segmentMetaDraft,
    getSegmentDate: tripManager.getSegmentDate,
    updateSegment: tripManager.updateSegment,
    updateSegmentMeta: tripManager.updateSegmentMeta,
    findSegmentRef: tripManager.findSegmentRef,
    setSegmentMetaDraft,
    setEditingWaypointSegmentId,
    setWaypointDrafts,
    setEditingEndpointsSegmentId,
    setEndpointDraft,
    createId: tripManager.createId,
  })

  useEffect(() => {
    setFilters((prev) => {
      const firstTrip = workspaceTrips[0]
      if (!firstTrip) return { tripId: '', dayId: '', segmentId: '' }

      if (isReadonlyDemoMode && !prev.tripId) {
        return { tripId: '', dayId: '', segmentId: '' }
      }

      const selectedTrip = workspaceTrips.find((trip) => trip.id === prev.tripId) ?? firstTrip
      const selectedDay = selectedTrip.days.find((day) => day.id === prev.dayId) ?? selectedTrip.days[0]
      const selectedSegment =
        selectedDay?.routeSegments.find((segment) => segment.id === prev.segmentId) ?? selectedDay?.routeSegments[0]

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
  }, [activeWorkspace, workspaceTrips, isReadonlyDemoMode])

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
    () => ({ totalDistanceText: formatDistance(activeSegment ? getTrackDistanceMeters(activeSegment) : null) }),
    [activeSegment],
  )

  const mapInfo = useMemo(() => {
    const dateLabel = selectedDay?.date ?? (isAllTripsSelected ? '全部日期' : filterContext.dayDate)
    const cacheStatus = filters.tripId && filters.dayId && filters.segmentId && mapRenderSegments.length <= 3 ? '按需规划' : '缓存优先'

    const mapDistanceText = (() => {
      if (activeSegment) {
        return formatDistance(getTrackDistanceMeters(activeSegment))
      }

      if (selectedDay) {
        return formatDistance(getDayDistanceMeters(selectedDay.routeSegments))
      }

      if (selectedTrip) {
        return formatDistance(getTripDistanceMeters(selectedTrip))
      }

      return formatDistance(getDayDistanceMeters(mapRenderSegments))
    })()

    if (activeSegment) {
      return {
        summary: `${activeSegment.name} · ${segmentEditing.activeSegmentDate || dateLabel} · 路段数 ${mapRenderSegments.length} · 距离 ${mapDistanceText} · 缓存状态 ${cacheStatus}`,
      }
    }

    if (isAllTripsSelected) {
      return {
        summary: `全部路线 · ${dateLabel} · 路段数 ${mapRenderSegments.length} · 距离 ${mapDistanceText} · 缓存状态 ${cacheStatus}`,
      }
    }

    return {
      summary: `${selectedTrip?.title ?? '当前路线'} · ${dateLabel} · 路段数 ${mapRenderSegments.length} · 距离 ${mapDistanceText} · 缓存状态 ${cacheStatus}`,
    }
  }, [
    activeSegment,
    segmentEditing.activeSegmentDate,
    isAllTripsSelected,
    selectedDay?.date,
    filters.tripId,
    filters.dayId,
    filters.segmentId,
    mapRenderSegments.length,
    mapRenderSegments,
    filterContext.dayDate,
    selectedDay,
    selectedTrip?.title,
    selectedTrip,
  ])

  const saveResolvedRoutes = useCallback(
    (patches: Array<{ segmentId: string; points: CoordPoint[]; distanceMeters: number | null; routeBuildKey: string }>) => {
      if (isReadonlyDemoMode) return
      if (!patches.length) return
      const patchMap = new Map(patches.map((item) => [item.segmentId, item]))

      setTripReview((prev) => {
        let changed = false
        const nextTrips = prev.trips.map((trip) => {
          let hasTripChanges = false
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
                segment.points.every(
                  (point, idx) => point.lat === patch.points[idx].lat && point.lon === patch.points[idx].lon,
                )

              if (sameDistance && sameRouteKey && samePoints) return segment

              changed = true
              dayChanged = true
              hasTripChanges = true
              return {
                ...segment,
                points: patch.points,
                distanceMeters:
                  typeof patch.distanceMeters === 'number' ? Math.round(patch.distanceMeters) : segment.distanceMeters,
                routeBuildKey: patch.routeBuildKey,
              }
            })

            return dayChanged ? { ...day, routeSegments: nextSegments } : day
          })

          return hasTripChanges ? { ...trip, days: nextDays } : trip
        })

        return changed ? { ...prev, trips: nextTrips } : prev
      })
    },
    [isReadonlyDemoMode, setTripReview],
  )

  const routePreferenceValue = activeSegment?.preference ?? 'HIGHWAY_FIRST'
  const routeModeValue = activeSegment?.routeType ?? 'DRIVING'

  if (isReadonlyDemoMode && isLoading) {
    return (
      <main className="app-shell">
        <header className="top-nav">
          <div className="top-nav-title-group">
            <h1>自驾旅行记录与规划工具</h1>
            <p>只读展示版正在加载全部旅程数据...</p>
            <p className="readonly-banner">演示版 / 只读模式：当前内容不可修改</p>
          </div>
        </header>
      </main>
    )
  }

  if (isReadonlyDemoMode && loadError) {
    return (
      <main className="app-shell">
        <header className="top-nav">
          <div className="top-nav-title-group">
            <h1>自驾旅行记录与规划工具</h1>
            <p>只读展示版加载失败：{loadError}</p>
            <p className="readonly-banner">请检查 public/demo-data.json 是否存在且 JSON 结构合法。</p>
          </div>
        </header>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="top-nav">
        <div className="top-nav-title-group">
          <h1>自驾旅行记录与规划工具</h1>
          <p>{filterContext.tripName} · {filterContext.dayDate} · {filterContext.segmentName}</p>
          {isReadonlyDemoMode && <p className="readonly-banner">演示版 / 只读模式：当前内容不可修改</p>}
        </div>
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

      <div className="workspace-layout">
        <aside className="sidebar-column">
          {!tripManagerOpen ? (
            <TripEditor
              trips={workspaceTrips}
              onAddTrip={tripManager.addTrip}
              onAddSegment={tripManager.addSegment}
              isReadonlyMode={isReadonlyDemoMode}
            />
          ) : (
            <TripManageModal
              trips={workspaceTrips}
              onClose={() => setTripManagerOpen(false)}
              onDeleteTrip={tripManager.deleteTrip}
              onMoveTrip={tripManager.moveTrip}
              onReorderTrips={tripManager.reorderTrips}
              onUpdateTrip={tripManager.updateTrip}
              isReadonlyMode={isReadonlyDemoMode}
            />
          )}
        </aside>

        <section className="map-column">
          <div className="map-column-header-row">
            <span>{mapInfo.summary}</span>
          </div>

          <div className="map-canvas-wrap">
            <MapPanel
              filteredSegments={mapRenderSegments}
              isOverviewMode={!filters.tripId}
              editingSegmentId={editingSegmentId}
              onCancelEdit={() => setEditingSegmentId(null)}
              onSaveEdit={(payload) => {
                segmentEditing.saveSegmentTrack(payload)
                setEditingSegmentId(null)
              }}
              selectedWaypoint={segmentEditing.selectedWaypoint}
              onRouteResolved={saveResolvedRoutes}
              allowAutoBuild={Boolean(!isReadonlyDemoMode && filters.tripId && filters.dayId && filters.segmentId && mapRenderSegments.length <= 3)}
              isReadonlyMode={isReadonlyDemoMode}
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
          </div>

          <FilterPanel
            trips={workspaceTrips}
            filters={filters}
            onChange={setFilters}
            onOpenTripManager={() => setTripManagerOpen(true)}
            isReadonlyMode={isReadonlyDemoMode}
            tripDistanceText={tripDistanceText}
            dayDistanceText={dayDistanceText}
          />
        </section>

        <aside className="detail-column">
          <MapPlaceholder
            placeholderMode={placeholderMode}
            tripListItems={tripListItems}
            onViewTrip={(tripId) => setFilters({ tripId, dayId: '', segmentId: '' })}
            onOpenTripManager={() => setTripManagerOpen(true)}
            onDeleteTrip={tripManager.deleteTrip}
            isReadonlyMode={isReadonlyDemoMode}
            filteredSegments={detailSegments}
            summary={summary}
            filterContext={filterContext}
            editingSegmentId={editingSegmentId}
            activeSegmentId={activeSegmentId}
            activeSegment={activeSegment}
            activeSegmentDate={segmentEditing.activeSegmentDate}
            segmentMetaDraft={segmentMetaDraft}
            onEditSegment={(segmentId) => setEditingSegmentId(segmentId)}
            onDeleteSegment={tripManager.deleteSegment}
            onStartSegmentMetaEdit={segmentEditing.startSegmentMetaEdit}
            onCancelSegmentMetaEdit={() => setSegmentMetaDraft(null)}
            onSaveSegmentMetaEdit={segmentEditing.saveSegmentMetaEdit}
            onUpdateSegmentMetaDraft={(patch) => {
              setSegmentMetaDraft((prev) => (prev ? { ...prev, ...patch } : prev))
            }}
            routePreference={routePreferenceValue}
            routeMode={routeModeValue}
            onChangeRouteMode={(value) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({ ...segment, routeType: value }))
            }}
            onChangeRoutePreference={(value) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({ ...segment, preference: value }))
            }}
            onMoveSegmentInTrip={tripManager.moveSegmentInTrip}
            canMoveSegmentUp={tripManager.canMoveSegment(activeSegmentId, 'up')}
            canMoveSegmentDown={tripManager.canMoveSegment(activeSegmentId, 'down')}
            waypoints={editingWaypointSegmentId === activeSegmentId ? waypointDrafts : segmentEditing.displayedWaypoints}
            onLocateWaypoint={(waypoint) => setSelectedWaypointId(waypoint.id)}
            waypointEditMode={editingWaypointSegmentId === activeSegmentId}
            onStartWaypointEdit={() => {
              if (activeSegmentId) segmentEditing.startWaypointEdit(activeSegmentId)
            }}
            onCancelWaypointEdit={() => {
              setEditingWaypointSegmentId(null)
              setWaypointDrafts([])
            }}
            onSaveWaypoints={segmentEditing.saveWaypoints}
            onAddWaypoint={segmentEditing.addWaypoint}
            onUpdateWaypointName={(id, name) => {
              setWaypointDrafts((prev) =>
                prev.map((item) =>
                  item.id === id ? { ...item, name, lat: undefined, lng: undefined, amapId: undefined } : item,
                ),
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
            endpointDraft={segmentEditing.effectiveEndpointDraft}
            onStartEndpointEdit={() => {
              if (activeSegmentId) segmentEditing.startEndpointsEdit(activeSegmentId)
            }}
            onCancelEndpointEdit={() => {
              setEditingEndpointsSegmentId(null)
              setEndpointDraft(null)
            }}
            onSaveEndpoints={segmentEditing.saveEndpoints}
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
        </aside>
      </div>

      <footer className="app-mode-footer">当前模式：{appMode === 'readonly-demo' ? 'readonly-demo（演示只读）' : 'normal（正常可编辑）'}</footer>

    </main>
  )
}

export default App

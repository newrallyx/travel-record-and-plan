import { useCallback, useEffect, useMemo, useState } from 'react'
import FilterPanel from './components/FilterPanel'
import MapPlaceholder from './components/MapPlaceholder'
import MapPanel from './components/MapPanel'
import TripEditor from './components/TripEditor'
import TripManageModal from './components/TripManageModal'
import { useFilteredSegments } from './hooks/useFilteredSegments'
import { useRouteCacheHydration } from './hooks/useRouteCacheHydration'
import { useSegmentEditing, type SegmentMetaDraft } from './hooks/useSegmentEditing'
import { useTripManager, type EndpointDraft } from './hooks/useTripManager'
import { useTripReviewState } from './hooks/useTripReviewState'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters, getTripDistanceMeters } from './utils/distance'
import type { CoordPoint, FilterState, RouteSummary, TripCategory, Waypoint } from './types/trip'
import './styles/app.css'

function App() {
  const { tripReview, setTripReview } = useTripReviewState()
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

  useRouteCacheHydration({ trips: tripReview.trips, setTripReview })

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

  const activeSegmentId = useMemo(() => {
    if (editingSegmentId && listViewSegments.some((segment) => segment.id === editingSegmentId)) return editingSegmentId
    if (filters.segmentId && listViewSegments.some((segment) => segment.id === filters.segmentId)) return filters.segmentId
    return null
  }, [editingSegmentId, filters.segmentId, listViewSegments])

  const tripManager = useTripManager({
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

  const selectedTrip = useMemo(() => workspaceTrips.find((trip) => trip.id === filters.tripId) ?? null, [workspaceTrips, filters.tripId])
  const selectedDay = useMemo(() => selectedTrip?.days.find((day) => day.id === filters.dayId) ?? null, [selectedTrip, filters.dayId])
  const activeSegment = useMemo(() => listViewSegments.find((segment) => segment.id === activeSegmentId) ?? null, [listViewSegments, activeSegmentId])

  const tripListItems = useMemo(() => workspaceTrips.map((trip) => ({
    id: trip.id,
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    segmentCount: trip.days.reduce((sum, day) => sum + day.routeSegments.length, 0),
    tripDistanceText: formatDistance(getTripDistanceMeters(trip)),
  })), [workspaceTrips])

  const tripDistanceText = useMemo(() => formatDistance(selectedTrip ? getTripDistanceMeters(selectedTrip) : null), [selectedTrip])
  const dayDistanceText = useMemo(() => formatDistance(selectedDay ? getDayDistanceMeters(selectedDay.routeSegments) : null), [selectedDay])

  const filterContext = useMemo(() => {
    const selectedTrip = workspaceTrips.find((trip) => trip.id === filters.tripId)
    const selectedDay = selectedTrip?.days.find((day) => day.id === filters.dayId)
    const selectedSegment = selectedDay?.routeSegments.find((segment) => segment.id === filters.segmentId)
    return { tripName: selectedTrip?.title ?? '全部旅程', dayDate: selectedDay?.date ?? '全部日期', segmentName: selectedSegment?.name ?? '全部路段' }
  }, [workspaceTrips, filters.tripId, filters.dayId, filters.segmentId])

  const summary: RouteSummary = useMemo(() => ({ totalDistanceText: formatDistance(activeSegment ? getTrackDistanceMeters(activeSegment) : null) }), [activeSegment])

  const saveResolvedRoutes = useCallback((patches: Array<{ segmentId: string; points: CoordPoint[]; distanceMeters: number | null; routeBuildKey: string }>) => {
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
            return { ...segment, points: patch.points, distanceMeters: typeof patch.distanceMeters === 'number' ? Math.round(patch.distanceMeters) : segment.distanceMeters, routeBuildKey: patch.routeBuildKey }
          })
          return dayChanged ? { ...day, routeSegments: nextSegments } : day
        })
        return tripChanged ? { ...trip, days: nextDays } : trip
      })
      return changed ? { trips: nextTrips } : prev
    })
  }, [setTripReview])

  const routePreferenceValue = activeSegment?.preference ?? 'HIGHWAY_FIRST'
  const routeModeValue = activeSegment?.routeType ?? 'DRIVING'

  return <main className="app-shell">{/* jsx unchanged below */}
      <header className="app-header"><h1>自驾旅行记录与规划工具（开发中）</h1><div className="workspace-tabs" role="tablist" aria-label="总分类"><button type="button" className={activeWorkspace === 'review' ? 'active' : ''} onClick={() => setActiveWorkspace('review')}>复盘</button><button type="button" className={activeWorkspace === 'plan' ? 'active' : ''} onClick={() => setActiveWorkspace('plan')}>规划</button></div></header>
      <TripEditor trips={workspaceTrips} onAddTrip={tripManager.addTrip} onAddSegment={tripManager.addSegment} />
      <FilterPanel trips={workspaceTrips} filters={filters} onChange={setFilters} onOpenTripManager={() => setTripManagerOpen(true)} tripDistanceText={tripDistanceText} dayDistanceText={dayDistanceText} />
      <TripManageModal open={tripManagerOpen} trips={workspaceTrips} onClose={() => setTripManagerOpen(false)} onDeleteTrip={tripManager.deleteTrip} onMoveTrip={tripManager.moveTrip} onReorderTrips={tripManager.reorderTrips} onUpdateTrip={tripManager.updateTrip} />
      <MapPlaceholder placeholderMode={placeholderMode} tripListItems={tripListItems} onViewTrip={(tripId) => setFilters({ tripId, dayId: '', segmentId: '' })} onOpenTripManager={() => setTripManagerOpen(true)} onDeleteTrip={tripManager.deleteTrip} filteredSegments={listViewSegments} summary={summary} filterContext={filterContext} editingSegmentId={editingSegmentId} activeSegmentId={activeSegmentId} activeSegment={activeSegment} activeSegmentDate={segmentEditing.activeSegmentDate} segmentMetaDraft={segmentMetaDraft} onEditSegment={(segmentId) => setEditingSegmentId(segmentId)} onDeleteSegment={tripManager.deleteSegment} onStartSegmentMetaEdit={segmentEditing.startSegmentMetaEdit} onCancelSegmentMetaEdit={() => setSegmentMetaDraft(null)} onSaveSegmentMetaEdit={segmentEditing.saveSegmentMetaEdit} onUpdateSegmentMetaDraft={(patch) => setSegmentMetaDraft((prev) => (prev ? { ...prev, ...patch } : prev))} routePreference={routePreferenceValue} routeMode={routeModeValue} onChangeRouteMode={(value) => { if (!activeSegmentId) return; tripManager.updateSegment(activeSegmentId, (segment) => ({ ...segment, routeType: value })) }} onChangeRoutePreference={(value) => { if (!activeSegmentId) return; tripManager.updateSegment(activeSegmentId, (segment) => ({ ...segment, preference: value })) }} onMoveSegmentInTrip={tripManager.moveSegmentInTrip} canMoveSegmentUp={tripManager.canMoveSegment(activeSegmentId, 'up')} canMoveSegmentDown={tripManager.canMoveSegment(activeSegmentId, 'down')} waypoints={editingWaypointSegmentId === activeSegmentId ? waypointDrafts : segmentEditing.displayedWaypoints} onLocateWaypoint={(waypoint) => setSelectedWaypointId(waypoint.id)} waypointEditMode={editingWaypointSegmentId === activeSegmentId} onStartWaypointEdit={() => { if (activeSegmentId) segmentEditing.startWaypointEdit(activeSegmentId) }} onCancelWaypointEdit={() => { setEditingWaypointSegmentId(null); setWaypointDrafts([]) }} onSaveWaypoints={segmentEditing.saveWaypoints} onAddWaypoint={segmentEditing.addWaypoint} onUpdateWaypointName={(id, name) => setWaypointDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, name, lat: undefined, lng: undefined, amapId: undefined } : item)))} onSelectWaypointPlace={(id, payload) => setWaypointDrafts((prev) => prev.map((item) => (item.id === id ? { ...item, name: payload.label, lat: payload.lat, lng: payload.lng, amapId: payload.amapId } : item)))} onMoveWaypoint={(id, direction) => setWaypointDrafts((prev) => { const idx = prev.findIndex((item) => item.id === id); if (idx < 0) return prev; const target = direction === 'up' ? idx - 1 : idx + 1; if (target < 0 || target >= prev.length) return prev; const cloned = [...prev]; const [item] = cloned.splice(idx, 1); cloned.splice(target, 0, item); return cloned })} onDeleteWaypoint={(id) => setWaypointDrafts((prev) => prev.filter((item) => item.id !== id))} endpointEditMode={editingEndpointsSegmentId === activeSegmentId} endpointDraft={segmentEditing.effectiveEndpointDraft} onStartEndpointEdit={() => { if (activeSegmentId) segmentEditing.startEndpointsEdit(activeSegmentId) }} onCancelEndpointEdit={() => { setEditingEndpointsSegmentId(null); setEndpointDraft(null) }} onSaveEndpoints={segmentEditing.saveEndpoints} onUpdateEndpointText={(field, text) => setEndpointDraft((prev) => { if (!prev) return prev; return { ...prev, [field]: text, ...(field === 'startPoint' ? { startCoord: undefined } : { endCoord: undefined }) } })} onSelectEndpointPlace={(field, payload) => setEndpointDraft((prev) => { if (!prev) return prev; return { ...prev, [field]: payload.label, ...(field === 'startPoint' ? { startCoord: { lat: payload.lat, lon: payload.lng } } : { endCoord: { lat: payload.lat, lon: payload.lng } }) } })} />
      <MapPanel filteredSegments={mapRenderSegments} editingSegmentId={editingSegmentId} onStartEdit={(segmentId) => setEditingSegmentId(segmentId)} onCancelEdit={() => setEditingSegmentId(null)} onSaveEdit={(payload) => { segmentEditing.saveSegmentTrack(payload); setEditingSegmentId(null) }} selectedWaypoint={segmentEditing.selectedWaypoint} onRouteResolved={saveResolvedRoutes} allowAutoBuild={Boolean(filters.tripId && filters.dayId && filters.segmentId && mapRenderSegments.length <= 3)} onEndpointDraftChange={(payload) => setEndpointDraft((prev) => { if (!prev || prev.segmentId !== payload.segmentId) return prev; return { ...prev, startCoord: payload.startCoord, endCoord: payload.endCoord } })} />
    </main>
}

export default App

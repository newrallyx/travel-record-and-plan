import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { buildSegmentRouteKey } from '../utils/routeBuildKey'
import type { CoordPoint, RouteSegment, Waypoint } from '../types/trip'
import type { EndpointDraft } from './useTripManager'

export interface SegmentMetaDraft {
  segmentId: string
  name: string
  date: string
}

interface UseSegmentEditingParams {
  activeSegmentId: string | null
  listViewSegments: RouteSegment[]
  selectedWaypointId: string | null
  editingWaypointSegmentId: string | null
  waypointDrafts: Waypoint[]
  endpointDraft: EndpointDraft | null
  editingEndpointsSegmentId: string | null
  segmentMetaDraft: SegmentMetaDraft | null
  getSegmentDate: (segmentId: string | null) => string
  updateSegment: (segmentId: string, updater: (segment: RouteSegment) => RouteSegment) => void
  updateSegmentMeta: (segmentId: string, patch: { name: string; date: string }) => void
  findSegmentRef: (segmentId: string) => { segment: RouteSegment; day: { date: string } } | null
  setSegmentMetaDraft: Dispatch<SetStateAction<SegmentMetaDraft | null>>
  setEditingWaypointSegmentId: Dispatch<SetStateAction<string | null>>
  setWaypointDrafts: Dispatch<SetStateAction<Waypoint[]>>
  setEditingEndpointsSegmentId: Dispatch<SetStateAction<string | null>>
  setEndpointDraft: Dispatch<SetStateAction<EndpointDraft | null>>
  createId: (prefix: string) => string
}

export function useSegmentEditing({
  activeSegmentId,
  listViewSegments,
  selectedWaypointId,
  editingWaypointSegmentId,
  waypointDrafts,
  endpointDraft,
  editingEndpointsSegmentId,
  segmentMetaDraft,
  getSegmentDate,
  updateSegment,
  updateSegmentMeta,
  findSegmentRef,
  setSegmentMetaDraft,
  setEditingWaypointSegmentId,
  setWaypointDrafts,
  setEditingEndpointsSegmentId,
  setEndpointDraft,
  createId,
}: UseSegmentEditingParams) {
  const activeSegmentDate = useMemo(() => getSegmentDate(activeSegmentId), [activeSegmentId, getSegmentDate])

  const displayedWaypoints = useMemo<Waypoint[]>(() => {
    const activeSegment = listViewSegments.find((segment) => segment.id === activeSegmentId)
    if (!activeSegment) return []
    return activeSegment.waypoints ?? []
  }, [activeSegmentId, listViewSegments])

  const selectedWaypoint = useMemo(() => {
    const source = editingWaypointSegmentId === activeSegmentId ? waypointDrafts : displayedWaypoints
    return source.find((waypoint) => waypoint.id === selectedWaypointId) ?? null
  }, [displayedWaypoints, editingWaypointSegmentId, activeSegmentId, waypointDrafts, selectedWaypointId])

  const effectiveEndpointDraft = useMemo(() => {
    if (!endpointDraft || endpointDraft.segmentId !== activeSegmentId) return null
    return endpointDraft
  }, [endpointDraft, activeSegmentId])

  const startSegmentMetaEdit = (segmentId: string) => {
    const ref = findSegmentRef(segmentId)
    if (!ref) return
    setSegmentMetaDraft({ segmentId, name: ref.segment.name, date: ref.day.date })
  }

  const saveSegmentMetaEdit = () => {
    if (!segmentMetaDraft) return
    updateSegmentMeta(segmentMetaDraft.segmentId, { name: segmentMetaDraft.name, date: segmentMetaDraft.date })
    setSegmentMetaDraft(null)
  }

  const saveSegmentTrack = (payload: { segmentId: string; startCoord: CoordPoint; endCoord: CoordPoint; points: CoordPoint[] }) => {
    updateSegment(payload.segmentId, (segment) => {
      const nextSegment = { ...segment, startCoord: payload.startCoord, endCoord: payload.endCoord, points: payload.points }
      return { ...nextSegment, routeBuildKey: buildSegmentRouteKey(nextSegment) }
    })
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
      return { ...segment, startPoint: endpointDraft.startPoint, endPoint: endpointDraft.endPoint, startCoord: endpointDraft.startCoord, endCoord: endpointDraft.endCoord, points: nextPoints }
    })
    setEditingEndpointsSegmentId(null)
    setEndpointDraft(null)
  }

  const addWaypoint = () => {
    setWaypointDrafts((prev) => [...prev, { id: createId('wp'), name: '' }])
  }

  return {
    activeSegmentDate,
    displayedWaypoints,
    selectedWaypoint,
    effectiveEndpointDraft,
    startSegmentMetaEdit,
    saveSegmentMetaEdit,
    saveSegmentTrack,
    startWaypointEdit,
    saveWaypoints,
    startEndpointsEdit,
    saveEndpoints,
    addWaypoint,
  }
}

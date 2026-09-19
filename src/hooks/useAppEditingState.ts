import { useCallback, useState } from 'react'
import type { SegmentMetaDraft } from './useSegmentEditing'
import type { EndpointDraft } from './useTripManager'
import type { CoordPoint, Waypoint } from '../types/trip'

interface PlaceSelection {
  label: string
  lat: number
  lng: number
  amapId?: string
}

export function useAppEditingState() {
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null)
  const [editingWaypointSegmentId, setEditingWaypointSegmentId] = useState<string | null>(null)
  const [waypointDrafts, setWaypointDrafts] = useState<Waypoint[]>([])
  const [editingEndpointsSegmentId, setEditingEndpointsSegmentId] = useState<string | null>(null)
  const [endpointDraft, setEndpointDraft] = useState<EndpointDraft | null>(null)
  const [segmentMetaDraft, setSegmentMetaDraft] = useState<SegmentMetaDraft | null>(null)

  const resetEditingState = useCallback(() => {
    setEditingSegmentId(null)
    setSelectedWaypointId(null)
    setEditingWaypointSegmentId(null)
    setWaypointDrafts([])
    setEditingEndpointsSegmentId(null)
    setEndpointDraft(null)
    setSegmentMetaDraft(null)
  }, [])

  const cancelWaypointEdit = useCallback(() => {
    setEditingWaypointSegmentId(null)
    setWaypointDrafts([])
  }, [])

  const updateWaypointName = useCallback((id: string, name: string) => {
    setWaypointDrafts((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, name, lat: undefined, lng: undefined, amapId: undefined } : item,
      ),
    )
  }, [])

  const selectWaypointPlace = useCallback((id: string, payload: PlaceSelection) => {
    setWaypointDrafts((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, name: payload.label, lat: payload.lat, lng: payload.lng, amapId: payload.amapId }
          : item,
      ),
    )
  }, [])

  const moveWaypoint = useCallback((id: string, direction: 'up' | 'down') => {
    setWaypointDrafts((prev) => {
      const index = prev.findIndex((item) => item.id === id)
      if (index < 0) return prev
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }, [])

  const deleteWaypoint = useCallback((id: string) => {
    setWaypointDrafts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const cancelEndpointEdit = useCallback(() => {
    setEditingEndpointsSegmentId(null)
    setEndpointDraft(null)
  }, [])

  const updateEndpointText = useCallback((field: 'startPoint' | 'endPoint', text: string) => {
    setEndpointDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [field]: text,
        ...(field === 'startPoint' ? { startCoord: undefined } : { endCoord: undefined }),
      }
    })
  }, [])

  const selectEndpointPlace = useCallback((field: 'startPoint' | 'endPoint', payload: PlaceSelection) => {
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
  }, [])

  const updateEndpointCoords = useCallback((payload: {
    segmentId: string
    startCoord?: CoordPoint
    endCoord?: CoordPoint
  }) => {
    setEndpointDraft((prev) => {
      if (!prev || prev.segmentId !== payload.segmentId) return prev
      return {
        ...prev,
        startCoord: payload.startCoord,
        endCoord: payload.endCoord,
      }
    })
  }, [])

  return {
    editingSegmentId,
    setEditingSegmentId,
    selectedWaypointId,
    setSelectedWaypointId,
    editingWaypointSegmentId,
    setEditingWaypointSegmentId,
    waypointDrafts,
    setWaypointDrafts,
    editingEndpointsSegmentId,
    setEditingEndpointsSegmentId,
    endpointDraft,
    setEndpointDraft,
    segmentMetaDraft,
    setSegmentMetaDraft,
    resetEditingState,
    cancelWaypointEdit,
    updateWaypointName,
    selectWaypointPlace,
    moveWaypoint,
    deleteWaypoint,
    cancelEndpointEdit,
    updateEndpointText,
    selectEndpointPlace,
    updateEndpointCoords,
  }
}

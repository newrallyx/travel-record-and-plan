import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type {
  FilterState,
  RouteSegment,
  Trip,
  TripCategory,
  TripReview,
  Waypoint,
} from '../types/trip'
import { useDayActions } from './tripManager/useDayActions'
import { useSegmentActions } from './tripManager/useSegmentActions'
import { useTripActions } from './tripManager/useTripActions'
import type { EndpointDraft, SegmentRef } from './tripManager/types'
import { createId } from './tripManager/utils'

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
  onDeleteLinkedPhotos: (photoIds: string[]) => void
  onDeleteTripPhotoData: (tripId: string, segmentIds: string[]) => Promise<void>
}

export type { EndpointDraft } from './tripManager/types'

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
  onDeleteLinkedPhotos,
  onDeleteTripPhotoData,
}: UseTripManagerParams) {
  const blockReadonlyWrite = useCallback((actionName: string): boolean => {
    if (!isReadonlyMode) return false
    console.warn(`[readonly-demo] Blocked write action: ${actionName}`)
    return true
  }, [isReadonlyMode])

  const findSegmentRef = useCallback((segmentId: string, data = tripReview): SegmentRef | null => {
    for (let tripIndex = 0; tripIndex < data.trips.length; tripIndex += 1) {
      const trip = data.trips[tripIndex]
      for (let dayIndex = 0; dayIndex < trip.days.length; dayIndex += 1) {
        const day = trip.days[dayIndex]
        const segmentIndex = day.routeSegments.findIndex((segment) => segment.id === segmentId)
        if (segmentIndex >= 0) {
          return {
            tripIndex,
            dayIndex,
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

  const editingState = {
    editingSegmentId,
    setEditingSegmentId,
    editingWaypointSegmentId,
    setEditingWaypointSegmentId,
    setWaypointDrafts,
    setSelectedWaypointId,
    editingEndpointsSegmentId,
    setEditingEndpointsSegmentId,
    setEndpointDraft,
  }

  const segmentActions = useSegmentActions({
    ...editingState,
    activeSegmentId,
    filters,
    setFilters,
    listViewSegments,
    setTripReview,
    blockReadonlyWrite,
    findSegmentRef,
    onDeleteLinkedPhotos,
  })

  const dayActions = useDayActions({
    ...editingState,
    workspaceTrips,
    setFilters,
    setTripReview,
    blockReadonlyWrite,
    onDeleteLinkedPhotos,
  })

  const tripActions = useTripActions({
    ...editingState,
    activeWorkspace,
    filters,
    setFilters,
    workspaceTrips,
    tripReview,
    setTripReview,
    blockReadonlyWrite,
    onDeleteTripPhotoData,
  })

  return {
    findSegmentRef,
    ...tripActions,
    ...dayActions,
    ...segmentActions,
    createId,
  }
}

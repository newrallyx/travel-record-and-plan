import type { Dispatch, SetStateAction } from 'react'
import type { CoordPoint, FilterState, RouteSegment, Trip, TripDay, TripReview, Waypoint } from '../../types/trip'

export interface EndpointDraft {
  segmentId: string
  startPoint: string
  endPoint: string
  startCoord?: CoordPoint
  endCoord?: CoordPoint
}

export interface SegmentRef {
  tripIndex: number
  dayIndex: number
  segmentIndex: number
  trip: Trip
  day: TripDay
  segment: RouteSegment
}

export interface EditingStateControls {
  editingSegmentId: string | null
  setEditingSegmentId: Dispatch<SetStateAction<string | null>>
  editingWaypointSegmentId: string | null
  setEditingWaypointSegmentId: Dispatch<SetStateAction<string | null>>
  setWaypointDrafts: Dispatch<SetStateAction<Waypoint[]>>
  setSelectedWaypointId: Dispatch<SetStateAction<string | null>>
  editingEndpointsSegmentId: string | null
  setEditingEndpointsSegmentId: Dispatch<SetStateAction<string | null>>
  setEndpointDraft: Dispatch<SetStateAction<EndpointDraft | null>>
}

export type BlockReadonlyWrite = (actionName: string) => boolean
export type DeleteLinkedPhotos = (photoIds: string[]) => void
export type DeleteTripPhotoData = (tripId: string, segmentIds: string[]) => Promise<void>
export type FindSegmentRef = (segmentId: string, data?: TripReview) => SegmentRef | null
export type SetFilters = Dispatch<SetStateAction<FilterState>>
export type SetTripReview = Dispatch<SetStateAction<TripReview>>

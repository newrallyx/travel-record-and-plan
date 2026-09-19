import { useCallback } from 'react'
import { confirmDialog } from '../../components/ConfirmDialog'
import { deleteSegmentRouteCache } from '../../services/routeCacheDb'
import type { Trip } from '../../types/trip'
import { addDaysToIsoDate, sortTripDaysByDate } from '../../utils/date'
import type {
  BlockReadonlyWrite,
  DeleteLinkedPhotos,
  EditingStateControls,
  SetFilters,
  SetTripReview,
} from './types'
import { createId } from './utils'

interface UseDayActionsParams extends EditingStateControls {
  workspaceTrips: Trip[]
  setFilters: SetFilters
  setTripReview: SetTripReview
  blockReadonlyWrite: BlockReadonlyWrite
  onDeleteLinkedPhotos: DeleteLinkedPhotos
}

export function useDayActions({
  workspaceTrips,
  setFilters,
  setTripReview,
  blockReadonlyWrite,
  onDeleteLinkedPhotos,
  setEditingSegmentId,
  setEditingWaypointSegmentId,
  setWaypointDrafts,
  setSelectedWaypointId,
  setEditingEndpointsSegmentId,
  setEndpointDraft,
}: UseDayActionsParams) {
  const resetEditingState = useCallback(() => {
    setEditingSegmentId(null)
    setSelectedWaypointId(null)
    setEditingWaypointSegmentId(null)
    setWaypointDrafts([])
    setEditingEndpointsSegmentId(null)
    setEndpointDraft(null)
  }, [setEditingEndpointsSegmentId, setEditingSegmentId, setEditingWaypointSegmentId, setEndpointDraft, setSelectedWaypointId, setWaypointDrafts])

  const insertDayAfter = useCallback((tripId: string, dayId: string): string | null => {
    if (blockReadonlyWrite('insertDayAfter')) return null

    const sourceTrip = workspaceTrips.find((trip) => trip.id === tripId)
    const sourceDay = sourceTrip?.days.find((day) => day.id === dayId)
    if (!sourceTrip || !sourceDay) return null

    const insertedDayId = createId('day')
    const insertedDate = addDaysToIsoDate(sourceDay.date, 1)

    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => {
        if (trip.id !== tripId) return trip

        const shiftedDays = trip.days.map((day) => {
          if (day.date <= sourceDay.date) return day

          const shiftedDate = addDaysToIsoDate(day.date, 1)
          return {
            ...day,
            date: shiftedDate,
            routeSegments: day.routeSegments.map((segment) => ({
              ...segment,
              date: shiftedDate,
            })),
          }
        })

        return {
          ...trip,
          endDate: addDaysToIsoDate(trip.endDate, 1),
          days: sortTripDaysByDate([
            ...shiftedDays,
            { id: insertedDayId, date: insertedDate, routeSegments: [] },
          ]),
        }
      }),
    }))

    setFilters({ tripId, dayId: insertedDayId, segmentId: '' })
    resetEditingState()
    return insertedDayId
  }, [blockReadonlyWrite, resetEditingState, setFilters, setTripReview, workspaceTrips])

  const deleteDay = useCallback(async (tripId: string, dayId: string): Promise<boolean> => {
    if (blockReadonlyWrite('deleteDay')) return false

    const sourceTrip = workspaceTrips.find((trip) => trip.id === tripId)
    const orderedDays = sortTripDaysByDate(sourceTrip?.days ?? [])
    const sourceDayIndex = orderedDays.findIndex((day) => day.id === dayId)
    const sourceDay = orderedDays[sourceDayIndex]
    if (!sourceTrip || !sourceDay) return false

    const segmentCount = sourceDay.routeSegments.length
    const confirmed = await confirmDialog({
      title: '删除日期',
      message: segmentCount > 0
        ? `确定删除 ${sourceDay.date} 吗？当天的 ${segmentCount} 条路段也会被删除，后续日期将提前一天。此操作不可恢复。`
        : `确定删除 ${sourceDay.date} 吗？后续日期将提前一天。此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return false

    const deletedSegmentIds = new Set(sourceDay.routeSegments.map((segment) => segment.id))
    const deletedPhotoIds = sourceDay.routeSegments.flatMap((segment) => segment.photoIds ?? [])
    for (const segmentId of deletedSegmentIds) {
      void deleteSegmentRouteCache(segmentId)
    }
    if (deletedPhotoIds.length > 0) onDeleteLinkedPhotos(deletedPhotoIds)

    const fallbackDay = orderedDays[sourceDayIndex - 1] ?? orderedDays[sourceDayIndex + 1] ?? null

    setTripReview((prev) => ({
      trips: prev.trips.map((trip) => {
        if (trip.id !== tripId) return trip

        const remainingDays = trip.days
          .filter((day) => day.id !== dayId)
          .map((day) => {
            if (day.date <= sourceDay.date) return day

            const shiftedDate = addDaysToIsoDate(day.date, -1)
            return {
              ...day,
              date: shiftedDate,
              routeSegments: day.routeSegments.map((segment) => ({
                ...segment,
                date: shiftedDate,
              })),
            }
          })

        return {
          ...trip,
          endDate: trip.endDate > trip.startDate ? addDaysToIsoDate(trip.endDate, -1) : trip.endDate,
          days: sortTripDaysByDate(remainingDays),
        }
      }),
    }))

    setFilters({
      tripId,
      dayId: fallbackDay?.id ?? '',
      segmentId: fallbackDay?.routeSegments[0]?.id ?? '',
    })
    resetEditingState()
    return true
  }, [blockReadonlyWrite, onDeleteLinkedPhotos, resetEditingState, setFilters, setTripReview, workspaceTrips])

  return { insertDayAfter, deleteDay }
}

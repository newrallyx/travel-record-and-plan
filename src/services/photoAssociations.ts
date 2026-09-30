import type { RouteSegment, TripReview } from '../types/trip'

function normalizeRequiredId(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${fieldName} is required.`)
  return normalized
}
function updateReviewSegment(
  data: TripReview,
  segmentIdValue: string,
  updater: (segment: RouteSegment) => RouteSegment,
): TripReview {
  const segmentId = normalizeRequiredId(segmentIdValue, 'Segment id')
  let matchedReviewSegment = false
  let matchedPlanSegment = false

  const trips = data.trips.map((trip) => ({
    ...trip,
    days: trip.days.map((day) => ({
      ...day,
      routeSegments: day.routeSegments.map((segment) => {
        if (segment.id !== segmentId) return segment
        if (trip.category !== 'review') {
          matchedPlanSegment = true
          return segment
        }
        matchedReviewSegment = true
        return updater(segment)
      }),
    })),
  }))

  if (matchedPlanSegment && !matchedReviewSegment) {
    throw new Error('Photos can only be associated with review trips.')
  }
  if (!matchedReviewSegment) throw new Error('Review segment was not found.')
  return { ...data, trips }
}

export function attachPhotoToReviewSegment(data: TripReview, segmentId: string, photoIdValue: string): TripReview {
  const photoId = normalizeRequiredId(photoIdValue, 'Photo id')
  return updateReviewSegment(data, segmentId, (segment) => ({
    ...segment,
    photoIds: Array.from(new Set([...(segment.photoIds ?? []), photoId])),
  }))
}

export function detachPhotoFromReviewSegment(data: TripReview, segmentId: string, photoIdValue: string): TripReview {
  const photoId = normalizeRequiredId(photoIdValue, 'Photo id')
  return updateReviewSegment(data, segmentId, (segment) => {
    const photoIds = (segment.photoIds ?? []).filter((id) => id !== photoId)
    return { ...segment, photoIds: photoIds.length > 0 ? photoIds : undefined }
  })
}

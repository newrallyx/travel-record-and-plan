import type { LinkedPhotoRecord } from '../types/photo'
import type { TripReview } from '../types/trip'

export interface PhotoConsistencyReport {
  missingMetadataPhotoIds: string[]
  orphanMetadataPhotoIds: string[]
  planPhotoIds: string[]
  duplicateReferences: Array<{ photoId: string; segmentIds: string[] }>
  segmentMismatches: Array<{ photoId: string; metadataSegmentId: string; referencedSegmentId: string }>
}

export function hasPhotoConsistencyIssues(report: PhotoConsistencyReport): boolean {
  return report.missingMetadataPhotoIds.length > 0
    || report.orphanMetadataPhotoIds.length > 0
    || report.planPhotoIds.length > 0
    || report.duplicateReferences.length > 0
    || report.segmentMismatches.length > 0
}

function collectReferences(data: TripReview) {
  const review = new Map<string, string[]>()
  const plan = new Set<string>()
  data.trips.forEach((trip) => trip.days.forEach((day) => day.routeSegments.forEach((segment) => {
    for (const photoId of segment.photoIds ?? []) {
      if (trip.category === 'review') {
        const segmentIds = review.get(photoId) ?? []
        segmentIds.push(segment.id)
        review.set(photoId, segmentIds)
      } else {
        plan.add(photoId)
      }
    }
  })))
  return { review, plan }
}

export function auditPhotoConsistency(data: TripReview, photos: LinkedPhotoRecord[]): PhotoConsistencyReport {
  const { review, plan } = collectReferences(data)
  const photoById = new Map(photos.map((photo) => [photo.id, photo]))
  const referencedIds = new Set(review.keys())
  const missingMetadataPhotoIds = Array.from(referencedIds).filter((photoId) => !photoById.has(photoId))
  const orphanMetadataPhotoIds = photos.filter((photo) => !referencedIds.has(photo.id)).map((photo) => photo.id)
  const duplicateReferences = Array.from(review, ([photoId, segmentIds]) => ({
    photoId,
    segmentIds: Array.from(new Set(segmentIds)),
    referenceCount: segmentIds.length,
  })).filter((item) => item.segmentIds.length > 1 || item.referenceCount > 1)
    .map(({ photoId, segmentIds }) => ({ photoId, segmentIds }))
  const segmentMismatches = []
  for (const [photoId, segmentIds] of review) {
    const photo = photoById.get(photoId)
    if (!photo || segmentIds.includes(photo.segmentId)) continue
    segmentMismatches.push({
      photoId,
      metadataSegmentId: photo.segmentId,
      referencedSegmentId: segmentIds[0],
    })
  }
  return {
    missingMetadataPhotoIds,
    orphanMetadataPhotoIds,
    planPhotoIds: Array.from(plan),
    duplicateReferences,
    segmentMismatches,
  }
}

export function createPhotoConsistencyRepair(data: TripReview, photos: LinkedPhotoRecord[]) {
  const report = auditPhotoConsistency(data, photos)
  const photoById = new Map(photos.map((photo) => [photo.id, photo]))
  const preferredSegmentByPhoto = new Map<string, string>()
  const preferredTripByPhoto = new Map<string, string>()
  const tripIdBySegment = new Map<string, string>()
  for (const trip of data.trips) {
    for (const day of trip.days) {
      for (const segment of day.routeSegments) tripIdBySegment.set(segment.id, trip.id)
    }
  }
  const { review } = collectReferences(data)
  for (const [photoId, segmentIds] of review) {
    const photo = photoById.get(photoId)
    if (!photo) continue
    const preferredSegment = segmentIds.includes(photo.segmentId) ? photo.segmentId : segmentIds[0]
    preferredSegmentByPhoto.set(photoId, preferredSegment)
    preferredTripByPhoto.set(photoId, tripIdBySegment.get(preferredSegment) ?? '')
  }

  const seen = new Set<string>()
  const tripReview: TripReview = {
    ...data,
    trips: data.trips.map((trip) => ({
      ...trip,
      // 封面照片不存在或已不属于本旅程时，自动回退到默认封面。
      coverPhotoId: trip.coverPhotoId
        ? (photoById.has(trip.coverPhotoId) && preferredTripByPhoto.get(trip.coverPhotoId) === trip.id
            ? trip.coverPhotoId
            : undefined)
        : undefined,
      days: trip.days.map((day) => ({
        ...day,
        routeSegments: day.routeSegments.map((segment) => {
          const photoIds = (segment.photoIds ?? []).filter((photoId) => {
            if (trip.category !== 'review' || !photoById.has(photoId)) return false
            if (preferredSegmentByPhoto.get(photoId) !== segment.id || seen.has(photoId)) return false
            seen.add(photoId)
            return true
          })
          return { ...segment, photoIds: photoIds.length > 0 ? photoIds : undefined }
        }),
      })),
    })),
  }
  const photoUpdates = photos
    .filter((photo) => preferredSegmentByPhoto.has(photo.id) && preferredSegmentByPhoto.get(photo.id) !== photo.segmentId)
    .map((photo) => ({
      ...photo,
      segmentId: preferredSegmentByPhoto.get(photo.id)!,
      updatedAt: new Date().toISOString(),
    }))
  return { report, tripReview, photoUpdates }
}

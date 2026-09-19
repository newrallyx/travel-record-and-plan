import type { PhotoMetadataRepository } from './photoRepository'
import type { TripReview } from '../types/trip'

export interface PhotoDeleteBatchResult {
  deletedPhotoIds: string[]
  failures: Array<{ photoId: string; error: string }>
}

export function collectReferencedPhotoIds(data: TripReview): string[] {
  return Array.from(new Set(
    data.trips.flatMap((trip) => (
      trip.category === 'review'
        ? trip.days.flatMap((day) => day.routeSegments.flatMap((segment) => segment.photoIds ?? []))
        : []
    )),
  ))
}

export function removePhotoReferences(data: TripReview, photoIds: string[]): TripReview {
  const removedIds = new Set(photoIds)
  if (removedIds.size === 0) return data
  return {
    ...data,
    trips: data.trips.map((trip) => ({
      ...trip,
      // 封面照片被移除时自动退回默认封面。
      coverPhotoId: trip.coverPhotoId && removedIds.has(trip.coverPhotoId) ? undefined : trip.coverPhotoId,
      days: trip.days.map((day) => ({
        ...day,
        routeSegments: day.routeSegments.map((segment) => {
          const nextPhotoIds = (segment.photoIds ?? []).filter((photoId) => !removedIds.has(photoId))
          return {
            ...segment,
            photoIds: nextPhotoIds.length > 0 ? nextPhotoIds : undefined,
          }
        }),
      })),
    })),
  }
}

export async function deleteLinkedPhotoRecords(
  repository: Pick<PhotoMetadataRepository, 'deletePhoto'>,
  photoIds: string[],
): Promise<PhotoDeleteBatchResult> {
  const uniquePhotoIds = Array.from(new Set(photoIds.map((photoId) => photoId.trim()).filter(Boolean)))
  const settled = await Promise.allSettled(uniquePhotoIds.map((photoId) => repository.deletePhoto(photoId)))
  const deletedPhotoIds: string[] = []
  const failures: PhotoDeleteBatchResult['failures'] = []

  settled.forEach((result, index) => {
    const photoId = uniquePhotoIds[index]
    if (result.status === 'fulfilled') deletedPhotoIds.push(photoId)
    else failures.push({
      photoId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    })
  })

  return { deletedPhotoIds, failures }
}

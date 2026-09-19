import type { LinkedPhotoRecord, PhotoLibraryScanFile } from '../types/photo'
import type { TripReview } from '../types/trip'
import { attachPhotoToReviewSegment } from './photoAssociations.ts'
import type { PhotoBlobAsset, PhotoRepository } from './photoRepository'
import { createPhotoThumbnail, PHOTO_THUMBNAIL_CACHE_VERSION } from './photoThumbnail.ts'
import { extractPhotoExif, type PhotoExifResult } from './photoExif.ts'
import { createExifMapPosition } from '../utils/photoCoordinates.ts'

export interface PhotoBatchProgress {
  total: number
  completed: number
  succeeded: number
  failed: number
  currentRelativePath?: string
  status: 'processing' | 'succeeded' | 'failed' | 'cancelled'
  error?: string
}

export interface PhotoBatchSuccess {
  photoId: string
  file: PhotoLibraryScanFile
  exifWarning?: string
}

export interface PhotoBatchFailure {
  file: PhotoLibraryScanFile
  error: string
}

export interface PhotoBatchLinkResult {
  tripReview: TripReview
  successes: PhotoBatchSuccess[]
  failures: PhotoBatchFailure[]
  cancelled: boolean
}

interface LinkPhotosToReviewSegmentParams {
  repository: PhotoRepository
  tripReview: TripReview
  segmentId: string
  libraryRootId: string
  files: PhotoLibraryScanFile[]
  signal?: AbortSignal
  onProgress?: (progress: PhotoBatchProgress) => void
  thumbnailGenerator?: (original: Blob, orientation?: number) => Promise<PhotoBlobAsset>
  exifExtractor?: (original: Blob) => Promise<PhotoExifResult>
  createPhotoId?: () => string
  now?: () => Date
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function emitProgress(callback: LinkPhotosToReviewSegmentParams['onProgress'], progress: PhotoBatchProgress) {
  try {
    callback?.(progress)
  } catch (error) {
    console.error('[photoBatchLinker] Progress callback failed.', error)
  }
}

function defaultCreatePhotoId(): string {
  return crypto.randomUUID()
}

export async function linkPhotosToReviewSegment({
  repository,
  tripReview,
  segmentId,
  libraryRootId,
  files,
  signal,
  onProgress,
  thumbnailGenerator = (original, orientation) => createPhotoThumbnail(original, { orientation }),
  exifExtractor = extractPhotoExif,
  createPhotoId = defaultCreatePhotoId,
  now = () => new Date(),
}: LinkPhotosToReviewSegmentParams): Promise<PhotoBatchLinkResult> {
  let nextTripReview = tripReview
  const successes: PhotoBatchSuccess[] = []
  const failures: PhotoBatchFailure[] = []
  const preparedPhotos: LinkedPhotoRecord[] = []
  const preparedSuccesses: PhotoBatchSuccess[] = []

  // Validate the target before creating any metadata.
  const validationPhotoId = '__photo-validation__'
  attachPhotoToReviewSegment(tripReview, segmentId, validationPhotoId)

  const commitPreparedPhotos = async (cancelled: boolean): Promise<PhotoBatchLinkResult> => {
    if (preparedPhotos.length === 0) {
      return { tripReview: nextTripReview, successes, failures, cancelled }
    }
    try {
      await repository.savePhotos(preparedPhotos)
      successes.push(...preparedSuccesses)
      return { tripReview: nextTripReview, successes, failures, cancelled }
    } catch (error) {
      const message = getErrorMessage(error)
      await Promise.allSettled(preparedPhotos.map((photo) => repository.deleteThumbnail(photo.id)))
      failures.push(...preparedSuccesses.map(({ file }) => ({ file, error: message })))
      emitProgress(onProgress, {
        total: files.length,
        completed: failures.length,
        succeeded: 0,
        failed: failures.length,
        status: 'failed',
        error: message,
      })
      return { tripReview, successes: [], failures, cancelled }
    }
  }

  for (const file of files) {
    if (signal?.aborted) {
      emitProgress(onProgress, {
        total: files.length,
        completed: preparedSuccesses.length + failures.length,
        succeeded: preparedSuccesses.length,
        failed: failures.length,
        status: 'cancelled',
      })
      return commitPreparedPhotos(true)
    }

    const photoId = createPhotoId()
    const timestamp = now().toISOString()
    const photo: LinkedPhotoRecord = {
      id: photoId,
      segmentId,
      storageMode: 'linked',
      libraryRootId,
      relativePath: file.relativePath,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      importedAt: timestamp,
      updatedAt: timestamp,
      fingerprint: file.fingerprint,
    }
    let thumbnailSaved = false

    emitProgress(onProgress, {
      total: files.length,
      completed: preparedSuccesses.length + failures.length,
      succeeded: preparedSuccesses.length,
      failed: failures.length,
      currentRelativePath: file.relativePath,
      status: 'processing',
    })

    try {
      const original = await repository.readLibraryPhoto(libraryRootId, file.relativePath)
      const exif = await exifExtractor(original.blob)
      const photoWithMetadata: LinkedPhotoRecord = {
        ...photo,
        ...exif.metadata,
        metadataReadAt: exif.warning ? undefined : timestamp,
        mapPosition: exif.metadata.originalGps ? createExifMapPosition(exif.metadata.originalGps) : undefined,
      }
      const thumbnail = await thumbnailGenerator(original.blob, exif.metadata.orientation ?? 1)
      const thumbnailCacheKey = await repository.saveThumbnail(photoId, thumbnail)
      thumbnailSaved = true
      const preparedPhoto: LinkedPhotoRecord = {
        ...photoWithMetadata,
        thumbnailCacheKey,
        thumbnailCacheVersion: PHOTO_THUMBNAIL_CACHE_VERSION,
      }
      preparedPhotos.push(preparedPhoto)
      nextTripReview = attachPhotoToReviewSegment(nextTripReview, segmentId, photoId)
      preparedSuccesses.push({ photoId, file, exifWarning: exif.warning })
      emitProgress(onProgress, {
        total: files.length,
        completed: preparedSuccesses.length + failures.length,
        succeeded: preparedSuccesses.length,
        failed: failures.length,
        currentRelativePath: file.relativePath,
        status: 'succeeded',
      })
    } catch (error) {
      if (thumbnailSaved) {
        try {
          await repository.deleteThumbnail(photoId)
        } catch (rollbackError) {
          console.error('[photoBatchLinker] Failed to roll back a generated thumbnail.', rollbackError)
        }
      }
      const message = getErrorMessage(error)
      failures.push({ file, error: message })
      emitProgress(onProgress, {
        total: files.length,
        completed: preparedSuccesses.length + failures.length,
        succeeded: preparedSuccesses.length,
        failed: failures.length,
        currentRelativePath: file.relativePath,
        status: 'failed',
        error: message,
      })
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  return commitPreparedPhotos(false)
}

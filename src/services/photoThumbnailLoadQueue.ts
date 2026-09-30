import { electronPhotoRepository } from './electronPhotoRepository.ts'
import { createAsyncTaskLimiter } from '../utils/asyncTaskLimiter.ts'
import { createPhotoThumbnail, PHOTO_THUMBNAIL_CACHE_VERSION } from './photoThumbnail.ts'
import type { PhotoBlobAsset, PhotoRepository } from './photoRepository.ts'

const limitThumbnailRead = createAsyncTaskLimiter(4)
const pendingThumbnailReads = new Map<string, Promise<PhotoBlobAsset | null>>()

type ThumbnailRepository = Pick<
  PhotoRepository,
  'getPhoto' | 'readThumbnail' | 'readOriginal' | 'saveThumbnail' | 'savePhoto'
>

export async function readOrRegenerateThumbnail(
  photoId: string,
  dependencies: {
    repository?: ThumbnailRepository
    thumbnailGenerator?: (original: Blob, orientation: number) => Promise<PhotoBlobAsset>
    now?: () => Date
  } = {},
): Promise<PhotoBlobAsset | null> {
  const repository = dependencies.repository ?? electronPhotoRepository
  const photo = await repository.getPhoto(photoId)
  const cached = await repository.readThumbnail(photoId)
  if (!photo) return cached
  if (photo.thumbnailCacheVersion === PHOTO_THUMBNAIL_CACHE_VERSION && cached) return cached

  try {
    const original = await repository.readOriginal(photoId)
    const thumbnail = dependencies.thumbnailGenerator
      ? await dependencies.thumbnailGenerator(original.blob, photo.orientation ?? 1)
      : await createPhotoThumbnail(original.blob, { orientation: photo.orientation ?? 1 })
    const thumbnailCacheKey = await repository.saveThumbnail(photoId, thumbnail)
    await repository.savePhoto({
      ...photo,
      thumbnailCacheKey,
      thumbnailCacheVersion: PHOTO_THUMBNAIL_CACHE_VERSION,
      updatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    })
    return thumbnail
  } catch (error) {
    console.warn('[photoThumbnailLoadQueue] Failed to refresh an old thumbnail.', error)
    return cached
  }
}

export function loadPhotoThumbnail(photoId: string): Promise<PhotoBlobAsset | null> {
  const pending = pendingThumbnailReads.get(photoId)
  if (pending) return pending

  const request = limitThumbnailRead(() => readOrRegenerateThumbnail(photoId))
  pendingThumbnailReads.set(photoId, request)
  const clearPending = () => {
    if (pendingThumbnailReads.get(photoId) === request) pendingThumbnailReads.delete(photoId)
  }
  void request.then(clearPending, clearPending)
  return request
}

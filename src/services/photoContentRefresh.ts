import type { DesktopPhotoContentRefreshPayload, DesktopPhotoLibraryApi } from '../types/desktop'
import type { LinkedPhotoRecord } from '../types/photo'
import { createExifMapPosition } from '../utils/photoCoordinates.ts'
import { extractPhotoExif, type PhotoExifResult } from './photoExif.ts'
import type { PhotoBlobAsset } from './photoRepository'
import { createPhotoThumbnail, PHOTO_THUMBNAIL_CACHE_VERSION } from './photoThumbnail.ts'

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

export async function refreshLinkedPhotoContent({
  api,
  photo,
  relativePath = photo.relativePath,
  exifExtractor = extractPhotoExif,
  thumbnailGenerator = (original, orientation) => createPhotoThumbnail(original, { orientation }),
  now = () => new Date(),
}: {
  api: Pick<DesktopPhotoLibraryApi, 'readPhoto' | 'refreshPhotoContent'>
  photo: LinkedPhotoRecord
  relativePath?: string
  exifExtractor?: (original: Blob) => Promise<PhotoExifResult>
  thumbnailGenerator?: (original: Blob, orientation?: number) => Promise<PhotoBlobAsset>
  now?: () => Date
}): Promise<LinkedPhotoRecord> {
  const source = await api.readPhoto(photo.libraryRootId, relativePath)
  const original = new Blob([copyToArrayBuffer(source.data)], { type: source.mimeType })
  const exif = await exifExtractor(original)
  if (exif.warning) throw new Error(exif.warning)

  const thumbnail = await thumbnailGenerator(original, exif.metadata.orientation ?? 1)
  if (thumbnail.mimeType !== 'image/webp') throw new Error('Thumbnail must use the image/webp MIME type.')
  const preserveMapPosition = Boolean(
    photo.mapPosition
    && (photo.mapPosition.source !== 'exif' || photo.mapPosition.manuallyAdjusted),
  )
  const thumbnailData = new Uint8Array(await thumbnail.blob.arrayBuffer())
  const payload: DesktopPhotoContentRefreshPayload = {
    photoId: photo.id,
    relativePath,
    expectedFingerprint: { size: source.size, modifiedAt: source.modifiedAt },
    capturedAt: exif.metadata.capturedAt,
    orientation: exif.metadata.orientation,
    originalGps: exif.metadata.originalGps,
    mapPosition: preserveMapPosition
      ? photo.mapPosition
      : (exif.metadata.originalGps ? createExifMapPosition(exif.metadata.originalGps) : undefined),
    metadataReadAt: now().toISOString(),
    thumbnailData,
    thumbnailMimeType: 'image/webp',
    thumbnailCacheVersion: PHOTO_THUMBNAIL_CACHE_VERSION,
  }
  return api.refreshPhotoContent(payload)
}

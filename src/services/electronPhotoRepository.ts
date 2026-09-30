import type { PhotoRepository, PhotoBlobAsset } from './photoRepository'
import { electronPhotoMetadataRepository } from './electronPhotoMetadataRepository.ts'

function requirePhotoLibraryApi() {
  const api = window.roadtripDesktop?.photoLibrary
  if (!api) throw new Error('The desktop photo library API is unavailable.')
  return api
}

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

async function readOriginal(photoId: string): Promise<PhotoBlobAsset> {
  const photo = await electronPhotoMetadataRepository.getPhoto(photoId)
  if (!photo) throw new Error('Linked photo was not found.')
  const result = await requirePhotoLibraryApi().readPhoto(photo.libraryRootId, photo.relativePath)
  return { blob: new Blob([copyToArrayBuffer(result.data)], { type: result.mimeType }), mimeType: result.mimeType }
}

async function readLibraryPhoto(rootId: string, relativePath: string): Promise<PhotoBlobAsset> {
  const result = await requirePhotoLibraryApi().readPhoto(rootId, relativePath)
  return { blob: new Blob([copyToArrayBuffer(result.data)], { type: result.mimeType }), mimeType: result.mimeType }
}

export const electronPhotoRepository: PhotoRepository = {
  ...electronPhotoMetadataRepository,
  checkPhotoAvailability: (photoId: string) => requirePhotoLibraryApi().checkPhotoAvailability(photoId),
  readOriginal,
  readLibraryPhoto,
  readThumbnail: async (photoId: string) => {
    const result = await requirePhotoLibraryApi().readThumbnail(photoId)
    if (!result) return null
    return { blob: new Blob([copyToArrayBuffer(result.data)], { type: result.mimeType }), mimeType: result.mimeType }
  },
  saveThumbnail: async (photoId: string, thumbnail: PhotoBlobAsset) => {
    if (thumbnail.mimeType !== 'image/webp') throw new Error('Thumbnail must use the image/webp MIME type.')
    const data = new Uint8Array(await thumbnail.blob.arrayBuffer())
    return requirePhotoLibraryApi().saveThumbnail(photoId, data, 'image/webp')
  },
  deleteThumbnail: (photoId: string) => requirePhotoLibraryApi().deleteThumbnail(photoId),
}

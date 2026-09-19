import type {
  LinkedPhotoRecord,
  PhotoAvailabilityResult,
  PhotoCleanupResult,
  PhotoLibraryRoot,
  PhotoLibraryRootSummary,
  PhotoLibraryScanResult,
  PhotoTripCleanupResult,
} from '../types/photo'

export interface PhotoBlobAsset {
  blob: Blob
  mimeType: string
}

/**
 * Storage boundary for the album feature.
 *
 * Implementations may use Electron APIs, the local desktop server or browser
 * storage, while React components depend only on this contract. Original
 * photos remain in registered user folders; only thumbnails may be cached by
 * the application.
 */
export interface PhotoMetadataRepository {
  selectLibraryRoot(tripId: string): Promise<PhotoLibraryRoot | null>
  listLibraryRoots(): Promise<PhotoLibraryRoot[]>
  getLibraryRootSummary(rootId: string): Promise<PhotoLibraryRootSummary>
  getLibraryRoot(rootId: string): Promise<PhotoLibraryRoot | null>
  saveLibraryRoot(root: PhotoLibraryRoot): Promise<void>
  deleteLibraryRoot(rootId: string): Promise<void>

  listPhotosBySegment(segmentId: string): Promise<LinkedPhotoRecord[]>
  listPhotos(): Promise<LinkedPhotoRecord[]>
  getPhoto(photoId: string): Promise<LinkedPhotoRecord | null>
  savePhoto(photo: LinkedPhotoRecord): Promise<void>
  savePhotos(photos: LinkedPhotoRecord[]): Promise<void>
  deletePhoto(photoId: string): Promise<void>
  deleteTripData(tripId: string, segmentIds: string[]): Promise<PhotoTripCleanupResult>
  cleanupOrphans(referencedPhotoIds: string[]): Promise<PhotoCleanupResult>
  scanLibraryRoot(rootId: string, requestId: string): Promise<PhotoLibraryScanResult>
  cancelLibraryScan(requestId: string): Promise<void>
  relinkLibraryRoot(rootId: string): Promise<PhotoLibraryRoot | null>
  repairPhotoPath(photoId: string, relativePath: string): Promise<LinkedPhotoRecord>
}

export interface PhotoAssetRepository {
  checkPhotoAvailability(photoId: string): Promise<PhotoAvailabilityResult>
  readOriginal(photoId: string): Promise<PhotoBlobAsset>
  readLibraryPhoto(rootId: string, relativePath: string): Promise<PhotoBlobAsset>
  readThumbnail(photoId: string): Promise<PhotoBlobAsset | null>
  saveThumbnail(photoId: string, thumbnail: PhotoBlobAsset): Promise<string>
  deleteThumbnail(photoId: string): Promise<void>
}

export interface PhotoRepository extends PhotoMetadataRepository, PhotoAssetRepository {}

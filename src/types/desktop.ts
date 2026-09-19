import type {
  LinkedPhotoRecord,
  PhotoCoordinate,
  PhotoAvailabilityResult,
  PhotoCleanupResult,
  PhotoLibraryRoot,
  PhotoLibraryRootSummary,
  PhotoLibraryScanProgress,
  PhotoMapPosition,
  PhotoLibraryScanResult,
  PhotoTripCleanupResult,
} from './photo'

export interface DesktopPhotoReadResult {
  data: Uint8Array
  mimeType: string
  size: number
  modifiedAt: number
}

export interface DesktopThumbnailReadResult {
  data: Uint8Array
  mimeType: 'image/webp'
}

export interface DesktopPhotoContentRefreshPayload {
  photoId: string
  relativePath: string
  expectedFingerprint: {
    size: number
    modifiedAt: number
  }
  capturedAt?: string
  orientation?: number
  originalGps?: PhotoCoordinate
  mapPosition?: PhotoMapPosition
  metadataReadAt: string
  thumbnailData: Uint8Array
  thumbnailMimeType: 'image/webp'
  thumbnailCacheVersion: number
}

export interface DesktopPhotoLibraryApi {
  chooseRoot(tripId: string): Promise<PhotoLibraryRoot | null>
  listRoots(): Promise<PhotoLibraryRoot[]>
  getRootSummary(rootId: string): Promise<PhotoLibraryRootSummary>
  getRoot(rootId: string): Promise<PhotoLibraryRoot | null>
  updateRoot(rootId: string, name: string, tripId?: string): Promise<PhotoLibraryRoot>
  deleteRoot(rootId: string): Promise<void>
  listPhotosBySegment(segmentId: string): Promise<LinkedPhotoRecord[]>
  listPhotos(): Promise<LinkedPhotoRecord[]>
  getPhoto(photoId: string): Promise<LinkedPhotoRecord | null>
  savePhoto(photo: LinkedPhotoRecord): Promise<LinkedPhotoRecord>
  savePhotos(photos: LinkedPhotoRecord[]): Promise<LinkedPhotoRecord[]>
  deletePhoto(photoId: string): Promise<void>
  deleteTripData(tripId: string, segmentIds: string[]): Promise<PhotoTripCleanupResult>
  cleanupOrphans(referencedPhotoIds: string[]): Promise<PhotoCleanupResult>
  scanRoot(rootId: string, requestId: string): Promise<PhotoLibraryScanResult>
  cancelScan(requestId: string): Promise<void>
  onScanProgress(callback: (progress: PhotoLibraryScanProgress) => void): () => void
  relinkRoot(rootId: string): Promise<PhotoLibraryRoot | null>
  repairPhotoPath(photoId: string, relativePath: string): Promise<LinkedPhotoRecord>
  chooseReplacement(photoId: string): Promise<string | null>
  refreshPhotoContent(payload: DesktopPhotoContentRefreshPayload): Promise<LinkedPhotoRecord>
  checkPhotoAvailability(photoId: string): Promise<PhotoAvailabilityResult>
  readThumbnail(photoId: string): Promise<DesktopThumbnailReadResult | null>
  saveThumbnail(photoId: string, data: Uint8Array, mimeType: 'image/webp'): Promise<string>
  deleteThumbnail(photoId: string): Promise<void>
  readPhoto(rootId: string, relativePath: string): Promise<DesktopPhotoReadResult>
}

export interface DesktopWindowControlApi {
  minimize(): Promise<void>
  maximizeToggle(): Promise<void>
  close(): Promise<void>
  onMaximizedChange(callback: (maximized: boolean) => void): () => void
}

export interface RoadtripDesktopApi {
  windowControls: DesktopWindowControlApi
  backup: DesktopBackupApi
  photoLibrary: DesktopPhotoLibraryApi
}

export interface DesktopBackupExportResult {
  cancelled: boolean
  filename?: string
  photoRootCount?: number
  photoCount?: number
  thumbnailCount?: number
  size?: number
}

export interface DesktopBackupImportResult {
  cancelled: boolean
  format?: 'zip' | 'json'
  tripBackupJson?: string
  photoRootCount?: number
  photoCount?: number
  thumbnailCount?: number
  photoIds?: string[]
  importToken?: string
}

export interface DesktopBackupApi {
  exportZip(payload: {
    tripBackupJson: string
    filename: string
    referencedPhotoIds: string[]
  }): Promise<DesktopBackupExportResult>
  importFile(): Promise<DesktopBackupImportResult>
  commitImport(importToken: string): Promise<void>
  cancelImport(importToken: string): Promise<void>
}

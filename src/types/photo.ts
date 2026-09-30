export type PhotoStorageMode = 'linked'
export type PhotoPositionSource = 'exif' | 'manual' | 'track-time'
export type PhotoAvailability = 'unchecked' | 'available' | 'root-unavailable' | 'missing' | 'changed'

export interface PhotoCoordinate {
  lat: number
  lon: number
}

export interface PhotoLibraryRoot {
  id: string
  /** The trip that owns this library directory. */
  tripId?: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
}

export interface PhotoFileFingerprint {
  size: number
  modifiedAt: number
  sha256?: string
}

export interface PhotoMapPosition extends PhotoCoordinate {
  coordinateSystem: 'GCJ02' | 'WGS84'
  source: PhotoPositionSource
  manuallyAdjusted: boolean
}

/**
 * Metadata for a photo that remains in a user-managed local photo library.
 * `relativePath` is resolved only through its registered library root so that
 * moving the whole library can be repaired by relinking a single root.
 */
export interface LinkedPhotoRecord {
  id: string
  segmentId: string
  storageMode: PhotoStorageMode
  libraryRootId: string
  relativePath: string
  originalFilename: string
  mimeType?: string
  width?: number
  height?: number
  orientation?: number
  capturedAt?: string
  metadataReadAt?: string
  importedAt: string
  updatedAt: string
  fingerprint: PhotoFileFingerprint
  originalGps?: PhotoCoordinate
  mapPosition?: PhotoMapPosition
  note?: string
  thumbnailCacheKey?: string
  thumbnailCacheVersion?: number
}

export interface PhotoAvailabilityResult {
  photoId: string
  availability: PhotoAvailability
  currentFingerprint?: PhotoFileFingerprint
}

export interface PhotoLibraryScanFile {
  relativePath: string
  originalFilename: string
  mimeType: string
  fingerprint: PhotoFileFingerprint
}

export interface PhotoLibraryScanIssue {
  relativePath: string
  code: string
  message: string
}

export interface PhotoLibraryChangedFile {
  photoId: string
  file: PhotoLibraryScanFile
}

export interface PhotoLibraryMissingPhoto {
  photoId: string
  relativePath: string
}

export interface PhotoRelocationCandidate {
  photoId: string
  candidates: PhotoLibraryScanFile[]
}

export interface PhotoLibraryScanResult {
  rootId: string
  status: 'available' | 'root-unavailable'
  files: PhotoLibraryScanFile[]
  issues: PhotoLibraryScanIssue[]
  newFiles: PhotoLibraryScanFile[]
  unchangedPhotoIds: string[]
  changed: PhotoLibraryChangedFile[]
  missing: PhotoLibraryMissingPhoto[]
  relocationCandidates: PhotoRelocationCandidate[]
  durationMs?: number
}

export interface PhotoLibraryScanProgress {
  requestId: string
  rootId: string
  processedEntries: number
  discoveredPhotos: number
  currentDirectory: string
}

export interface PhotoLibraryRootSummary {
  root: PhotoLibraryRoot
  photoCount: number
  available: boolean
}

export interface PhotoCleanupResult {
  deletedMetadataPhotoIds: string[]
  deletedThumbnailPhotoIds: string[]
  deletedTempFileCount: number
  missingReferencedPhotoIds: string[]
}

export interface PhotoTripCleanupResult {
  deletedPhotoIds: string[]
  deletedRootIds: string[]
}

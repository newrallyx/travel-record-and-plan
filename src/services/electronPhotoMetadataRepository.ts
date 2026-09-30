import type { LinkedPhotoRecord, PhotoLibraryRoot } from '../types/photo'
import type { PhotoMetadataRepository } from './photoRepository'

function requirePhotoLibraryApi() {
  const api = window.roadtripDesktop?.photoLibrary
  if (!api) throw new Error('The desktop photo library API is unavailable.')
  return api
}

export const electronPhotoMetadataRepository: PhotoMetadataRepository = {
  selectLibraryRoot: (tripId: string) => requirePhotoLibraryApi().chooseRoot(tripId),
  listLibraryRoots: () => requirePhotoLibraryApi().listRoots(),
  getLibraryRootSummary: (rootId: string) => requirePhotoLibraryApi().getRootSummary(rootId),
  getLibraryRoot: (rootId: string) => requirePhotoLibraryApi().getRoot(rootId),
  saveLibraryRoot: async (root: PhotoLibraryRoot) => {
    await requirePhotoLibraryApi().updateRoot(root.id, root.name, root.tripId)
  },
  deleteLibraryRoot: (rootId: string) => requirePhotoLibraryApi().deleteRoot(rootId),
  listPhotosBySegment: (segmentId: string) => requirePhotoLibraryApi().listPhotosBySegment(segmentId),
  listPhotos: () => requirePhotoLibraryApi().listPhotos(),
  getPhoto: (photoId: string) => requirePhotoLibraryApi().getPhoto(photoId),
  savePhoto: async (photo: LinkedPhotoRecord) => {
    await requirePhotoLibraryApi().savePhoto(photo)
  },
  savePhotos: async (photos: LinkedPhotoRecord[]) => {
    await requirePhotoLibraryApi().savePhotos(photos)
  },
  deletePhoto: (photoId: string) => requirePhotoLibraryApi().deletePhoto(photoId),
  deleteTripData: (tripId: string, segmentIds: string[]) => (
    requirePhotoLibraryApi().deleteTripData(tripId, segmentIds)
  ),
  cleanupOrphans: (referencedPhotoIds: string[]) => requirePhotoLibraryApi().cleanupOrphans(referencedPhotoIds),
  scanLibraryRoot: (rootId: string, requestId: string) => requirePhotoLibraryApi().scanRoot(rootId, requestId),
  cancelLibraryScan: (requestId: string) => requirePhotoLibraryApi().cancelScan(requestId),
  relinkLibraryRoot: (rootId: string) => requirePhotoLibraryApi().relinkRoot(rootId),
  repairPhotoPath: (photoId: string, relativePath: string) => (
    requirePhotoLibraryApi().repairPhotoPath(photoId, relativePath)
  ),
}

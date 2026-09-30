const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roadtripDesktop', {
  backup: {
    exportZip: (payload) => ipcRenderer.invoke('desktop-backup:export-zip', payload),
    importFile: () => ipcRenderer.invoke('desktop-backup:import-file'),
    commitImport: (importToken) => ipcRenderer.invoke('desktop-backup:commit-import', { importToken }),
    cancelImport: (importToken) => ipcRenderer.invoke('desktop-backup:cancel-import', { importToken }),
  },
  photoLibrary: {
    chooseRoot: (tripId) => ipcRenderer.invoke('photo-library:choose-root', { tripId }),
    listRoots: () => ipcRenderer.invoke('photo-library:list-roots'),
    getRootSummary: (rootId) => ipcRenderer.invoke('photo-library:get-root-summary', { rootId }),
    getRoot: (rootId) => ipcRenderer.invoke('photo-library:get-root', { rootId }),
    updateRoot: (rootId, name, tripId) => ipcRenderer.invoke('photo-library:update-root', { rootId, name, tripId }),
    deleteRoot: (rootId) => ipcRenderer.invoke('photo-library:delete-root', { rootId }),
    listPhotosBySegment: (segmentId) => ipcRenderer.invoke('photo-library:list-photos-by-segment', { segmentId }),
    listPhotos: () => ipcRenderer.invoke('photo-library:list-photos'),
    getPhoto: (photoId) => ipcRenderer.invoke('photo-library:get-photo', { photoId }),
    savePhoto: (photo) => ipcRenderer.invoke('photo-library:save-photo', { photo }),
    savePhotos: (photos) => ipcRenderer.invoke('photo-library:save-photos', { photos }),
    deletePhoto: (photoId) => ipcRenderer.invoke('photo-library:delete-photo', { photoId }),
    deleteTripData: (tripId, segmentIds) => (
      ipcRenderer.invoke('photo-library:delete-trip-data', { tripId, segmentIds })
    ),
    cleanupOrphans: (referencedPhotoIds) => (
      ipcRenderer.invoke('photo-library:cleanup-orphans', { referencedPhotoIds })
    ),
    scanRoot: (rootId, requestId) => ipcRenderer.invoke('photo-library:scan-root', { rootId, requestId }),
    cancelScan: (requestId) => ipcRenderer.invoke('photo-library:cancel-scan', { requestId }),
    onScanProgress: (callback) => {
      const listener = (_event, progress) => callback(progress)
      ipcRenderer.on('photo-library:scan-progress', listener)
      return () => ipcRenderer.removeListener('photo-library:scan-progress', listener)
    },
    relinkRoot: (rootId) => ipcRenderer.invoke('photo-library:relink-root', { rootId }),
    repairPhotoPath: (photoId, relativePath) => (
      ipcRenderer.invoke('photo-library:repair-photo-path', { photoId, relativePath })
    ),
    chooseReplacement: (photoId) => ipcRenderer.invoke('photo-library:choose-replacement', { photoId }),
    refreshPhotoContent: (payload) => ipcRenderer.invoke('photo-library:refresh-photo-content', payload),
    checkPhotoAvailability: (photoId) => ipcRenderer.invoke('photo-library:check-photo-availability', { photoId }),
    readThumbnail: (photoId) => ipcRenderer.invoke('photo-library:read-thumbnail', { photoId }),
    saveThumbnail: (photoId, data, mimeType) => (
      ipcRenderer.invoke('photo-library:save-thumbnail', { photoId, data, mimeType })
    ),
    deleteThumbnail: (photoId) => ipcRenderer.invoke('photo-library:delete-thumbnail', { photoId }),
    readPhoto: (rootId, relativePath) => ipcRenderer.invoke('photo-library:read-photo', { rootId, relativePath }),
  },
})

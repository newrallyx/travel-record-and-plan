import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { linkPhotosToReviewSegment, type PhotoBatchProgress } from '../services/photoBatchLinker'
import { electronPhotoRepository } from '../services/electronPhotoRepository'
import { attachPhotoToReviewSegment, detachPhotoFromReviewSegment } from '../services/photoAssociations'
import type {
  LinkedPhotoRecord,
  PhotoLibraryRoot,
  PhotoLibraryRootSummary,
  PhotoLibraryScanFile,
  PhotoLibraryScanProgress,
  PhotoLibraryScanResult,
} from '../types/photo'
import type { TripReview } from '../types/trip'
import { createExifMapPosition } from '../utils/photoCoordinates'
import { refreshLinkedPhotoContent } from '../services/photoContentRefresh'
import {
  auditPhotoConsistency,
  createPhotoConsistencyRepair,
  type PhotoConsistencyReport,
} from '../services/photoConsistency'
import { collectReferencedPhotoIds } from '../services/photoCleanup'

interface UseSegmentPhotoGalleryParams {
  tripId: string
  segmentId: string
  tripReview: TripReview
  setTripReview: Dispatch<SetStateAction<TripReview>>
  isReadonlyMode: boolean
  externalRevision?: number
}

export function useSegmentPhotoGallery({
  tripId,
  segmentId,
  tripReview,
  setTripReview,
  isReadonlyMode,
  externalRevision = 0,
}: UseSegmentPhotoGalleryParams) {
  const desktopAvailable = Boolean(window.roadtripDesktop?.photoLibrary)
  const [roots, setRoots] = useState<PhotoLibraryRoot[]>([])
  const [selectedRootId, setSelectedRootId] = useState('')
  const [photos, setPhotos] = useState<LinkedPhotoRecord[]>([])
  const [scanResult, setScanResult] = useState<PhotoLibraryScanResult | null>(null)
  const [selectedRelativePaths, setSelectedRelativePaths] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<PhotoBatchProgress | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [reloadRevision, setReloadRevision] = useState(0)
  const [importController, setImportController] = useState<AbortController | null>(null)
  const [updatingPhotoId, setUpdatingPhotoId] = useState<string | null>(null)
  const [rootSummary, setRootSummary] = useState<PhotoLibraryRootSummary | null>(null)
  const [scanProgress, setScanProgress] = useState<PhotoLibraryScanProgress | null>(null)
  const [activeScanRequestId, setActiveScanRequestId] = useState('')
  const [consistencyReport, setConsistencyReport] = useState<PhotoConsistencyReport | null>(null)
  const scanStartedAtRef = useRef(0)
  const tripSegmentKey = useMemo(() => (
    tripReview.trips.find((trip) => trip.id === tripId)?.days
      .flatMap((day) => day.routeSegments.map((segment) => segment.id))
      .join('\u0000') ?? ''
  ), [tripId, tripReview.trips])

  const reloadPhotos = useCallback(() => setReloadRevision((value) => value + 1), [])

  useEffect(() => {
    if (!desktopAvailable) return
    let cancelled = false

    async function loadRoots() {
      try {
        const [allRoots, allPhotos] = await Promise.all([
          electronPhotoRepository.listLibraryRoots(),
          electronPhotoRepository.listPhotos(),
        ])
        const tripSegmentIds = new Set(tripSegmentKey ? tripSegmentKey.split('\u0000') : [])
        const rootIdsUsedByTrip = new Set(
          allPhotos
            .filter((photo) => tripSegmentIds.has(photo.segmentId))
            .map((photo) => photo.libraryRootId),
        )
        const claimedLegacyRoots = await Promise.all(allRoots.map(async (root) => {
          if (root.tripId || !rootIdsUsedByTrip.has(root.id)) return root
          const claimedRoot = { ...root, tripId, updatedAt: new Date().toISOString() }
          await electronPhotoRepository.saveLibraryRoot(claimedRoot)
          return claimedRoot
        }))
        const nextRoots = claimedLegacyRoots.filter((root) => root.tripId === tripId)
        if (cancelled) return
        setRoots(nextRoots)
        setSelectedRootId((current) => (
          nextRoots.some((root) => root.id === current) ? current : (nextRoots[0]?.id ?? '')
        ))
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    }

    void loadRoots()
    return () => {
      cancelled = true
    }
  }, [desktopAvailable, tripId, tripSegmentKey])

  useEffect(() => {
    const api = window.roadtripDesktop?.photoLibrary
    if (!api) return
    return api.onScanProgress((nextProgress) => {
      if (nextProgress.requestId === activeScanRequestId) setScanProgress(nextProgress)
    })
  }, [activeScanRequestId])

  useEffect(() => {
    if (!selectedRootId || !desktopAvailable) {
      setRootSummary(null)
      return
    }
    let cancelled = false
    electronPhotoRepository.getLibraryRootSummary(selectedRootId)
      .then((summary) => { if (!cancelled) setRootSummary(summary) })
      .catch((summaryError) => { if (!cancelled) setError(summaryError instanceof Error ? summaryError.message : String(summaryError)) })
    return () => { cancelled = true }
  }, [desktopAvailable, reloadRevision, selectedRootId])

  useEffect(() => {
    if (!desktopAvailable || !segmentId) return
    let cancelled = false
    setIsLoading(true)

    electronPhotoRepository.listPhotosBySegment(segmentId)
      .then((records) => {
        if (cancelled) return
        setPhotos(records.sort((left, right) => (
          (left.capturedAt ?? left.importedAt).localeCompare(right.capturedAt ?? right.importedAt)
        )))
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [desktopAvailable, externalRevision, reloadRevision, segmentId])

  useEffect(() => {
    setScanResult(null)
    setSelectedRelativePaths(new Set())
    setProgress(null)
    setMessage('')
    setError('')
  }, [segmentId])

  useEffect(() => () => importController?.abort(), [importController])

  const scanRoot = useCallback(async (rootId: string) => {
    if (!rootId || isReadonlyMode) return
    setIsScanning(true)
    setError('')
    setMessage('')
    const requestId = crypto.randomUUID()
    setActiveScanRequestId(requestId)
    setScanProgress({ requestId, rootId, processedEntries: 0, discoveredPhotos: 0, currentDirectory: '.' })
    scanStartedAtRef.current = performance.now()
    try {
      const result = await electronPhotoRepository.scanLibraryRoot(rootId, requestId)
      const completedResult = { ...result, durationMs: result.durationMs ?? Math.round(performance.now() - scanStartedAtRef.current) }
      setScanResult(completedResult)
      setSelectedRelativePaths(new Set())
      setMessage(
        result.status === 'root-unavailable'
          ? '照片库当前不可访问，请检查磁盘连接或重新关联目录。'
          : `扫描完成：${result.files.length} 张支持的照片，${result.newFiles.length} 张尚未关联，耗时 ${((completedResult.durationMs ?? 0) / 1000).toFixed(1)} 秒。`,
      )
    } catch (scanError) {
      if (scanError instanceof Error && scanError.name === 'AbortError') setMessage('已取消照片库扫描。')
      else setError(scanError instanceof Error ? scanError.message : String(scanError))
    } finally {
      setIsScanning(false)
      setActiveScanRequestId('')
      setScanProgress(null)
    }
  }, [isReadonlyMode])

  const cancelScan = useCallback(() => {
    if (!activeScanRequestId) return
    void electronPhotoRepository.cancelLibraryScan(activeScanRequestId)
  }, [activeScanRequestId])

  const chooseRoot = useCallback(async () => {
    if (isReadonlyMode) return
    setError('')
    try {
      const root = await electronPhotoRepository.selectLibraryRoot(tripId)
      if (!root) return
      setRoots((current) => current.some((item) => item.id === root.id) ? current : [...current, root])
      setSelectedRootId(root.id)
      await scanRoot(root.id)
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError))
    }
  }, [isReadonlyMode, scanRoot, tripId])

  const relinkSelectedRoot = useCallback(async () => {
    if (!selectedRootId || isReadonlyMode) return
    setError('')
    try {
      const root = await electronPhotoRepository.relinkLibraryRoot(selectedRootId)
      if (!root) return
      setRoots((current) => current.map((item) => item.id === root.id ? root : item))
      await scanRoot(root.id)
    } catch (relinkError) {
      setError(relinkError instanceof Error ? relinkError.message : String(relinkError))
    }
  }, [isReadonlyMode, scanRoot, selectedRootId])

  const renameSelectedRoot = useCallback(async (name: string) => {
    if (!selectedRootId || isReadonlyMode) return
    const root = roots.find((item) => item.id === selectedRootId)
    if (!root) throw new Error('照片库不存在。')
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('照片库名称不能为空。')
    await electronPhotoRepository.saveLibraryRoot({ ...root, name: normalizedName, updatedAt: new Date().toISOString() })
    setRoots((current) => current.map((item) => item.id === root.id ? { ...item, name: normalizedName } : item))
    setRootSummary((current) => current ? { ...current, root: { ...current.root, name: normalizedName } } : current)
    setMessage('照片库名称已更新。')
  }, [isReadonlyMode, roots, selectedRootId])

  const deleteSelectedRoot = useCallback(async () => {
    if (!selectedRootId || isReadonlyMode) return
    if ((rootSummary?.photoCount ?? 0) > 0) throw new Error('该照片库仍有关联照片，不能删除。')
    await electronPhotoRepository.deleteLibraryRoot(selectedRootId)
    const remainingRoots = roots.filter((root) => root.id !== selectedRootId)
    setRoots(remainingRoots)
    setSelectedRootId(remainingRoots[0]?.id ?? '')
    setScanResult(null)
    setMessage('已移除照片库登记；本地目录和原图未被删除。')
  }, [isReadonlyMode, rootSummary?.photoCount, roots, selectedRootId])

  const runConsistencyAudit = useCallback(async () => {
    const allPhotos = await electronPhotoRepository.listPhotos()
    const report = auditPhotoConsistency(tripReview, allPhotos)
    setConsistencyReport(report)
    return report
  }, [tripReview])

  const repairConsistency = useCallback(async () => {
    if (isReadonlyMode) return
    const allPhotos = await electronPhotoRepository.listPhotos()
    const repair = createPhotoConsistencyRepair(tripReview, allPhotos)
    await electronPhotoRepository.savePhotos(repair.photoUpdates)
    const cleanup = await electronPhotoRepository.cleanupOrphans(collectReferencedPhotoIds(repair.tripReview))
    setTripReview(repair.tripReview)
    setConsistencyReport(auditPhotoConsistency(
      repair.tripReview,
      allPhotos
        .filter((photo) => !cleanup.deletedMetadataPhotoIds.includes(photo.id))
        .map((photo) => repair.photoUpdates.find((updated) => updated.id === photo.id) ?? photo),
    ))
    reloadPhotos()
    setMessage('照片关联一致性修复完成。')
  }, [isReadonlyMode, reloadPhotos, setTripReview, tripReview])

  const selectedFiles = useMemo(() => (
    scanResult?.newFiles.filter((file) => selectedRelativePaths.has(file.relativePath)) ?? []
  ), [scanResult, selectedRelativePaths])

  const toggleCandidate = useCallback((relativePath: string) => {
    setSelectedRelativePaths((current) => {
      const next = new Set(current)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }, [])

  const toggleAllCandidates = useCallback(() => {
    setSelectedRelativePaths((current) => {
      const files = scanResult?.newFiles ?? []
      return current.size === files.length ? new Set() : new Set(files.map((file) => file.relativePath))
    })
  }, [scanResult])

  const importFiles = useCallback(async (files: PhotoLibraryScanFile[]) => {
    if (!selectedRootId || files.length === 0 || isReadonlyMode) return
    const controller = new AbortController()
    setImportController(controller)
    setIsImporting(true)
    setProgress(null)
    setError('')
    setMessage('')

    try {
      const result = await linkPhotosToReviewSegment({
        repository: electronPhotoRepository,
        tripReview,
        segmentId,
        libraryRootId: selectedRootId,
        files,
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (result.successes.length > 0) {
        setTripReview((current) => result.successes.reduce(
          (next, item) => attachPhotoToReviewSegment(next, segmentId, item.photoId),
          current,
        ))
        reloadPhotos()
      }
      const completionMessage = (
        result.cancelled
          ? `已取消：成功 ${result.successes.length} 张，失败 ${result.failures.length} 张。`
          : `关联完成：成功 ${result.successes.length} 张，失败 ${result.failures.length} 张。`
      )
      const exifWarningCount = result.successes.filter((item) => item.exifWarning).length
      const failureMessage = result.failures.length > 0
        ? result.failures.slice(0, 3).map((item) => `${item.file.originalFilename}：${item.error}`).join('；')
        : ''
      await scanRoot(selectedRootId)
      setMessage(
        exifWarningCount > 0
          ? `${completionMessage} 其中 ${exifWarningCount} 张未能读取 EXIF 信息。`
          : completionMessage,
      )
      setError(failureMessage)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError))
    } finally {
      setImportController(null)
      setIsImporting(false)
    }
  }, [isReadonlyMode, reloadPhotos, scanRoot, segmentId, selectedRootId, setTripReview, tripReview])

  const importSelected = useCallback(() => importFiles(selectedFiles), [importFiles, selectedFiles])

  const importCandidatePaths = useCallback((relativePaths: Set<string>) => {
    const files = scanResult?.newFiles.filter((file) => relativePaths.has(file.relativePath)) ?? []
    setSelectedRelativePaths(new Set(relativePaths))
    return importFiles(files)
  }, [importFiles, scanResult])

  const updatePhotoNote = useCallback(async (photoId: string, note: string) => {
    if (isReadonlyMode) return
    const photo = photos.find((item) => item.id === photoId)
    if (!photo) throw new Error('照片记录不存在。')
    const updatedPhoto: LinkedPhotoRecord = {
      ...photo,
      note: note.trim() || undefined,
      updatedAt: new Date().toISOString(),
    }
    setUpdatingPhotoId(photoId)
    setError('')
    try {
      await electronPhotoRepository.savePhoto(updatedPhoto)
      setPhotos((current) => current.map((item) => item.id === photoId ? updatedPhoto : item))
      setMessage('照片备注已保存。')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
      throw updateError
    } finally {
      setUpdatingPhotoId(null)
    }
  }, [isReadonlyMode, photos])

  const refreshPhotoMetadata = useCallback(async (photoId: string, _originalBlob?: Blob) => {
    if (isReadonlyMode) return
    const photo = photos.find((item) => item.id === photoId)
    if (!photo) throw new Error('照片记录不存在。')
    setUpdatingPhotoId(photoId)
    setError('')
    try {
      const api = window.roadtripDesktop?.photoLibrary
      if (!api) throw new Error('桌面照片库接口不可用。')
      const updatedPhoto = await refreshLinkedPhotoContent({ api, photo })
      setPhotos((current) => current.map((item) => item.id === photoId ? updatedPhoto : item))
      if (selectedRootId) await scanRoot(selectedRootId)
      setMessage(
        updatedPhoto.originalGps
          ? '已更新文件状态、缩略图、拍摄时间、方向和 GPS 信息。'
          : '已更新文件状态和缩略图；原图中未发现 GPS 经纬度。',
      )
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
      throw updateError
    } finally {
      setUpdatingPhotoId(null)
    }
  }, [isReadonlyMode, photos, scanRoot, selectedRootId])

  const repairPhotoPath = useCallback(async (photoId: string, relativePath?: string) => {
    if (isReadonlyMode) return
    const photo = photos.find((item) => item.id === photoId)
    if (!photo) throw new Error('照片记录不存在。')
    const api = window.roadtripDesktop?.photoLibrary
    if (!api) throw new Error('桌面照片库接口不可用。')
    setUpdatingPhotoId(photoId)
    setError('')
    try {
      const selectedRelativePath = relativePath ?? await api.chooseReplacement(photoId)
      if (!selectedRelativePath) return
      const updatedPhoto = await refreshLinkedPhotoContent({
        api,
        photo,
        relativePath: selectedRelativePath,
      })
      setPhotos((current) => current.map((item) => item.id === photoId ? updatedPhoto : item))
      if (selectedRootId) await scanRoot(selectedRootId)
      setMessage(`已重新关联 ${updatedPhoto.originalFilename}，并更新文件状态、EXIF 和缩略图。`)
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : String(repairError))
      throw repairError
    } finally {
      setUpdatingPhotoId(null)
    }
  }, [isReadonlyMode, photos, scanRoot, selectedRootId])

  const restorePhotoExifPosition = useCallback(async (photoId: string) => {
    if (isReadonlyMode) return
    const photo = photos.find((item) => item.id === photoId)
    if (!photo) throw new Error('照片记录不存在。')
    if (!photo.originalGps) throw new Error('这张照片没有可恢复的 EXIF GPS 信息。')
    const updatedPhoto: LinkedPhotoRecord = {
      ...photo,
      mapPosition: createExifMapPosition(photo.originalGps),
      updatedAt: new Date().toISOString(),
    }
    setUpdatingPhotoId(photoId)
    setError('')
    try {
      await electronPhotoRepository.savePhoto(updatedPhoto)
      setPhotos((current) => current.map((item) => item.id === photoId ? updatedPhoto : item))
      setMessage('已恢复照片的原始 EXIF 地图位置。')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
      throw updateError
    } finally {
      setUpdatingPhotoId(null)
    }
  }, [isReadonlyMode, photos])

  const removePhoto = useCallback(async (photoId: string) => {
    if (isReadonlyMode) return
    // Validate the current relationship before deleting metadata and cache files.
    detachPhotoFromReviewSegment(tripReview, segmentId, photoId)
    setUpdatingPhotoId(photoId)
    setError('')
    try {
      await electronPhotoRepository.deletePhoto(photoId)
      setTripReview((current) => {
        try {
          return detachPhotoFromReviewSegment(current, segmentId, photoId)
        } catch {
          return current
        }
      })
      setPhotos((current) => current.filter((item) => item.id !== photoId))
      setScanResult(null)
      setSelectedRelativePaths(new Set())
      setMessage('已从当前路段移除照片；本地原图未被删除。')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError))
      throw removeError
    } finally {
      setUpdatingPhotoId(null)
    }
  }, [isReadonlyMode, segmentId, setTripReview, tripReview])

  const clearPhotoPositions = useCallback(async (photoIds: string[]) => {
    if (isReadonlyMode) return
    const selectedIds = new Set(photoIds)
    const updates = photos.filter((photo) => selectedIds.has(photo.id)).map((photo) => ({
      ...photo,
      mapPosition: undefined,
      updatedAt: new Date().toISOString(),
    }))
    await electronPhotoRepository.savePhotos(updates)
    setPhotos((current) => current.map((photo) => updates.find((updated) => updated.id === photo.id) ?? photo))
    setMessage(`已清除 ${updates.length} 张照片的地图位置。`)
  }, [isReadonlyMode, photos])

  const movePhotosToSegment = useCallback(async (photoIds: string[], targetSegmentId: string) => {
    if (isReadonlyMode || !targetSegmentId || targetSegmentId === segmentId) return
    const targetExists = tripReview.trips.some((trip) => (
      trip.id === tripId
      && trip.category === 'review'
      && trip.days.some((day) => day.routeSegments.some((candidate) => candidate.id === targetSegmentId))
    ))
    if (!targetExists) throw new Error('目标复盘路段不存在。')
    const selectedIds = new Set(photoIds)
    const originals = photos.filter((photo) => selectedIds.has(photo.id))
    await electronPhotoRepository.savePhotos(originals.map((photo) => ({
      ...photo,
      segmentId: targetSegmentId,
      updatedAt: new Date().toISOString(),
    })))
    setTripReview((current) => originals.reduce((next, photo) => (
      attachPhotoToReviewSegment(
        detachPhotoFromReviewSegment(next, segmentId, photo.id),
        targetSegmentId,
        photo.id,
      )
    ), current))
    setPhotos((current) => current.filter((photo) => !selectedIds.has(photo.id)))
    setMessage(`已将 ${originals.length} 张照片移动到其他路段。`)
  }, [isReadonlyMode, photos, segmentId, setTripReview, tripId, tripReview])

  return {
    desktopAvailable,
    roots,
    selectedRootId,
    setSelectedRootId,
    photos,
    scanResult,
    rootSummary,
    scanProgress,
    consistencyReport,
    selectedRelativePaths,
    selectedFiles,
    isLoading,
    isScanning,
    isImporting,
    progress,
    message,
    error,
    updatingPhotoId,
    chooseRoot,
    scanRoot,
    cancelScan,
    relinkSelectedRoot,
    renameSelectedRoot,
    deleteSelectedRoot,
    runConsistencyAudit,
    repairConsistency,
    toggleCandidate,
    toggleAllCandidates,
    importSelected,
    importCandidatePaths,
    cancelImport: () => importController?.abort(),
    updatePhotoNote,
    refreshPhotoMetadata,
    restorePhotoExifPosition,
    repairPhotoPath,
    clearPhotoPositions,
    movePhotosToSegment,
    removePhoto,
  }
}

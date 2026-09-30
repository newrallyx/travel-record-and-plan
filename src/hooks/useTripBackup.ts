import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { confirmDialog } from '../components/ConfirmDialog'
import { isReadonlyDemoMode } from '../config/appMode'
import { getAllSegmentRouteCacheStrict, replaceAllSegmentRouteCache } from '../services/routeCacheDb'
import { createTripBackupExport, parseTripBackupJson } from '../services/tripBackup'
import { collectReferencedPhotoIds, removePhotoReferences } from '../services/photoCleanup'
import { saveTripReviewStrict } from '../services/tripStorage'
import { commitDesktopRestoreTransaction } from '../services/backupRestoreTransaction'
import type { FilterState, TripReview } from '../types/trip'

interface UseTripBackupParams {
  tripReview: TripReview
  setTripReview: Dispatch<SetStateAction<TripReview>>
  setFilters: Dispatch<SetStateAction<FilterState>>
  resetEditingState: () => void
}

export function useTripBackup({
  tripReview,
  setTripReview,
  setFilters,
  resetEditingState,
}: UseTripBackupParams) {
  const [isExportingBackup, setIsExportingBackup] = useState(false)
  const [isImportingBackup, setIsImportingBackup] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const backupImportInputRef = useRef<HTMLInputElement | null>(null)

  const exportBackup = useCallback(async () => {
    setIsExportingBackup(true)
    setBackupMessage('')

    try {
      const backup = await createTripBackupExport(tripReview)
      const desktopBackupApi = window.roadtripDesktop?.backup
      if (desktopBackupApi) {
        const result = await desktopBackupApi.exportZip({
          tripBackupJson: backup.json,
          filename: backup.filename,
          referencedPhotoIds: collectReferencedPhotoIds(tripReview),
        })
        if (result.cancelled) {
          setBackupMessage('已取消导出备份。')
          return
        }
        setBackupMessage(
          `已导出完整 ZIP：${backup.tripCount} 个旅程、${backup.routeSegmentCount} 条路段、${result.photoCount ?? 0} 张照片索引、${result.thumbnailCount ?? 0} 张缩略图；未复制本地原图。`,
        )
        return
      }
      const blob = new Blob([backup.json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = backup.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      setBackupMessage(
        `已导出 ${backup.tripCount} 个旅程、${backup.routeSegmentCount} 条路段、${backup.routeCacheCount} 条路线缓存。`,
      )
    } catch (error) {
      console.error('[backup] Failed to export trip backup.', error)
      setBackupMessage('导出失败，请打开浏览器控制台查看错误。')
    } finally {
      setIsExportingBackup(false)
    }
  }, [tripReview])

  const importBackup = useCallback(async (file: File) => {
    if (isReadonlyDemoMode) return

    setIsImportingBackup(true)
    setBackupMessage('')

    try {
      const imported = parseTripBackupJson(await file.text())
      const importedCacheCount = await replaceAllSegmentRouteCache(imported.segmentRoutes)
      let nextTripReview = imported.tripReview
      const photoLibraryApi = window.roadtripDesktop?.photoLibrary
      if (photoLibraryApi) {
        const cleanup = await photoLibraryApi.cleanupOrphans(collectReferencedPhotoIds(nextTripReview))
        nextTripReview = removePhotoReferences(nextTripReview, cleanup.missingReferencedPhotoIds)
      }
      setTripReview(nextTripReview)
      setFilters({ tripId: '', dayId: '', segmentId: '' })
      resetEditingState()

      setBackupMessage(
        `已导入 ${imported.tripCount} 个旅程、${imported.routeSegmentCount} 条路段、${importedCacheCount} 条路线缓存。`,
      )
    } catch (error) {
      console.error('[backup] Failed to import trip backup.', error)
      const message = error instanceof Error ? error.message : '未知错误'
      setBackupMessage(`导入失败：${message}`)
    } finally {
      setIsImportingBackup(false)
    }
  }, [resetEditingState, setFilters, setTripReview])

  const importDesktopBackup = useCallback(async () => {
    if (isReadonlyDemoMode || isImportingBackup) return
    const desktopBackupApi = window.roadtripDesktop?.backup
    if (!desktopBackupApi) {
      backupImportInputRef.current?.click()
      return
    }

    setIsImportingBackup(true)
    setBackupMessage('')
    let preparedImportToken = ''
    let previousRoutes: Awaited<ReturnType<typeof getAllSegmentRouteCacheStrict>> | null = null
    try {
      const result = await desktopBackupApi.importFile()
      if (result.cancelled || !result.tripBackupJson) {
        setBackupMessage('已取消导入备份。')
        return
      }
      preparedImportToken = result.importToken ?? ''
      const imported = parseTripBackupJson(result.tripBackupJson)
      let nextTripReview = imported.tripReview
      const photoLibraryApi = window.roadtripDesktop?.photoLibrary
      if (result.format === 'zip') {
        const availablePhotoIds = new Set(result.photoIds ?? [])
        const missingPhotoIds = collectReferencedPhotoIds(nextTripReview)
          .filter((photoId) => !availablePhotoIds.has(photoId))
        nextTripReview = removePhotoReferences(nextTripReview, missingPhotoIds)
        const confirmed = await confirmDialog({
          title: '恢复完整备份',
          message: `确定恢复这个完整备份吗？将替换当前全部行程、路线缓存、照片索引和缩略图。\n\n备份包含 ${imported.tripCount} 个旅程、${result.photoCount ?? 0} 张照片索引；本地原图不会被复制或删除。`,
          confirmText: '恢复备份',
          danger: true,
        })
        if (!confirmed) {
          if (preparedImportToken) await desktopBackupApi.cancelImport(preparedImportToken)
          setBackupMessage('已取消导入备份。')
          return
        }
      } else if (photoLibraryApi) {
        const cleanup = await photoLibraryApi.cleanupOrphans(collectReferencedPhotoIds(nextTripReview))
        nextTripReview = removePhotoReferences(nextTripReview, cleanup.missingReferencedPhotoIds)
      }

      previousRoutes = await getAllSegmentRouteCacheStrict()
      const importedCacheCount = await commitDesktopRestoreTransaction({
        currentTripReview: tripReview,
        nextTripReview,
        currentRoutes: previousRoutes,
        nextRoutes: imported.segmentRoutes,
        persistTripReview: saveTripReviewStrict,
        replaceRoutes: replaceAllSegmentRouteCache,
        commitPhotos: async () => {
          if (preparedImportToken) await desktopBackupApi.commitImport(preparedImportToken)
        },
      })
      preparedImportToken = ''
      setTripReview(nextTripReview)
      setFilters({ tripId: '', dayId: '', segmentId: '' })
      resetEditingState()
      setBackupMessage(result.format === 'json'
        ? `已导入旧版 JSON：${imported.tripCount} 个旅程、${imported.routeSegmentCount} 条路段、${importedCacheCount} 条路线缓存。旧 JSON 不包含照片索引和缩略图。`
        : `已恢复完整 ZIP：${imported.tripCount} 个旅程、${imported.routeSegmentCount} 条路段、${importedCacheCount} 条路线缓存、${result.photoCount ?? 0} 张照片索引、${result.thumbnailCount ?? 0} 张缩略图。若相册目录已移动，请重新关联。`
      )
    } catch (error) {
      if (preparedImportToken) {
        try {
          await desktopBackupApi.cancelImport(preparedImportToken)
        } catch (cancelError) {
          console.error('[backup] Failed to cancel the prepared desktop backup.', cancelError)
        }
      }
      console.error('[backup] Failed to import desktop backup file.', error)
      const message = error instanceof Error ? error.message : '未知错误'
      setBackupMessage(`导入失败：${message}`)
    } finally {
      setIsImportingBackup(false)
    }
  }, [isImportingBackup, resetEditingState, setFilters, setTripReview, tripReview])

  const triggerBackupImport = useCallback(() => {
    if (isReadonlyDemoMode || isImportingBackup) return
    void importDesktopBackup()
  }, [importDesktopBackup, isImportingBackup])

  return {
    isExportingBackup,
    isImportingBackup,
    backupMessage,
    backupImportInputRef,
    exportBackup,
    importBackup,
    triggerBackupImport,
  }
}

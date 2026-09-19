import { useCallback, useEffect, useRef, useState } from 'react'
import { appMode, isReadonlyDemoMode } from './config/appMode'
import AmapKeySetupDialog from './components/AmapKeySetupDialog'
import { AutoCloseDetails } from './components/AutoCloseDetails'
import { alertDialog, ConfirmDialogHost, confirmDialog } from './components/ConfirmDialog'
import FilterPanel from './components/FilterPanel'
import { HelpDialog } from './components/HelpDialog'
import { AppIcon } from './components/icons'
import { showToast, ToastHost } from './components/ToastHost'
import MapPanel from './components/MapPanel'
import MapPlaceholder from './components/MapPlaceholder'
import SegmentPhotoGallery from './components/SegmentPhotoGallery'
import TripEditor from './components/TripEditor'
import TripManageModal from './components/TripManageModal'
import RoadbookLibraryView from './components/roadbook/RoadbookLibraryView'
import TripRoadbookView from './components/roadbook/TripRoadbookView'
import StatisticsDashboard from './components/statistics/StatisticsDashboard'
import { useAmapKeyConfig } from './hooks/useAmapKeyConfig'
import { useAppEditingState } from './hooks/useAppEditingState'
import { useMapInfo } from './hooks/useMapInfo'
import { useResolvedRoutes } from './hooks/useResolvedRoutes'
import { applyResolvedRoutePatches } from './hooks/resolvedRoutePatches'
import { useRouteCacheHydration } from './hooks/useRouteCacheHydration'
import { useSegmentEditing } from './hooks/useSegmentEditing'
import { useTripBackup } from './hooks/useTripBackup'
import { useTripManager } from './hooks/useTripManager'
import { useTripReviewState } from './hooks/useTripReviewState'
import { useTripWorkspace } from './hooks/useTripWorkspace'
import { normalizeSegmentNote, normalizeScore } from './utils/segmentScores'
import { electronPhotoMetadataRepository } from './services/electronPhotoMetadataRepository'
import { collectReferencedPhotoIds, deleteLinkedPhotoRecords, removePhotoReferences } from './services/photoCleanup'
import type { LinkedPhotoRecord, PhotoCoordinate } from './types/photo'
import type { Trip } from './types/trip'
import { createManualMapPosition } from './utils/photoCoordinates'
import './styles/app.css'

interface PhotoPositionEditState {
  photoId: string
  originalFilename: string
  draft: PhotoCoordinate | null
}

type CompactPanelTab = 'editor' | 'details' | 'photos'
type DetailPanelTab = 'details' | 'photos'
type ReviewMode = 'browse' | 'organize' | 'statistics'

function App() {
  const {
    tripReview,
    setTripReview,
    demoLoading: isLoading,
    demoError: loadError,
    storageIssue,
    retryTripPersistence,
    downloadTripRecoveryCopy,
    canResetCorruptTripStorage,
    resetCorruptTripStorage,
  } = useTripReviewState()
  const amapKeyConfig = useAmapKeyConfig(!isReadonlyDemoMode)
  const orphanCleanupStarted = useRef(false)
  const [photoCleanupFailures, setPhotoCleanupFailures] = useState<string[]>([])
  const [compactPanelTab, setCompactPanelTab] = useState<CompactPanelTab>('editor')
  const [detailPanelTab, setDetailPanelTab] = useState<DetailPanelTab>('details')
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [reviewMode, setReviewMode] = useState<ReviewMode>('organize')
  const [roadbookTripId, setRoadbookTripId] = useState<string | null>(null)
  const [detailDraftState, setDetailDraftState] = useState<{ segmentId: string | null; dirty: boolean }>({
    segmentId: null,
    dirty: false,
  })

  const runPhotoCleanup = useCallback(async (photoIds: string[]) => {
    if (!window.roadtripDesktop?.photoLibrary || photoIds.length === 0) return
    const result = await deleteLinkedPhotoRecords(electronPhotoMetadataRepository, photoIds)
    if (result.failures.length > 0) {
      setPhotoCleanupFailures(result.failures.map((failure) => failure.photoId))
      console.error('[photoCleanup] Failed to delete linked photo records.', result.failures)
    } else {
      setPhotoCleanupFailures([])
    }
  }, [])

  const deleteLinkedPhotos = useCallback((photoIds: string[]) => {
    void runPhotoCleanup(photoIds).catch((error) => {
      setPhotoCleanupFailures(photoIds)
      console.error('[photoCleanup] Failed to delete linked photo records.', error)
    })
  }, [runPhotoCleanup])

  const deleteTripPhotoData = useCallback(async (tripId: string, segmentIds: string[]) => {
    if (!window.roadtripDesktop?.photoLibrary) return
    await electronPhotoMetadataRepository.deleteTripData(tripId, segmentIds)
    setPhotoCleanupFailures([])
  }, [])

  useEffect(() => {
    if (orphanCleanupStarted.current || isReadonlyDemoMode || !window.roadtripDesktop?.photoLibrary) return
    orphanCleanupStarted.current = true
    const referencedPhotoIds = collectReferencedPhotoIds(tripReview)
    void electronPhotoMetadataRepository.cleanupOrphans(referencedPhotoIds)
      .then((result) => {
        if (result.missingReferencedPhotoIds.length > 0) {
          setTripReview((current) => removePhotoReferences(current, result.missingReferencedPhotoIds))
        }
      })
      .catch((error) => {
        console.error('[photoCleanup] Failed to clean orphaned photo data.', error)
      })
  }, [tripReview])

  const editing = useAppEditingState()
  const {
    editingSegmentId,
    setEditingSegmentId,
    selectedWaypointId,
    setSelectedWaypointId,
    editingWaypointSegmentId,
    setEditingWaypointSegmentId,
    waypointDrafts,
    setWaypointDrafts,
    editingEndpointsSegmentId,
    setEditingEndpointsSegmentId,
    endpointDraft,
    setEndpointDraft,
    segmentMetaDraft,
    setSegmentMetaDraft,
  } = editing

  const workspace = useTripWorkspace({
    trips: tripReview.trips,
    editingSegmentId,
    resetEditingState: editing.resetEditingState,
  })
  const {
    activeWorkspace,
    setActiveWorkspace,
    filters,
    setFilters,
    tripManagerOpen,
    setTripManagerOpen,
    routeColorMode,
    setRouteColorMode,
    roadTypeVisibility,
    setRoadTypeVisibility,
    workspaceTrips,
    isAllTripsSelected,
    canUseScoreColoring,
    placeholderMode,
    mapRenderSegments,
    listViewSegments,
    detailSegments,
    activeSegmentId,
    selectedTrip,
    selectedDay,
    activeSegment,
    tripListItems,
    tripBookItems,
    tripDistanceText,
    dayDistanceText,
    tripTollText,
    dayTollText,
    tripDurationText,
    dayDurationText,
    filterContext,
    summary,
  } = workspace

  const canShowPhotosPane = activeWorkspace === 'review' && Boolean(activeSegment)
  const canOpenAlbum = activeWorkspace === 'review' && mapRenderSegments.length > 0
  const albumDisabledTitle = activeWorkspace === 'review'
    ? '当前视图下没有可查看的相册'
    : '照片相册仅在复盘工作区可用'

  useEffect(() => {
    if (compactPanelTab === 'photos' && !canShowPhotosPane) {
      setCompactPanelTab('details')
    }
    if (detailPanelTab === 'photos' && !canShowPhotosPane) {
      setDetailPanelTab('details')
    }
  }, [canShowPhotosPane, compactPanelTab, detailPanelTab])

  // 相册入口：未选中具体路段时，自动选中当前视图下的首个路段再打开相册。
  const openAlbum = useCallback(() => {
    if (activeWorkspace !== 'review') return
    if (!activeSegmentId) {
      const target = mapRenderSegments[0]
      if (!target) return
      for (const trip of workspaceTrips) {
        const day = trip.days.find((candidate) =>
          candidate.routeSegments.some((segment) => segment.id === target.id),
        )
        if (day) {
          setFilters({ tripId: trip.id, dayId: day.id, segmentId: target.id })
          break
        }
      }
    }
    setCompactPanelTab('photos')
    setDetailPanelTab('photos')
  }, [activeSegmentId, activeWorkspace, mapRenderSegments, setFilters, workspaceTrips])

  const changeFiltersWithDetailGuard = useCallback(async (nextFilters: typeof filters) => {
    const selectionChanged = nextFilters.tripId !== filters.tripId
      || nextFilters.dayId !== filters.dayId
      || nextFilters.segmentId !== filters.segmentId
    if (selectionChanged && detailDraftState.dirty) {
      const confirmed = await confirmDialog({
        title: '放弃未保存的更改',
        message: '当前轨迹详情有未保存的更改，确定放弃更改并切换吗？',
        confirmText: '放弃更改',
      })
      if (!confirmed) return
      setDetailDraftState({ segmentId: null, dirty: false })
    }
    setFilters(nextFilters)
  }, [detailDraftState.dirty, filters, setFilters])

  const changeWorkspaceWithDetailGuard = useCallback(async (workspaceName: typeof activeWorkspace) => {
    if (workspaceName === activeWorkspace) return
    if (detailDraftState.dirty) {
      const confirmed = await confirmDialog({
        title: '放弃未保存的更改',
        message: '当前轨迹详情有未保存的更改，确定放弃更改并切换工作区吗？',
        confirmText: '放弃更改',
      })
      if (!confirmed) return
      setDetailDraftState({ segmentId: null, dirty: false })
    }
    setActiveWorkspace(workspaceName)
    if (workspaceName === 'review') {
      setReviewMode('organize')
      setRoadbookTripId(null)
    }
  }, [activeWorkspace, detailDraftState.dirty, setActiveWorkspace])

  useRouteCacheHydration({ trips: tripReview.trips, setTripReview, enabled: !isReadonlyDemoMode })

  const tripManager = useTripManager({
    isReadonlyMode: isReadonlyDemoMode,
    activeWorkspace,
    filters,
    setFilters,
    listViewSegments,
    workspaceTrips,
    editingSegmentId,
    setEditingSegmentId,
    editingWaypointSegmentId,
    setEditingWaypointSegmentId,
    setWaypointDrafts,
    setSelectedWaypointId,
    editingEndpointsSegmentId,
    setEditingEndpointsSegmentId,
    setEndpointDraft,
    setTripReview,
    tripReview,
    activeSegmentId,
    onDeleteLinkedPhotos: deleteLinkedPhotos,
    onDeleteTripPhotoData: deleteTripPhotoData,
  })

  const segmentEditing = useSegmentEditing({
    activeSegmentId,
    listViewSegments,
    selectedWaypointId,
    editingWaypointSegmentId,
    waypointDrafts,
    endpointDraft,
    editingEndpointsSegmentId,
    segmentMetaDraft,
    getSegmentDate: tripManager.getSegmentDate,
    updateSegment: tripManager.updateSegment,
    updateSegmentMeta: tripManager.updateSegmentMeta,
    findSegmentRef: tripManager.findSegmentRef,
    setSegmentMetaDraft,
    setEditingWaypointSegmentId,
    setWaypointDrafts,
    setEditingEndpointsSegmentId,
    setEndpointDraft,
    createId: tripManager.createId,
  })

  const setTripCoverPhoto = useCallback(async (photoId: string | null) => {
    if (isReadonlyDemoMode) return
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) =>
        trip.id === filters.tripId ? { ...trip, coverPhotoId: photoId ?? undefined } : trip,
      ),
    }))
  }, [filters.tripId, isReadonlyDemoMode, setTripReview])

  const saveTripTravelogue = useCallback((tripId: string, travelogue: string) => {
    if (isReadonlyDemoMode) return
    setTripReview((prev) => ({
      trips: prev.trips.map((trip) =>
        trip.id === tripId ? { ...trip, travelogue } : trip,
      ),
    }))
  }, [isReadonlyDemoMode, setTripReview])

  const handleCompleteTrip = useCallback(async (tripId: string) => {
    const completed = await tripManager.completeTrip(tripId)
    if (!completed) return
    editing.resetEditingState()
    setDetailDraftState({ segmentId: null, dirty: false })
    setTripManagerOpen(false)
    setActiveWorkspace('review')
    setReviewMode('browse')
    setRoadbookTripId(tripId)
    setFilters({ tripId, dayId: '', segmentId: '' })
  }, [editing.resetEditingState, setActiveWorkspace, setFilters, setTripManagerOpen, tripManager.completeTrip])

  const handleEnterReviewOrganize = useCallback(() => {
    if (reviewMode === 'organize') return
    editing.resetEditingState()
    setRoadbookTripId(null)
    setReviewMode('organize')
  }, [editing.resetEditingState, reviewMode])

  const handleEnterReviewBrowse = useCallback(() => {
    if (reviewMode === 'browse') return
    editing.resetEditingState()
    setRoadbookTripId(null)
    setReviewMode('browse')
  }, [editing.resetEditingState, reviewMode])

  // 数据统计为只读页面：保留当前地图、筛选以及所有编辑草稿，不触发重置。
  const handleEnterReviewStatistics = useCallback(() => {
    if (reviewMode === 'statistics') return
    setRoadbookTripId(null)
    setReviewMode('statistics')
  }, [reviewMode])

  const {
    isExportingBackup,
    isImportingBackup,
    backupMessage,
    backupImportInputRef,
    exportBackup,
    importBackup,
    triggerBackupImport,
  } = useTripBackup({
    tripReview,
    setTripReview,
    setFilters,
    resetEditingState: editing.resetEditingState,
  })

  useEffect(() => {
    if (!backupMessage) return
    const type = backupMessage.includes('失败')
      ? 'error'
      : backupMessage.startsWith('已取消')
        ? 'info'
        : 'success'
    showToast(backupMessage, type)
  }, [backupMessage])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key.toLowerCase() === 'b' && event.shiftKey) {
        if (isReadonlyDemoMode || isExportingBackup) return
        event.preventDefault()
        void exportBackup()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exportBackup, isExportingBackup])

  const saveResolvedRoutes = useResolvedRoutes(setTripReview)
  const mapInfo = useMapInfo({
    activeSegment,
    activeSegmentDate: segmentEditing.activeSegmentDate,
    isAllTripsSelected,
    selectedDay,
    selectedTrip,
    filters,
    mapRenderSegments,
    fallbackDayDate: filterContext.dayDate,
  })

  const routePreferenceValue = activeSegment?.preference ?? 'HIGHWAY_FIRST'
  const routeModeValue = activeSegment?.routeType ?? 'DRIVING'
  const [routeRefreshRequest, setRouteRefreshRequest] = useState<{ segmentId: string | null; revision: number }>({
    segmentId: null,
    revision: 0,
  })
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [activeSegmentPhotos, setActiveSegmentPhotos] = useState<LinkedPhotoRecord[]>([])
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null)
  const [photoPositionEdit, setPhotoPositionEdit] = useState<PhotoPositionEditState | null>(null)
  const [isSavingPhotoPosition, setIsSavingPhotoPosition] = useState(false)
  const [photoPositionError, setPhotoPositionError] = useState('')
  const [photoDataRevision, setPhotoDataRevision] = useState(0)
  const clearSelectedPhoto = useCallback(() => setSelectedPhotoId(null), [])
  const selectPhotoAndOpenGallery = useCallback((photoId: string) => {
    setSelectedPhotoId(photoId)
    setDetailPanelTab('photos')
    setCompactPanelTab('photos')
  }, [])

  const startPhotoPositionEdit = useCallback((photo: LinkedPhotoRecord) => {
    setEditingSegmentId(null)
    setPhotoPositionError('')
    setPhotoPositionEdit({
      photoId: photo.id,
      originalFilename: photo.originalFilename,
      draft: photo.mapPosition ? { lat: photo.mapPosition.lat, lon: photo.mapPosition.lon } : null,
    })
  }, [setEditingSegmentId])

  const cancelPhotoPositionEdit = useCallback(() => {
    setPhotoPositionEdit(null)
    setPhotoPositionError('')
  }, [])

  const savePhotoPosition = useCallback(async () => {
    if (!photoPositionEdit?.draft) return
    const photo = activeSegmentPhotos.find((item) => item.id === photoPositionEdit.photoId)
    if (!photo) {
      setPhotoPositionError('照片记录不存在，请重新打开当前路段相册。')
      return
    }
    const updatedPhoto: LinkedPhotoRecord = {
      ...photo,
      mapPosition: createManualMapPosition(photoPositionEdit.draft),
      updatedAt: new Date().toISOString(),
    }
    setIsSavingPhotoPosition(true)
    setPhotoPositionError('')
    try {
      await electronPhotoMetadataRepository.savePhoto(updatedPhoto)
      setActiveSegmentPhotos((current) => current.map((item) => item.id === updatedPhoto.id ? updatedPhoto : item))
      setPhotoDataRevision((value) => value + 1)
      setPhotoPositionEdit(null)
      setSelectedPhotoId(updatedPhoto.id)
    } catch (error) {
      setPhotoPositionError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSavingPhotoPosition(false)
    }
  }, [activeSegmentPhotos, photoPositionEdit])

  useEffect(() => {
    setActiveSegmentPhotos([])
    setSelectedPhotoId(null)
    setPhotoPositionEdit(null)
    setPhotoPositionError('')
  }, [activeSegmentId, activeWorkspace])

  if (isReadonlyDemoMode && isLoading) {
    return (
      <main className="app-shell">
        <header className="top-nav">
          <div className="top-nav-title-group">
            <h1>旅行轨迹记录与规划工具</h1>
            <p>只读展示版正在加载全部旅程数据...</p>
            <p className="readonly-banner">演示版 / 只读模式：当前内容不可修改</p>
          </div>
        </header>
      </main>
    )
  }

  if (isReadonlyDemoMode && loadError) {
    return (
      <main className="app-shell">
        <header className="top-nav">
          <div className="top-nav-title-group">
            <h1>旅行轨迹记录与规划工具</h1>
            <p>只读展示版加载失败：{loadError}</p>
            <p className="readonly-banner">请检查 public/demo-data.json 是否存在且 JSON 结构合法。</p>
          </div>
        </header>
      </main>
    )
  }

  const reviewModeNavigation = (
    <nav className="roadbook-submode-bar" role="tablist" aria-label="复盘视图模式">
      <button
        type="button"
        role="tab"
        aria-selected={reviewMode === 'browse'}
        className={reviewMode === 'browse' ? 'active' : ''}
        onClick={handleEnterReviewBrowse}
      >
        <AppIcon name="book" className="icon-inline" />
        路书浏览
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={reviewMode === 'organize'}
        className={reviewMode === 'organize' ? 'active' : ''}
        onClick={handleEnterReviewOrganize}
      >
        <AppIcon name="edit" className="icon-inline" />
        整理记录
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={reviewMode === 'statistics'}
        className={reviewMode === 'statistics' ? 'active' : ''}
        onClick={handleEnterReviewStatistics}
      >
        <AppIcon name="info" className="icon-inline" />
        数据统计
      </button>
    </nav>
  )

  const showReviewFullPage = activeWorkspace === 'review'
    && (reviewMode === 'browse' || reviewMode === 'statistics')

  return (
    <main className="app-shell">
      <header className="top-nav">
        <div className="top-nav-title-group">
          <div className="top-nav-title-row">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <defs>
                <linearGradient id="brand-mark-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#818cf8" />
                  <stop offset="1" stopColor="#4338ca" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#brand-mark-grad)" />
              <path
                d="M7 23c3-12 7-18 9-16s3 8 9 6"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
              <circle cx="25" cy="13" r="2.6" fill="#fbbf24" stroke="#ffffff" strokeWidth="1" />
            </svg>
            <h1>旅行轨迹记录与规划工具</h1>
          </div>
          <p>{filterContext.tripName} · {filterContext.dayDate} · {filterContext.segmentName}</p>
          {isReadonlyDemoMode ? (
            <p className="top-nav-notice readonly-banner">演示版 / 只读模式：当前内容不可修改</p>
          ) : storageIssue ? (
            <div className="top-nav-notice trip-storage-warning" role="alert" aria-live="assertive">
              <span>{storageIssue.message}</span>
              <span className="trip-storage-warning-actions">
                {storageIssue.kind === 'corrupt-data' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (!downloadTripRecoveryCopy()) {
                          void alertDialog('恢复原文导出失败，请检查浏览器下载权限。')
                        }
                      }}
                    >
                      导出恢复原文
                    </button>
                    <button
                      type="button"
                      disabled={!canResetCorruptTripStorage}
                      title={canResetCorruptTripStorage ? undefined : '请先成功导出恢复原文'}
                      onClick={() => {
                        void (async () => {
                          const confirmed = await confirmDialog({
                            title: '重置损坏数据',
                            message: '这会用示例数据替换当前损坏的本地行程数据。恢复副本或已导出的原文会继续保留，是否继续？',
                            confirmText: '使用示例数据重置',
                            danger: true,
                          })
                          if (confirmed) resetCorruptTripStorage()
                        })()
                      }}
                    >
                      使用示例数据重置
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={retryTripPersistence}>重试保存</button>
                )}
              </span>
            </div>
          ) : photoCleanupFailures.length > 0 ? (
            <p className="top-nav-notice photo-cleanup-warning">
              <AppIcon name="alert" className="icon-inline" />
              有 {photoCleanupFailures.length} 张照片索引清理失败。
              <button type="button" onClick={() => void runPhotoCleanup(photoCleanupFailures)}>重新清理</button>
            </p>
          ) : !amapKeyConfig.isChecking && !amapKeyConfig.configured ? (
            <p className="top-nav-notice amap-key-warning">
              <AppIcon name="key" className="icon-inline" />
              {amapKeyConfig.error || '地图服务尚未配置，地点联想和路线规划暂不可用。'}
            </p>
          ) : null}
        </div>
        <nav className="workspace-tabs top-nav-primary" role="tablist" aria-label="工作模式">
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'review'}
            className={activeWorkspace === 'review' ? 'active' : ''}
            onClick={() => changeWorkspaceWithDetailGuard('review')}
          >
            <AppIcon name="compass" className="icon-inline" />
            复盘
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeWorkspace === 'plan'}
            className={activeWorkspace === 'plan' ? 'active' : ''}
            onClick={() => changeWorkspaceWithDetailGuard('plan')}
          >
            <AppIcon name="route" className="icon-inline" />
            规划
          </button>
        </nav>
        <div className="top-nav-tools">
          <input
            ref={backupImportInputRef}
            type="file"
            className="backup-import-input"
            accept="application/json,.json"
            disabled={isReadonlyDemoMode || isImportingBackup}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void importBackup(file)
            }}
          />
          <AutoCloseDetails className="top-nav-menu backup-menu">
            <summary><AppIcon name="archive" className="icon-inline" />备份</summary>
            <div className="top-nav-menu-panel">
          <button
            type="button"
            className="backup-import-button"
            onClick={triggerBackupImport}
            disabled={isReadonlyDemoMode || isImportingBackup}
          >
            <AppIcon name="upload" className="icon-inline" />
            {isImportingBackup ? '导入中...' : '导入备份'}
          </button>
          <button type="button" className="backup-export-button" onClick={exportBackup} disabled={isExportingBackup}>
            <AppIcon name="download" className="icon-inline" />
            {isExportingBackup ? '导出中...' : '导出备份'}
          </button>
          <p className="help-menu-version">快捷键：Ctrl + Shift + B 快速导出备份</p>
          <details className="backup-menu-help">
            <summary>备份包含什么？</summary>
            <div>
              <strong>完整 ZIP 包含</strong>
              <span>行程数据（含预计行驶时间、预估过路费、复盘标签和实际记录）、路线缓存、照片索引、照片备注、地图位置和缩略图。</span>
              <strong>完整 ZIP 不包含</strong>
              <span>本地原图文件。原图仍保留在你选择的照片库目录中，恢复后目录移动过时需要重新关联。</span>
              <strong>旧版 JSON</strong>
              <span>只包含行程和路线缓存，不包含照片索引或缩略图。</span>
            </div>
          </details>
            </div>
          </AutoCloseDetails>
          <AutoCloseDetails className="top-nav-menu help-menu">
            <summary><AppIcon name="book" className="icon-inline" />帮助</summary>
            <div className="top-nav-menu-panel">
              <button type="button" onClick={() => setHelpOpen(true)}>
                <AppIcon name="book" className="icon-inline" />
                使用说明（README）
              </button>
              <p className="help-menu-version">旅行轨迹记录与规划工具 · v{__APP_VERSION__}</p>
            </div>
          </AutoCloseDetails>
          {!isReadonlyDemoMode && (
            <button
              type="button"
              className={amapKeyConfig.configured ? 'amap-key-button configured' : 'amap-key-button'}
              onClick={amapKeyConfig.open}
              disabled={amapKeyConfig.isChecking}
            >
              <AppIcon name="key" className="icon-inline" />
              {amapKeyConfig.isChecking
                ? '检查地图服务...'
                : amapKeyConfig.configured
                  ? '地图服务设置'
                  : '配置地图服务'}
            </button>
          )}
        </div>
      </header>

      {showReviewFullPage && reviewModeNavigation}

      {activeWorkspace === 'review' && reviewMode === 'browse' && (
        <div className="review-full-page">
          {roadbookTripId && workspaceTrips.some((trip) => trip.id === roadbookTripId) ? (
            <TripRoadbookView
              trip={workspaceTrips.find((trip) => trip.id === roadbookTripId) as Trip}
              trips={tripReview.trips}
              onBack={() => setRoadbookTripId(null)}
              isReadonlyMode={isReadonlyDemoMode}
              onSaveTravelogue={(travelogue) => saveTripTravelogue(roadbookTripId as string, travelogue)}
            />
          ) : (
            <RoadbookLibraryView trips={workspaceTrips} items={tripBookItems} onOpenTrip={setRoadbookTripId} />
          )}
        </div>
      )}

      {activeWorkspace === 'review' && reviewMode === 'statistics' && (
        <div className="review-full-page">
          <StatisticsDashboard
            trips={tripReview.trips}
            currentTripId={filters.tripId || undefined}
            currentSegmentId={filters.segmentId || undefined}
            isReadonlyMode={isReadonlyDemoMode}
            onRouteReplacement={(patch) => {
              setTripReview((previous) => applyResolvedRoutePatches(previous, [patch]))
            }}
          />
        </div>
      )}

      <div
        className={`workspace-layout${activeWorkspace === 'review' ? ' has-review-navigation' : ''}${leftPanelCollapsed ? ' left-collapsed' : ''}${rightPanelCollapsed ? ' right-collapsed' : ''}`}
        hidden={showReviewFullPage}
        aria-hidden={showReviewFullPage || undefined}
      >
        {activeWorkspace === 'review' && reviewModeNavigation}
        <div className="compact-panel-tabs" role="tablist" aria-label="工作面板">
          <button
            type="button"
            role="tab"
            aria-selected={compactPanelTab === 'editor'}
            aria-controls="compact-editor-panel"
            className={compactPanelTab === 'editor' ? 'active' : ''}
            onClick={() => setCompactPanelTab('editor')}
          >
            <AppIcon name="edit" className="icon-inline" />
            旅程编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={compactPanelTab === 'details'}
            aria-controls="compact-detail-panel"
            className={compactPanelTab === 'details' ? 'active' : ''}
            onClick={() => {
              setCompactPanelTab('details')
              setDetailPanelTab('details')
            }}
          >
            <AppIcon name="info" className="icon-inline" />
            路段详情
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={compactPanelTab === 'photos'}
            aria-controls="compact-photo-panel"
            className={compactPanelTab === 'photos' ? 'active' : ''}
            onClick={openAlbum}
            disabled={!canOpenAlbum}
            title={canOpenAlbum ? undefined : albumDisabledTitle}
          >
            <AppIcon name="image" className="icon-inline" />
            相册（{activeSegmentPhotos.length}）
          </button>
        </div>

        <aside
          id="compact-editor-panel"
          className="sidebar-column compact-work-panel"
          data-compact-active={compactPanelTab === 'editor'}
          data-collapsed={leftPanelCollapsed || undefined}
        >
          <div className="panel-topbar">
            <span className="panel-topbar-label">旅程编辑</span>
            <button
              type="button"
              className="panel-collapse-btn"
              onClick={() => setLeftPanelCollapsed(true)}
              aria-label="收起旅程编辑面板"
              title="收起面板"
            >
              ‹
            </button>
          </div>
          <div className="panel-body">
          {!tripManagerOpen ? (
            <TripEditor
              trips={workspaceTrips}
              onAddTrip={tripManager.addTrip}
              onAddSegment={tripManager.addSegment}
              isReadonlyMode={isReadonlyDemoMode}
              selectedTripId={filters.tripId}
              selectedDayDate={selectedDay?.date ?? ''}
            />
          ) : (
            <TripManageModal
              trips={workspaceTrips}
              onClose={() => setTripManagerOpen(false)}
              onDeleteTrip={tripManager.deleteTrip}
              onDuplicateTrip={tripManager.duplicateTrip}
              onMoveTrip={tripManager.moveTrip}
              onReorderTrips={tripManager.reorderTrips}
              onUpdateTrip={tripManager.updateTrip}
              onCompleteTrip={handleCompleteTrip}
              isReadonlyMode={isReadonlyDemoMode}
            />
          )}
          </div>
          <button
            type="button"
            className="panel-rail-btn"
            onClick={() => setLeftPanelCollapsed(false)}
            aria-label="展开旅程编辑面板"
            title="展开面板"
          >
            ›
          </button>
        </aside>

        <section className="map-column">
          <div className="map-column-header-row">
            <span>{mapInfo.summary}</span>
          </div>

          <div className="map-canvas-wrap">
            <MapPanel
              filteredSegments={mapRenderSegments}
              routeColorMode={routeColorMode}
              roadTypeVisibility={roadTypeVisibility}
              allTrips={tripReview.trips}
              selectedTripId={filters.tripId}
              isOverviewMode={!filters.tripId}
              editingSegmentId={editingSegmentId}
              onCancelEdit={() => setEditingSegmentId(null)}
              onSaveEdit={(payload) => {
                segmentEditing.saveSegmentTrack(payload)
                setEditingSegmentId(null)
              }}
              selectedWaypoint={segmentEditing.selectedWaypoint}
              photos={activeWorkspace === 'review' && activeSegmentId ? activeSegmentPhotos : []}
              selectedPhotoId={selectedPhotoId}
              onSelectPhoto={selectPhotoAndOpenGallery}
              photoPositionEditId={photoPositionEdit?.photoId ?? null}
              photoPositionEditFilename={photoPositionEdit?.originalFilename ?? ''}
              photoPositionDraft={photoPositionEdit?.draft ?? null}
              isSavingPhotoPosition={isSavingPhotoPosition}
              photoPositionError={photoPositionError}
              onPhotoPositionDraftChange={(coordinate) => {
                setPhotoPositionError('')
                setPhotoPositionEdit((current) => current ? { ...current, draft: coordinate } : current)
              }}
              onSavePhotoPosition={() => void savePhotoPosition()}
              onCancelPhotoPosition={cancelPhotoPositionEdit}
              onRouteResolved={saveResolvedRoutes}
              routeServiceRevision={amapKeyConfig.serviceRevision}
              routeRefreshRequest={routeRefreshRequest}
              onRouteLoadingChange={setIsRouteLoading}
              allowAutoBuild={Boolean(!isReadonlyDemoMode && filters.tripId && filters.dayId && filters.segmentId && mapRenderSegments.length <= 3)}
              isReadonlyMode={isReadonlyDemoMode}
              onEndpointDraftChange={editing.updateEndpointCoords}
            />
          </div>

          <FilterPanel
            trips={workspaceTrips}
            filters={filters}
            onChange={changeFiltersWithDetailGuard}
            routeColorMode={routeColorMode}
            onChangeRouteColorMode={setRouteColorMode}
            roadTypeVisibility={roadTypeVisibility}
            onChangeRoadTypeVisibility={setRoadTypeVisibility}
            canUseScoreColoring={canUseScoreColoring}
            onOpenTripManager={() => setTripManagerOpen(true)}
            onDuplicateTrip={tripManager.duplicateTrip}
            onInsertDayAfter={tripManager.insertDayAfter}
            onDeleteDay={tripManager.deleteDay}
onReorderDaySegments={tripManager.reorderDaySegments}
                        isReadonlyMode={isReadonlyDemoMode}
            tripDistanceText={tripDistanceText}
            dayDistanceText={dayDistanceText}
            tripTollText={tripTollText}
            dayTollText={dayTollText}
            tripDurationText={tripDurationText}
            dayDurationText={dayDurationText}
          />
        </section>

        <aside
          className="detail-column compact-work-panel"
          data-compact-active={compactPanelTab !== 'editor'}
          data-collapsed={rightPanelCollapsed || undefined}
        >
          <div className="detail-panel-tabs" role="tablist" aria-label="路段侧栏">
            <button
              type="button"
              role="tab"
              aria-selected={detailPanelTab === 'details'}
              aria-controls="compact-detail-panel"
              className={detailPanelTab === 'details' ? 'active' : ''}
              onClick={() => setDetailPanelTab('details')}
            >
              <AppIcon name="info" className="icon-inline" />
              路段信息
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailPanelTab === 'photos'}
              aria-controls="compact-photo-panel"
              className={detailPanelTab === 'photos' ? 'active' : ''}
              onClick={openAlbum}
              disabled={!canOpenAlbum}
              title={canOpenAlbum ? undefined : albumDisabledTitle}
            >
              <AppIcon name="image" className="icon-inline" />
              相册（{activeSegmentPhotos.length}）
            </button>
            <button
              type="button"
              className="panel-collapse-btn"
              onClick={() => setRightPanelCollapsed(true)}
              aria-label="收起路段详情面板"
              title="收起面板"
            >
              ›
            </button>
          </div>
          <div className="panel-body">
          <div
            id="compact-detail-panel"
            className="compact-detail-pane detail-content-pane"
            data-compact-active={compactPanelTab === 'details'}
            data-detail-active={detailPanelTab === 'details'}
          >
            <MapPlaceholder
            placeholderMode={placeholderMode}
            tripListItems={tripListItems}
            onViewTrip={(tripId) => changeFiltersWithDetailGuard({ tripId, dayId: '', segmentId: '' })}
            onOpenTripManager={() => setTripManagerOpen(true)}
            onDeleteTrip={tripManager.deleteTrip}
            isReadonlyMode={isReadonlyDemoMode}
            filteredSegments={detailSegments}
            summary={summary}
            filterContext={filterContext}
            activeSegmentId={activeSegmentId}
            activeSegment={activeSegment}
            activeSegmentDate={segmentEditing.activeSegmentDate}
            segmentMetaDraft={segmentMetaDraft}
            onDeleteSegment={tripManager.deleteSegment}
            onStartSegmentMetaEdit={segmentEditing.startSegmentMetaEdit}
            onCancelSegmentMetaEdit={() => setSegmentMetaDraft(null)}
            onSaveSegmentMetaEdit={segmentEditing.saveSegmentMetaEdit}
            onUpdateSegmentMetaDraft={(patch) => {
              setSegmentMetaDraft((prev) => (prev ? { ...prev, ...patch } : prev))
            }}
            routePreference={routePreferenceValue}
            routeMode={routeModeValue}
            onChangeRouteMode={(value) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({ ...segment, routeType: value }))
            }}
            onChangeRoutePreference={(value) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({ ...segment, preference: value }))
            }}
            onMoveSegmentInTrip={tripManager.moveSegmentInTrip}
            canMoveSegmentUp={tripManager.canMoveSegment(activeSegmentId, 'up')}
            canMoveSegmentDown={tripManager.canMoveSegment(activeSegmentId, 'down')}
            waypoints={editingWaypointSegmentId === activeSegmentId ? waypointDrafts : segmentEditing.displayedWaypoints}
            onLocateWaypoint={(waypoint) => setSelectedWaypointId(waypoint.id)}
            onStartWaypointEdit={() => {
              if (activeSegmentId) segmentEditing.startWaypointEdit(activeSegmentId)
            }}
            onCancelWaypointEdit={editing.cancelWaypointEdit}
            onSaveWaypoints={segmentEditing.saveWaypoints}
            onAddWaypoint={segmentEditing.addWaypoint}
            onUpdateWaypointName={editing.updateWaypointName}
            onSelectWaypointPlace={editing.selectWaypointPlace}
            onMoveWaypoint={editing.moveWaypoint}
            onDeleteWaypoint={editing.deleteWaypoint}
            endpointDraft={segmentEditing.effectiveEndpointDraft}
            onStartEndpointEdit={() => {
              if (activeSegmentId) segmentEditing.startEndpointsEdit(activeSegmentId)
            }}
            onCancelEndpointEdit={editing.cancelEndpointEdit}
            onSaveEndpoints={segmentEditing.saveEndpoints}
            onUpdateEndpointText={editing.updateEndpointText}
            onSelectEndpointPlace={editing.selectEndpointPlace}
            onUpdateSegmentScore={(field, value) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({
                ...segment,
                [field]: normalizeScore(value),
              }))
            }}
            onUpdateSegmentNote={(value) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({
                ...segment,
                note: normalizeSegmentNote(value),
              }))
            }}
            onUpdateSegmentReviewFacts={(facts) => {
              if (!activeSegmentId) return
              tripManager.updateSegment(activeSegmentId, (segment) => ({
                ...segment,
                reviewFacts: facts,
              }))
            }}
            onDetailDraftStateChange={setDetailDraftState}
            onRefreshRouteEstimate={() => {
              if (!activeSegmentId) return
              setRouteRefreshRequest((current) => ({
                segmentId: activeSegmentId,
                revision: current.revision + 1,
              }))
            }}
            isRouteEstimateRefreshing={Boolean(
              isRouteLoading && activeSegmentId && routeRefreshRequest.segmentId === activeSegmentId
            )}
          />
          </div>
          <div
            id="compact-photo-panel"
            className="compact-photo-pane detail-content-pane"
            data-compact-active={compactPanelTab === 'photos'}
            data-detail-active={detailPanelTab === 'photos'}
          >
            {activeWorkspace === 'review' && activeSegment && (
              <SegmentPhotoGallery
              tripId={filters.tripId}
              segment={activeSegment}
              tripReview={tripReview}
              setTripReview={setTripReview}
              isReadonlyMode={isReadonlyDemoMode}
              selectedPhotoId={selectedPhotoId}
              onSelectPhoto={selectPhotoAndOpenGallery}
              onClearSelectedPhoto={clearSelectedPhoto}
              onPhotosChange={setActiveSegmentPhotos}
              externalRevision={photoDataRevision}
              onStartPhotoPosition={startPhotoPositionEdit}
              onSetCoverPhoto={setTripCoverPhoto}
              />
            )}
          </div>
          </div>
          <button
            type="button"
            className="panel-rail-btn"
            onClick={() => setRightPanelCollapsed(false)}
            aria-label="展开路段详情面板"
            title="展开面板"
          >
            ‹
          </button>
        </aside>
      </div>

      {appMode === 'readonly-demo' && <footer className="app-mode-footer">演示只读模式</footer>}

      <AmapKeySetupDialog
        open={amapKeyConfig.isOpen}
        configured={amapKeyConfig.configured}
        source={amapKeyConfig.source}
        isSaving={amapKeyConfig.isSaving}
        error={amapKeyConfig.error}
        onSave={amapKeyConfig.save}
        onClose={amapKeyConfig.close}
      />
      <ConfirmDialogHost />
      <ToastHost />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  )
}

export default App

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { alertDialog, confirmDialog, promptDialog } from './ConfirmDialog'
import EmptyState from './EmptyState'
import { useSegmentPhotoGallery } from '../hooks/useSegmentPhotoGallery'
import type { RouteSegment, TripReview } from '../types/trip'
import SegmentPhotoThumbnail from './SegmentPhotoThumbnail'
import PhotoViewerDialog from './PhotoViewerDialog'
import type { LinkedPhotoRecord } from '../types/photo'
import PhotoCandidatePickerDialog from './PhotoCandidatePickerDialog'

const PHOTO_RENDER_BATCH_SIZE = 40

interface SegmentPhotoGalleryProps {
  tripId: string
  segment: RouteSegment
  tripReview: TripReview
  setTripReview: Dispatch<SetStateAction<TripReview>>
  isReadonlyMode: boolean
  selectedPhotoId: string | null
  onSelectPhoto: (photoId: string) => void
  onClearSelectedPhoto: () => void
  onPhotosChange: (photos: LinkedPhotoRecord[]) => void
  externalRevision: number
  onStartPhotoPosition: (photo: LinkedPhotoRecord) => void
  onSetCoverPhoto: (photoId: string | null) => Promise<void>
}

function SegmentPhotoGallery({
  tripId,
  segment,
  tripReview,
  setTripReview,
  isReadonlyMode,
  selectedPhotoId,
  onSelectPhoto,
  onClearSelectedPhoto,
  onPhotosChange,
  externalRevision,
  onStartPhotoPosition,
  onSetCoverPhoto,
}: SegmentPhotoGalleryProps) {
  const gallery = useSegmentPhotoGallery({
    tripId,
    segmentId: segment.id,
    tripReview,
    setTripReview,
    isReadonlyMode,
    externalRevision,
  })
  useEffect(() => onClearSelectedPhoto(), [onClearSelectedPhoto, segment.id])
  const [visiblePhotoCount, setVisiblePhotoCount] = useState(PHOTO_RENDER_BATCH_SIZE)
  const [candidatePickerOpen, setCandidatePickerOpen] = useState(false)
  const [repairSelections, setRepairSelections] = useState<Record<string, string>>({})
  const [photoSearch, setPhotoSearch] = useState('')
  const [photoFilter, setPhotoFilter] = useState<'all' | 'located' | 'unlocated' | 'issues'>('all')
  const [photoSort, setPhotoSort] = useState<'captured-asc' | 'captured-desc' | 'name'>('captured-asc')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set())
  const [bulkTargetSegmentId, setBulkTargetSegmentId] = useState('')
  useEffect(() => {
    setVisiblePhotoCount(PHOTO_RENDER_BATCH_SIZE)
    setCandidatePickerOpen(false)
    setRepairSelections({})
    setPhotoSearch('')
    setPhotoFilter('all')
    setSelectionMode(false)
    setSelectedPhotoIds(new Set())
    setBulkTargetSegmentId('')
  }, [segment.id])
  useEffect(() => {
    onPhotosChange(gallery.photos.filter((photo) => photo.segmentId === segment.id))
  }, [gallery.photos, onPhotosChange, segment.id])
  const candidates = gallery.scanResult?.newFiles ?? []
  const changedPhotos = gallery.scanResult?.changed ?? []
  const missingPhotos = gallery.scanResult?.missing ?? []
  const relocationCandidates = new Map(
    (gallery.scanResult?.relocationCandidates ?? []).map((item) => [item.photoId, item.candidates]),
  )
  const issuePhotoIds = new Set([...changedPhotos.map((item) => item.photoId), ...missingPhotos.map((item) => item.photoId)])
  const filteredPhotos = useMemo(() => {
    const query = photoSearch.trim().toLocaleLowerCase()
    const next = gallery.photos.filter((photo) => {
      if (query && !`${photo.originalFilename} ${photo.note ?? ''}`.toLocaleLowerCase().includes(query)) return false
      if (photoFilter === 'located' && !photo.mapPosition) return false
      if (photoFilter === 'unlocated' && photo.mapPosition) return false
      if (photoFilter === 'issues' && !issuePhotoIds.has(photo.id)) return false
      return true
    })
    return next.sort((left, right) => {
      if (photoSort === 'name') return left.originalFilename.localeCompare(right.originalFilename, 'zh-CN')
      const comparison = (left.capturedAt ?? left.importedAt).localeCompare(right.capturedAt ?? right.importedAt)
      return photoSort === 'captured-desc' ? -comparison : comparison
    })
  }, [gallery.photos, photoFilter, photoSearch, photoSort, changedPhotos, missingPhotos])
  const visiblePhotos = filteredPhotos.slice(0, visiblePhotoCount)
  const consistencyIssueCount = gallery.consistencyReport
    ? gallery.consistencyReport.missingMetadataPhotoIds.length
      + gallery.consistencyReport.orphanMetadataPhotoIds.length
      + gallery.consistencyReport.planPhotoIds.length
      + gallery.consistencyReport.duplicateReferences.length
      + gallery.consistencyReport.segmentMismatches.length
    : 0
  const libraryIssueCount = changedPhotos.length
    + missingPhotos.length
    + (gallery.scanResult?.issues.length ?? 0)
    + consistencyIssueCount
  const reviewSegmentOptions = useMemo(() => tripReview.trips.flatMap((trip) => (
    trip.id === tripId && trip.category === 'review'
      ? trip.days.flatMap((day) => day.routeSegments
          .filter((candidate) => candidate.id !== segment.id)
          .map((candidate) => ({ id: candidate.id, label: `${trip.title} · ${day.date} · ${candidate.name}` })))
      : []
  )), [segment.id, tripId, tripReview.trips])

  const toggleExistingPhoto = (photoId: string) => {
    setSelectedPhotoIds((current) => {
      const next = new Set(current)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  const handleAddPhotos = async () => {
    if (gallery.roots.length === 0) {
      await gallery.chooseRoot()
      return
    }
    if (candidates.length > 0) {
      setCandidatePickerOpen(true)
      return
    }
    if (gallery.selectedRootId) await gallery.scanRoot(gallery.selectedRootId)
  }

  const runBulkAction = async (action: 'refresh' | 'restore-position' | 'clear-position' | 'move' | 'remove') => {
    const ids = Array.from(selectedPhotoIds)
    if (ids.length === 0) return
    if (action === 'remove') {
      const confirmed = await confirmDialog({
        title: '批量移除照片',
        message: `确定从当前路段移除选中的 ${ids.length} 张照片吗？本地原图不会删除。`,
        confirmText: '移除',
        danger: true,
      })
      if (!confirmed) return
    }
    try {
      if (action === 'clear-position') await gallery.clearPhotoPositions(ids)
      else if (action === 'move') {
        if (!bulkTargetSegmentId) return
        await gallery.movePhotosToSegment(ids, bulkTargetSegmentId)
      } else {
        let failureCount = 0
        for (const photoId of ids) {
          try {
            if (action === 'refresh') await gallery.refreshPhotoMetadata(photoId)
            else if (action === 'restore-position') await gallery.restorePhotoExifPosition(photoId)
            else await gallery.removePhoto(photoId)
          } catch {
            failureCount += 1
          }
        }
        if (failureCount > 0) await alertDialog(`${failureCount} 张照片处理失败，请查看相册中的错误提示。`)
      }
      setSelectedPhotoIds(new Set())
      setSelectionMode(false)
    } catch (bulkError) {
      await alertDialog(bulkError instanceof Error ? bulkError.message : String(bulkError))
    }
  }

  return (
    <section className="card-section segment-photo-gallery" aria-label="当前路段相册">
      <div className="segment-photo-header">
        <div>
          <h2>路段相册</h2>
          <p>{segment.name} · {gallery.photos.length} 张照片</p>
        </div>
        {!isReadonlyMode && gallery.desktopAvailable && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleAddPhotos()}
            disabled={gallery.isImporting || gallery.isScanning}
          >
            {candidates.length > 0 ? `添加照片（${candidates.length}）` : '添加照片'}
          </button>
        )}
      </div>

      {!gallery.desktopAvailable ? (
        <p className="hint-text">相册的本地文件访问功能仅在桌面版 EXE 中可用。</p>
      ) : (
        <>
          <details className="photo-library-diagnostics" open={libraryIssueCount > 0 || gallery.roots.length === 0}>
            <summary>
              <span>相册设置与诊断</span>
              {libraryIssueCount > 0 && <strong>{libraryIssueCount} 项待处理</strong>}
            </summary>
            <div className="photo-library-diagnostics-body">
          <div className="segment-photo-library-row">
            <select
              value={gallery.selectedRootId}
              onChange={(event) => gallery.setSelectedRootId(event.target.value)}
              disabled={gallery.roots.length === 0 || gallery.isImporting}
              aria-label="照片库"
            >
              <option value="">选择照片库</option>
              {gallery.roots.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}
            </select>
            <button
              type="button"
              disabled={!gallery.selectedRootId || gallery.isScanning || gallery.isImporting || isReadonlyMode}
              onClick={() => void gallery.scanRoot(gallery.selectedRootId)}
            >
              {gallery.isScanning ? '扫描中…' : '扫描新照片'}
            </button>
            {gallery.isScanning && <button type="button" className="btn-secondary" onClick={gallery.cancelScan}>取消扫描</button>}
            <button
              type="button"
              disabled={!gallery.selectedRootId || gallery.isScanning || gallery.isImporting || isReadonlyMode}
              onClick={() => void gallery.relinkSelectedRoot()}
            >
              重新关联
            </button>
          </div>

          {gallery.rootSummary && (
            <div className="photo-library-summary">
              <div>
                <strong>{gallery.rootSummary.root.name}</strong>
                <span title={gallery.rootSummary.root.path}>{gallery.rootSummary.root.path}</span>
                <small>{gallery.rootSummary.available ? '目录可访问' : '目录不可访问'} · 已关联 {gallery.rootSummary.photoCount} 张</small>
              </div>
              {!isReadonlyMode && (
                <div>
                  <button type="button" className="btn-text" onClick={() => {
                    void (async () => {
                      const name = await promptDialog({
                        title: '修改照片库名称',
                        message: '输入新的照片库名称：',
                        input: {
                          label: '照片库名称',
                          placeholder: '照片库名称',
                          defaultValue: gallery.rootSummary?.root.name ?? '',
                        },
                      })
                      if (name) {
                        try {
                          await gallery.renameSelectedRoot(name)
                        } catch (error) {
                          void alertDialog(error instanceof Error ? error.message : String(error))
                        }
                      }
                    })()
                  }}>改名</button>
                  <button type="button" className="btn-danger" disabled={gallery.rootSummary.photoCount > 0} onClick={() => {
                    void (async () => {
                      const confirmed = await confirmDialog({
                        title: '移除照片库',
                        message: '只移除软件中的照片库登记，不会删除本地目录和原图。确定继续吗？',
                        confirmText: '移除',
                        danger: true,
                      })
                      if (!confirmed) return
                      try {
                        await gallery.deleteSelectedRoot()
                      } catch (error) {
                        void alertDialog(error instanceof Error ? error.message : String(error))
                      }
                    })()
                  }}>移除照片库</button>
                </div>
              )}
            </div>
          )}

          {gallery.scanProgress && (
            <div className="segment-photo-progress">
              <span>正在扫描：已检查 {gallery.scanProgress.processedEntries} 项，发现 {gallery.scanProgress.discoveredPhotos} 张照片</span>
              <small title={gallery.scanProgress.currentDirectory}>{gallery.scanProgress.currentDirectory}</small>
            </div>
          )}

          {gallery.scanResult?.status === 'available' && (
            <div className="photo-library-health-grid">
              <span>支持格式 {gallery.scanResult.files.length}</span>
              <span>未关联 {gallery.scanResult.newFiles.length}</span>
              <span>未变化 {gallery.scanResult.unchangedPhotoIds.length}</span>
              <span>内容变化 {gallery.scanResult.changed.length}</span>
              <span>缺失 {gallery.scanResult.missing.length}</span>
              <span>扫描问题 {gallery.scanResult.issues.length}</span>
            </div>
          )}

          {(gallery.scanResult?.issues.length ?? 0) > 0 && (
            <details className="photo-scan-issues">
              <summary>查看扫描问题（{gallery.scanResult?.issues.length}）</summary>
              <ul>
                {gallery.scanResult?.issues.slice(0, 20).map((issue, index) => (
                  <li key={`${issue.relativePath}-${issue.code}-${index}`}>
                    <strong>{issue.relativePath || '照片库根目录'}</strong>：{issue.code === 'PHOTO_CONVERSION_REQUIRED' ? 'HEIC/HEIF 请先转换为 JPEG 或 WebP' : issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="photo-consistency-actions">
            <button type="button" onClick={() => {
              void gallery.runConsistencyAudit().catch((error) => void alertDialog(error instanceof Error ? error.message : String(error)))
            }}>检查照片关联一致性</button>
            {gallery.consistencyReport && (
              <span>{consistencyIssueCount === 0 ? '未发现关联问题' : `发现 ${consistencyIssueCount} 项关联问题`}</span>
            )}
            {consistencyIssueCount > 0 && !isReadonlyMode && (
              <button type="button" className="btn-danger" onClick={() => {
                void (async () => {
                  const confirmed = await confirmDialog({
                    title: '修复照片关联',
                    message: '将移除无效/重复引用、清理孤立索引，并修正照片所属路段。是否继续？',
                    confirmText: '开始修复',
                    danger: true,
                  })
                  if (!confirmed) return
                  await gallery.repairConsistency().catch((error) => void alertDialog(error instanceof Error ? error.message : String(error)))
                })()
              }}>修复一致性</button>
            )}
          </div>

          {(changedPhotos.length > 0 || missingPhotos.length > 0) && (
            <div className="segment-photo-repair-panel">
              <strong>照片库需要处理</strong>
              {changedPhotos.map((item) => {
                const photo = gallery.photos.find((candidate) => candidate.id === item.photoId)
                if (!photo) return null
                return (
                  <div key={`changed-${item.photoId}`} className="segment-photo-repair-row">
                    <span>{photo.originalFilename}：原图内容已变化</span>
                    <button
                      type="button"
                      disabled={Boolean(gallery.updatingPhotoId)}
                      onClick={() => void gallery.refreshPhotoMetadata(item.photoId)}
                    >
                      接受变化并刷新
                    </button>
                  </div>
                )
              })}
              {missingPhotos.map((item) => {
                const photo = gallery.photos.find((candidate) => candidate.id === item.photoId)
                if (!photo) return null
                const matches = relocationCandidates.get(item.photoId) ?? []
                const selectedPath = repairSelections[item.photoId] ?? matches[0]?.relativePath ?? ''
                return (
                  <div key={`missing-${item.photoId}`} className="segment-photo-repair-row">
                    <span>{photo.originalFilename}：原图已移动或缺失</span>
                    {matches.length > 1 && (
                      <select
                        value={selectedPath}
                        onChange={(event) => setRepairSelections((current) => ({
                          ...current,
                          [item.photoId]: event.target.value,
                        }))}
                        disabled={Boolean(gallery.updatingPhotoId)}
                        aria-label={`选择 ${photo.originalFilename} 的新位置`}
                      >
                        {matches.map((match) => (
                          <option key={match.relativePath} value={match.relativePath}>{match.relativePath}</option>
                        ))}
                      </select>
                    )}
                    {matches.length > 0 && (
                      <button
                        type="button"
                        disabled={Boolean(gallery.updatingPhotoId)}
                        onClick={() => void gallery.repairPhotoPath(item.photoId, selectedPath)}
                      >
                        {matches.length === 1 ? '一键重新关联' : '关联所选文件'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(gallery.updatingPhotoId)}
                      onClick={() => void gallery.repairPhotoPath(item.photoId)}
                    >
                      手工选择文件
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {gallery.progress && (
            <div className="segment-photo-progress">
              <progress max={gallery.progress.total} value={gallery.progress.completed} />
              <span>{gallery.progress.completed}/{gallery.progress.total}，成功 {gallery.progress.succeeded}，失败 {gallery.progress.failed}</span>
            </div>
          )}
          {gallery.message && <p className="hint-text">{gallery.message}</p>}
          {gallery.error && <p className="error-text">{gallery.error}</p>}
            </div>
          </details>

          {candidates.length > 0 && (
            <div className="segment-photo-candidates">
              <div className="segment-photo-candidate-actions">
                <div>
                  <strong>待添加照片：{candidates.length} 张</strong>
                  <span>已选择 {gallery.selectedRelativePaths.size} 张</span>
                </div>
                <button type="button" className="btn-primary" onClick={() => setCandidatePickerOpen(true)} disabled={gallery.isImporting}>
                  选择并添加
                </button>
              </div>
              <p>从本次扫描结果中挑选照片，关联到当前路段。</p>
              {gallery.isImporting && <button type="button" className="btn-secondary" onClick={gallery.cancelImport}>取消关联</button>}
            </div>
          )}
        </>
      )}

      {gallery.isLoading ? (
        <div className="photo-grid-skeleton" aria-label="正在读取相册">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="photo-grid-skeleton-card"><div className="shimmer" /><span className="shimmer-line" /></div>)}
        </div>
      ) : gallery.photos.length > 0 ? (
        <>
          <div className="photo-gallery-controls">
            <input value={photoSearch} onChange={(event) => setPhotoSearch(event.target.value)} placeholder="搜索文件名或备注" />
            <select value={photoFilter} onChange={(event) => setPhotoFilter(event.target.value as typeof photoFilter)}>
              <option value="all">全部照片</option>
              <option value="located">已有地图位置</option>
              <option value="unlocated">尚未定位</option>
              <option value="issues">文件异常</option>
            </select>
            <select value={photoSort} onChange={(event) => setPhotoSort(event.target.value as typeof photoSort)}>
              <option value="captured-asc">拍摄时间升序</option>
              <option value="captured-desc">拍摄时间降序</option>
              <option value="name">文件名</option>
            </select>
            {!isReadonlyMode && <button type="button" onClick={() => {
              setSelectionMode((value) => !value)
              setSelectedPhotoIds(new Set())
            }}>{selectionMode ? '退出批量选择' : '批量选择'}</button>}
          </div>
          {selectionMode && (
            <div className="photo-bulk-actions">
              <span>已选择 {selectedPhotoIds.size} 张</span>
              <button type="button" disabled={selectedPhotoIds.size === 0} onClick={() => void runBulkAction('refresh')}>批量刷新信息</button>
              <button type="button" disabled={selectedPhotoIds.size === 0} onClick={() => void runBulkAction('restore-position')}>批量恢复 EXIF 位置</button>
              <button type="button" disabled={selectedPhotoIds.size === 0} onClick={() => void runBulkAction('clear-position')}>清除地图位置</button>
              <select value={bulkTargetSegmentId} onChange={(event) => setBulkTargetSegmentId(event.target.value)}>
                <option value="">选择目标路段</option>
                {reviewSegmentOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <button type="button" disabled={selectedPhotoIds.size === 0 || !bulkTargetSegmentId} onClick={() => void runBulkAction('move')}>移动到目标路段</button>
              <button type="button" className="danger-btn" disabled={selectedPhotoIds.size === 0} onClick={() => void runBulkAction('remove')}>批量移除</button>
            </div>
          )}
          <div className="segment-photo-grid">
            {visiblePhotos.map((photo) => (
              <SegmentPhotoThumbnail
                key={photo.id}
                photo={photo}
                onOpen={onSelectPhoto}
                selectionMode={selectionMode}
                selected={selectedPhotoIds.has(photo.id)}
                onToggleSelection={toggleExistingPhoto}
              />
            ))}
          </div>
          {filteredPhotos.length === 0 && (
            <EmptyState
              icon="photo"
              title="没有符合条件的照片"
              description="调整搜索关键词或筛选条件后重试。"
            />
          )}
        </>
      ) : (
        <EmptyState
          icon="photo"
          title="当前路段还没有照片"
          description="使用上方「添加照片」扫描并关联照片到当前路段。"
        />
      )}

      {!gallery.isLoading && visiblePhotoCount < filteredPhotos.length && (
        <button
          type="button"
          className="btn-text segment-photo-load-more"
          onClick={() => setVisiblePhotoCount((count) => count + PHOTO_RENDER_BATCH_SIZE)}
        >
          加载更多照片（剩余 {filteredPhotos.length - visiblePhotoCount}）
        </button>
      )}

      {selectedPhotoId && (
        <PhotoViewerDialog
          photos={gallery.photos}
          selectedPhotoId={selectedPhotoId}
          isReadonlyMode={isReadonlyMode}
          isUpdating={gallery.updatingPhotoId === selectedPhotoId}
          coverPhotoId={tripReview.trips.find((trip) => trip.id === tripId)?.coverPhotoId ?? null}
          onSetCoverPhoto={onSetCoverPhoto}
          onSelect={onSelectPhoto}
          onClose={onClearSelectedPhoto}
          onSaveNote={gallery.updatePhotoNote}
          onRefreshMetadata={gallery.refreshPhotoMetadata}
          onRemove={gallery.removePhoto}
          onStartPosition={onStartPhotoPosition}
          onRestoreExifPosition={gallery.restorePhotoExifPosition}
          onRepairPath={gallery.repairPhotoPath}
        />
      )}

      {candidatePickerOpen && candidates.length > 0 && (
        <PhotoCandidatePickerDialog
          rootId={gallery.selectedRootId}
          files={gallery.scanResult?.files ?? candidates}
          unlinkedRelativePaths={new Set(candidates.map((file) => file.relativePath))}
          initialSelectedPaths={gallery.selectedRelativePaths}
          isImporting={gallery.isImporting}
          onClose={() => setCandidatePickerOpen(false)}
          onImport={(relativePaths) => {
            setCandidatePickerOpen(false)
            void gallery.importCandidatePaths(relativePaths)
          }}
        />
      )}
    </section>
  )
}

export default SegmentPhotoGallery

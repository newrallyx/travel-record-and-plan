import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirmDialog } from './ConfirmDialog'
import { AppIcon } from './icons'
import { PhotoFilmStrip } from './PhotoFilmStrip'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { electronPhotoRepository } from '../services/electronPhotoRepository'
import type { LinkedPhotoRecord, PhotoAvailability } from '../types/photo'

interface PhotoViewerDialogProps {
  photos: LinkedPhotoRecord[]
  selectedPhotoId: string
  isReadonlyMode: boolean
  isUpdating: boolean
  coverPhotoId: string | null
  onSetCoverPhoto: (photoId: string | null) => Promise<void>
  onSelect: (photoId: string) => void
  onClose: () => void
  onSaveNote: (photoId: string, note: string) => Promise<void>
  onRefreshMetadata: (photoId: string, originalBlob?: Blob) => Promise<void>
  onRemove: (photoId: string) => Promise<void>
  onStartPosition: (photo: LinkedPhotoRecord) => void
  onRestoreExifPosition: (photoId: string) => Promise<void>
  onRepairPath: (photoId: string, relativePath?: string) => Promise<void>
}

function getAvailabilityText(availability: PhotoAvailability | null): string {
  if (availability === 'changed') return '本地原图已发生变化，当前显示最新文件内容。'
  if (availability === 'missing') return '本地原图已被移动或删除。'
  if (availability === 'root-unavailable') return '照片库当前不可访问，请检查磁盘连接。'
  return ''
}

function getOrientationText(orientation?: number): string {
  const labels: Record<number, string> = {
    1: '正常',
    2: '水平镜像',
    3: '旋转 180°',
    4: '垂直镜像',
    5: '镜像并旋转 90°',
    6: '旋转 90°',
    7: '镜像并旋转 270°',
    8: '旋转 270°',
  }
  return orientation ? labels[orientation] ?? `EXIF ${orientation}` : '尚未读取'
}

function PhotoViewerDialog({
  photos,
  selectedPhotoId,
  isReadonlyMode,
  isUpdating,
  coverPhotoId,
  onSetCoverPhoto,
  onSelect,
  onClose,
  onSaveNote,
  onRefreshMetadata,
  onRemove,
  onStartPosition,
  onRestoreExifPosition,
  onRepairPath,
}: PhotoViewerDialogProps) {
  const selectedIndex = photos.findIndex((photo) => photo.id === selectedPhotoId)
  const photo = selectedIndex >= 0 ? photos[selectedIndex] : null
  const dialogRef = useRef<HTMLElement | null>(null)
  useFocusTrap(dialogRef, Boolean(photo))
  const [originalUrl, setOriginalUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [availability, setAvailability] = useState<PhotoAvailability | null>(null)
  const [noteDraft, setNoteDraft] = useState(photo?.note ?? '')
  const [savedNote, setSavedNote] = useState(photo?.note ?? '')
  const [noteSaveStatus, setNoteSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [actionError, setActionError] = useState('')
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const refreshMetadataRef = useRef(onRefreshMetadata)

  const previousPhotoId = selectedIndex > 0 ? photos[selectedIndex - 1].id : null
  const nextPhotoId = selectedIndex >= 0 && selectedIndex < photos.length - 1 ? photos[selectedIndex + 1].id : null
  const availabilityText = useMemo(() => getAvailabilityText(availability), [availability])
  const noteDirty = noteDraft !== savedNote

  useEffect(() => {
    refreshMetadataRef.current = onRefreshMetadata
  }, [onRefreshMetadata])

  useEffect(() => {
    if (!photo) return
    const currentPhoto = photo
    setNoteDraft(currentPhoto.note ?? '')
    setSavedNote(currentPhoto.note ?? '')
    setNoteSaveStatus('idle')
    setZoom(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    setActionError('')
    setLoadError('')
    setOriginalUrl('')
    setAvailability(null)
    setIsLoading(true)
    let cancelled = false
    let objectUrl = ''

    async function loadOriginal() {
      try {
        const status = await electronPhotoRepository.checkPhotoAvailability(currentPhoto.id)
        if (cancelled) return
        setAvailability(status.availability)
        if (status.availability === 'missing' || status.availability === 'root-unavailable') return

        const asset = await electronPhotoRepository.readOriginal(currentPhoto.id)
        if (cancelled) return
        objectUrl = URL.createObjectURL(asset.blob)
        setOriginalUrl(objectUrl)
        if (!currentPhoto.metadataReadAt && !isReadonlyMode) {
          try {
            await refreshMetadataRef.current(currentPhoto.id, asset.blob)
          } catch (error) {
            if (!cancelled) setActionError(error instanceof Error ? error.message : String(error))
          }
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadOriginal()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [isReadonlyMode, photo?.id])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const saveNote = useCallback(async (): Promise<boolean> => {
    if (!photo || isReadonlyMode || !noteDirty) return true
    setActionError('')
    setNoteSaveStatus('saving')
    try {
      await onSaveNote(photo.id, noteDraft)
      setSavedNote(noteDraft)
      setNoteSaveStatus('saved')
      return true
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      setNoteSaveStatus('error')
      return false
    }
  }, [isReadonlyMode, noteDirty, noteDraft, onSaveNote, photo])

  const selectAfterSaving = useCallback(async (photoId: string | null) => {
    if (!photoId) return
    if (!await saveNote()) return
    onSelect(photoId)
  }, [onSelect, saveNote])

  const closeAfterSaving = useCallback(async () => {
    if (!await saveNote()) return
    onClose()
  }, [onClose, saveNote])

  const startPositionAfterSaving = useCallback(async () => {
    if (!photo || !await saveNote()) return
    onStartPosition(photo)
    onClose()
  }, [onClose, onStartPosition, photo, saveNote])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void closeAfterSaving()
        return
      }
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowLeft' && previousPhotoId) {
        event.preventDefault()
        void selectAfterSaving(previousPhotoId)
      }
      if (event.key === 'ArrowRight' && nextPhotoId) {
        event.preventDefault()
        void selectAfterSaving(nextPhotoId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeAfterSaving, nextPhotoId, previousPhotoId, selectAfterSaving])

  if (!photo) return null

  const removePhoto = async () => {
    const confirmed = await confirmDialog({
      title: '从路段移除照片',
      message: '确定从当前路段移除这张照片吗？只会删除软件中的索引和缩略图，不会删除本地原图。',
      confirmText: '移除',
      danger: true,
    })
    if (!confirmed) return
    setActionError('')
    try {
      const replacementPhotoId = nextPhotoId ?? previousPhotoId
      await onRemove(photo.id)
      if (replacementPhotoId) onSelect(replacementPhotoId)
      else onClose()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const restoreExifPosition = async () => {
    setActionError('')
    try {
      await onRestoreExifPosition(photo.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const refreshMetadata = async () => {
    setActionError('')
    try {
      await onRefreshMetadata(photo.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="photo-viewer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) void closeAfterSaving()
    }}>
      <section
        ref={dialogRef}
        className="photo-viewer-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`查看照片 ${photo.originalFilename}`}
      >
        <header className="photo-viewer-header">
          <div>
            <strong>{photo.originalFilename}</strong>
            <span>{selectedIndex + 1} / {photos.length}</span>
          </div>
          <button type="button" className="btn-secondary" onClick={() => void closeAfterSaving()} aria-label="关闭照片查看器">关闭</button>
        </header>

        <div className="photo-viewer-main">
          <div
            className="photo-viewer-stage"
            onWheel={(event) => {
              if (!originalUrl) return
              event.preventDefault()
              setZoom((value) => Math.max(0.5, Math.min(4, value + (event.deltaY < 0 ? 0.2 : -0.2))))
            }}
            onDoubleClick={() => {
              setZoom(1)
              setRotation(0)
              setOffset({ x: 0, y: 0 })
            }}
            onMouseDown={(event) => {
              if (!originalUrl) return
              dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y }
            }}
            onMouseMove={(event) => {
              const drag = dragRef.current
              if (!drag) return
              setOffset({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY })
            }}
            onMouseUp={() => { dragRef.current = null }}
            onMouseLeave={() => { dragRef.current = null }}
          >
            {previousPhotoId && (
              <button
                type="button"
                className="photo-viewer-nav photo-viewer-nav-prev"
                onClick={() => void selectAfterSaving(previousPhotoId)}
                disabled={noteSaveStatus === 'saving'}
                aria-label="上一张照片"
              >
                <AppIcon name="chevronLeft" className="icon-inline" />
              </button>
            )}
            {nextPhotoId && (
              <button
                type="button"
                className="photo-viewer-nav photo-viewer-nav-next"
                onClick={() => void selectAfterSaving(nextPhotoId)}
                disabled={noteSaveStatus === 'saving'}
                aria-label="下一张照片"
              >
                <AppIcon name="chevronRight" className="icon-inline" />
              </button>
            )}
            {isLoading && <span>正在读取本地原图…</span>}
            {!isLoading && originalUrl && (
              <img
                src={originalUrl}
                alt={photo.originalFilename}
                draggable={false}
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`,
                  cursor: zoom > 1 ? 'grab' : 'default',
                }}
              />
            )}
            {!isLoading && !originalUrl && <span>{loadError || availabilityText || '原图不可用。'}</span>}
            <PhotoFilmStrip photos={photos} selectedPhotoId={selectedPhotoId} onSelect={(photoId) => void selectAfterSaving(photoId)} />
          </div>

          <aside className="photo-viewer-sidebar">
            <dl>
              <div><dt>拍摄时间</dt><dd>{photo.capturedAt ? new Date(photo.capturedAt).toLocaleString() : (photo.metadataReadAt ? 'EXIF 中未发现拍摄时间' : '尚未读取')}</dd></div>
              <div><dt>照片方向</dt><dd>{photo.orientation ? getOrientationText(photo.orientation) : (photo.metadataReadAt ? 'EXIF 中未发现方向' : '尚未读取')}</dd></div>
              <div>
                <dt>原始 GPS（WGS-84）</dt>
                <dd>{photo.originalGps ? `${photo.originalGps.lat.toFixed(6)}, ${photo.originalGps.lon.toFixed(6)}` : (photo.metadataReadAt ? 'EXIF 中未发现 GPS 经纬度' : '尚未读取')}</dd>
              </div>
              <div>
                <dt>地图坐标</dt>
                <dd>
                  {photo.mapPosition
                    ? `${photo.mapPosition.lat.toFixed(6)}, ${photo.mapPosition.lon.toFixed(6)}（${photo.mapPosition.coordinateSystem}）`
                    : '尚未定位'}
                </dd>
              </div>
              <div><dt>本地路径</dt><dd title={photo.relativePath}>{photo.relativePath}</dd></div>
              <div><dt>文件大小</dt><dd>{(photo.fingerprint.size / 1024 / 1024).toFixed(1)} MB</dd></div>
            </dl>
            {availabilityText && <p className={availability === 'changed' ? 'hint-text' : 'error-text'}>{availabilityText}</p>}
            {!isReadonlyMode && availability === 'changed' && (
              <button type="button" onClick={() => void refreshMetadata()} disabled={isUpdating}>接受变化并刷新照片</button>
            )}
            {!isReadonlyMode && availability === 'missing' && (
              <button type="button" onClick={() => {
                setActionError('')
                void onRepairPath(photo.id).catch((error) => setActionError(error instanceof Error ? error.message : String(error)))
              }} disabled={isUpdating}>重新关联原图</button>
            )}

            <label className="photo-viewer-note">
              <span>
                照片备注
                <small className={`photo-note-save-state ${noteDirty ? 'is-dirty' : ''}`} role="status">
                  {noteSaveStatus === 'saving'
                    ? '保存中…'
                    : noteSaveStatus === 'saved' && !noteDirty
                      ? '已保存'
                      : noteSaveStatus === 'error'
                        ? '保存失败'
                        : noteDirty ? '未保存' : ''}
                </small>
              </span>
              <textarea
                value={noteDraft}
                onChange={(event) => {
                  setNoteDraft(event.target.value)
                  setNoteSaveStatus('idle')
                }}
                rows={5}
                disabled={isReadonlyMode || isUpdating}
                placeholder="记录照片背后的故事或当时的感受"
              />
            </label>
            {!isReadonlyMode && (
              <div className="photo-viewer-metadata-actions">
                <button
                  type="button"
                  className="photo-viewer-cover-button"
                  onClick={() => {
                    setActionError('')
                    void onSetCoverPhoto(coverPhotoId === photo.id ? null : photo.id)
                      .catch((error) => setActionError(error instanceof Error ? error.message : String(error)))
                  }}
                  disabled={isUpdating}
                >
                  {coverPhotoId === photo.id ? '取消旅程封面' : '设为旅程封面'}
                </button>
                <button type="button" className="btn-primary" onClick={() => void saveNote()} disabled={isUpdating || noteSaveStatus === 'saving' || !noteDirty}>保存备注</button>
                <button type="button" onClick={() => void refreshMetadata()} disabled={isUpdating}>重新读取照片信息</button>
                <button
                  type="button"
                  onClick={() => void startPositionAfterSaving()}
                  disabled={isUpdating}
                >
                  {photo.mapPosition ? '调整地图位置' : '在地图上定位'}
                </button>
                {photo.originalGps && (
                  <button
                    type="button"
                    onClick={() => void restoreExifPosition()}
                    disabled={isUpdating || (photo.mapPosition?.source === 'exif' && !photo.mapPosition.manuallyAdjusted)}
                  >
                    恢复 EXIF 位置
                  </button>
                )}
                <button type="button" className="btn-danger" onClick={() => void removePhoto()} disabled={isUpdating}>
                  从路段移除
                </button>
              </div>
            )}
            {actionError && <p className="error-text">{actionError}</p>}
          </aside>
        </div>

        <footer className="photo-viewer-footer">
          <div>
            <button type="button" onClick={() => void selectAfterSaving(previousPhotoId)} disabled={!previousPhotoId || noteSaveStatus === 'saving'}>上一张</button>
            <button type="button" onClick={() => void selectAfterSaving(nextPhotoId)} disabled={!nextPhotoId || noteSaveStatus === 'saving'}>下一张</button>
          </div>
          <div className="photo-viewer-zoom-controls">
            <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} disabled={zoom <= 0.5} aria-label="缩小">
              <AppIcon name="zoomOut" className="icon-inline" />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} disabled={zoom >= 4} aria-label="放大">
              <AppIcon name="zoomIn" className="icon-inline" />
            </button>
            <span className="zoom-control-divider" aria-hidden="true" />
            <button type="button" onClick={() => setRotation((value) => value - 90)} aria-label="向左旋转 90 度">
              <AppIcon name="rotateLeft" className="icon-inline" />
            </button>
            <button type="button" onClick={() => setRotation((value) => value + 90)} aria-label="向右旋转 90 度">
              <AppIcon name="rotateRight" className="icon-inline" />
            </button>
            <button type="button" onClick={() => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }) }} aria-label="适应窗口">
              <AppIcon name="fit" className="icon-inline" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default PhotoViewerDialog

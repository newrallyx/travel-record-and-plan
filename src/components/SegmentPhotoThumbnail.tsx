import { useEffect, useRef, useState } from 'react'
import { loadPhotoThumbnail } from '../services/photoThumbnailLoadQueue'
import type { LinkedPhotoRecord } from '../types/photo'

interface SegmentPhotoThumbnailProps {
  photo: LinkedPhotoRecord
  onOpen: (photoId: string) => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelection?: (photoId: string) => void
}

function SegmentPhotoThumbnail({
  photo,
  onOpen,
  selectionMode = false,
  selected = false,
  onToggleSelection,
}: SegmentPhotoThumbnailProps) {
  const cardRef = useRef<HTMLButtonElement | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const element = cardRef.current
    if (!element) return
    let cancelled = false
    let objectUrl = ''

    const loadThumbnail = async () => {
      try {
        const asset = await loadPhotoThumbnail(photo.id)
        if (cancelled) return
        if (!asset) {
          setLoadFailed(true)
          return
        }
        objectUrl = URL.createObjectURL(asset.blob)
        setThumbnailUrl(objectUrl)
      } catch {
        if (!cancelled) setLoadFailed(true)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void loadThumbnail()
    }, { rootMargin: '120px' })
    observer.observe(element)

    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  return (
    <button
      ref={cardRef}
      type="button"
      className={`segment-photo-card${selected ? ' selected' : ''}`}
      onClick={() => selectionMode ? onToggleSelection?.(photo.id) : onOpen(photo.id)}
      aria-label={`查看照片 ${photo.originalFilename}`}
    >
      {selectionMode && <span className="segment-photo-selection-indicator">{selected ? '✓' : ''}</span>}
      <div className={`segment-photo-thumb-wrap${!thumbnailUrl && !loadFailed ? ' shimmer' : ''}`}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={photo.originalFilename} loading="lazy" />
        ) : (
          <span>{loadFailed ? '缩略图不可用' : '加载中…'}</span>
        )}
      </div>
      <span className="segment-photo-name" title={photo.originalFilename}>{photo.originalFilename}</span>
      <small>{photo.capturedAt ? new Date(photo.capturedAt).toLocaleString() : '尚未读取拍摄时间'}</small>
    </button>
  )
}

export default SegmentPhotoThumbnail

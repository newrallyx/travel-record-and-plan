import { useEffect, useRef, useState } from 'react'
import { loadPhotoThumbnail } from '../services/photoThumbnailLoadQueue'
import type { LinkedPhotoRecord } from '../types/photo'

interface PhotoFilmStripProps {
  photos: LinkedPhotoRecord[]
  selectedPhotoId: string | null
  onSelect: (photoId: string) => void
}

/** 照片查看器底部的胶片式缩略图条：点击切换照片，自动滚动到当前项 */
export function PhotoFilmStrip({ photos, selectedPhotoId, onSelect }: PhotoFilmStripProps) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const urlsRef = useRef<Record<string, string>>({})
  const seenRef = useRef<Set<string>>(new Set())
  const trackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    return () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url)
    }
  }, [])

  const loadFor = (photo: LinkedPhotoRecord) => {
    if (seenRef.current.has(photo.id)) return
    seenRef.current.add(photo.id)
    loadPhotoThumbnail(photo.id)
      .then((asset) => {
        if (!asset) return
        const url = URL.createObjectURL(asset.blob)
        urlsRef.current[photo.id] = url
        setUrls({ ...urlsRef.current })
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    photos.slice(0, 14).forEach(loadFor)
  }, [photos])

  const handleScroll = () => {
    const el = trackRef.current
    if (!el) return
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 120) {
      for (const photo of photos) {
        if (!seenRef.current.has(photo.id)) {
          loadFor(photo)
          break
        }
      }
    }
  }

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const target = el.querySelector<HTMLElement>(`[data-photo-id="${selectedPhotoId}"]`)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [selectedPhotoId])

  if (photos.length < 2) return null

  return (
    <div className="photo-film-strip">
      <div className="photo-film-track" ref={trackRef} onScroll={handleScroll}>
        {photos.map((photo) => {
          const url = urls[photo.id]
          const selected = photo.id === selectedPhotoId
          return (
            <button
              key={photo.id}
              type="button"
              data-photo-id={photo.id}
              className={`photo-film-item${selected ? ' selected' : ''}`}
              onClick={() => onSelect(photo.id)}
              title={photo.originalFilename}
            >
              {url ? <img src={url} alt="" /> : <span className="shimmer" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

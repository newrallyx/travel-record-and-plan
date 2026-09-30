import { useEffect, useRef, useState } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { loadPhotoThumbnail } from '../../services/photoThumbnailLoadQueue'
import type { LinkedPhotoRecord } from '../../types/photo'
import { photoMarkerIcon, selectedPhotoMarkerIcon } from './mapIcons'

interface PhotoMapMarkerProps {
  photo: LinkedPhotoRecord
  selected: boolean
  onSelect: (photoId: string) => void
}

export function PhotoMapMarker({ photo, selected, onSelect }: PhotoMapMarkerProps) {
  const markerRef = useRef<{ openPopup: () => void } | null>(null)
  const [shouldLoadThumbnail, setShouldLoadThumbnail] = useState(false)
  const [thumbnailUrl, setThumbnailUrl] = useState('')

  useEffect(() => {
    if (selected) markerRef.current?.openPopup()
  }, [selected])

  useEffect(() => {
    if (!shouldLoadThumbnail) return
    let cancelled = false
    let objectUrl = ''

    loadPhotoThumbnail(photo.id)
      .then((asset) => {
        if (cancelled || !asset) return
        objectUrl = URL.createObjectURL(asset.blob)
        setThumbnailUrl(objectUrl)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id, shouldLoadThumbnail])

  if (!photo.mapPosition) return null

  return (
    <Marker
      ref={markerRef}
      position={[photo.mapPosition.lat, photo.mapPosition.lon]}
      icon={selected ? selectedPhotoMarkerIcon : photoMarkerIcon}
      zIndexOffset={selected ? 1000 : 500}
      eventHandlers={{
        click: () => {
          setShouldLoadThumbnail(true)
          onSelect(photo.id)
        },
        popupopen: () => setShouldLoadThumbnail(true),
      }}
    >
      <Popup className="photo-map-popup">
        <div className="photo-map-popup-content">
          {thumbnailUrl ? <img src={thumbnailUrl} alt={photo.originalFilename} /> : <span>正在读取缩略图…</span>}
          <strong>{photo.originalFilename}</strong>
          <small>{photo.capturedAt ? new Date(photo.capturedAt).toLocaleString() : '无拍摄时间'}</small>
        </div>
      </Popup>
    </Marker>
  )
}

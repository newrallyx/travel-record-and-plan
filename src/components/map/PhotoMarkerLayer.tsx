import { useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap } from 'react-leaflet'
import type { LinkedPhotoRecord } from '../../types/photo'
import { clusterPhotoMarkers } from '../../utils/photoMarkerClusters'
import { createPhotoClusterIcon } from './mapIcons'
import { PhotoMapMarker } from './PhotoMapMarker'

interface PhotoMarkerLayerProps {
  photos: LinkedPhotoRecord[]
  selectedPhotoId: string | null
  photoPositionEditId: string | null
  onSelectPhoto: (photoId: string) => void
}

export function PhotoMarkerLayer({
  photos,
  selectedPhotoId,
  photoPositionEditId,
  onSelectPhoto,
}: PhotoMarkerLayerProps) {
  const map = useMap()
  const [viewRevision, setViewRevision] = useState(0)

  useEffect(() => {
    const refresh = () => setViewRevision((value) => value + 1)
    map.on('zoomend', refresh)
    map.on('moveend', refresh)
    return () => {
      map.off('zoomend', refresh)
      map.off('moveend', refresh)
    }
  }, [map])

  const zoom = map.getZoom()
  const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) ?? null
  const clusters = useMemo(() => {
    const paddedBounds = map.getBounds().pad(0.35)
    const visiblePhotos = photos.filter((photo) => (
      photo.id !== selectedPhotoId
      && photo.id !== photoPositionEditId
      && photo.mapPosition
      && paddedBounds.contains([photo.mapPosition.lat, photo.mapPosition.lon])
    ))
    return clusterPhotoMarkers(visiblePhotos, zoom)
  }, [map, photoPositionEditId, photos, selectedPhotoId, viewRevision, zoom])

  return (
    <>
      {clusters.map((cluster) => (
        cluster.photos.length === 1 ? (
          <PhotoMapMarker
            key={cluster.photos[0].id}
            photo={cluster.photos[0]}
            selected={false}
            onSelect={onSelectPhoto}
          />
        ) : (
          <Marker
            key={`photo-cluster-${cluster.id}`}
            position={[cluster.lat, cluster.lon]}
            icon={createPhotoClusterIcon(cluster.photos.length)}
            zIndexOffset={600}
          >
            <Popup className="photo-cluster-popup">
              <div className="photo-cluster-popup-content">
                <strong>{cluster.photos.length} 张照片</strong>
                {cluster.photos.slice(0, 8).map((photo) => (
                  <button type="button" key={photo.id} onClick={() => onSelectPhoto(photo.id)}>
                    {photo.originalFilename}
                  </button>
                ))}
                {cluster.photos.length > 8 && <small>还有 {cluster.photos.length - 8} 张，请放大地图查看</small>}
                <button type="button" onClick={() => map.flyTo(
                  [cluster.lat, cluster.lon],
                  Math.min(18, Math.max(map.getZoom() + 2, 10)),
                  { duration: 0.55 },
                )}>放大此区域</button>
              </div>
            </Popup>
          </Marker>
        )
      ))}
      {selectedPhoto?.mapPosition && selectedPhoto.id !== photoPositionEditId && (
        <PhotoMapMarker
          photo={selectedPhoto}
          selected
          onSelect={onSelectPhoto}
        />
      )}
    </>
  )
}

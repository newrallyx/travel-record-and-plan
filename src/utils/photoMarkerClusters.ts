import type { LinkedPhotoRecord } from '../types/photo'

export interface PhotoMarkerCluster {
  id: string
  lat: number
  lon: number
  photos: LinkedPhotoRecord[]
}

export function getPhotoClusterCellSize(zoom: number): number {
  const normalizedZoom = Number.isFinite(zoom) ? Math.max(0, Math.min(20, zoom)) : 4
  return 84.375 / 2 ** normalizedZoom
}

export function clusterPhotoMarkers(photos: LinkedPhotoRecord[], zoom: number): PhotoMarkerCluster[] {
  const cellSize = getPhotoClusterCellSize(zoom)
  const groups = new Map<string, LinkedPhotoRecord[]>()

  photos.forEach((photo) => {
    if (!photo.mapPosition) return
    const latCell = Math.floor((photo.mapPosition.lat + 90) / cellSize)
    const lonCell = Math.floor((photo.mapPosition.lon + 180) / cellSize)
    const key = `${latCell}:${lonCell}`
    const group = groups.get(key)
    if (group) group.push(photo)
    else groups.set(key, [photo])
  })

  return Array.from(groups.entries(), ([id, groupedPhotos]) => ({
    id,
    lat: groupedPhotos.reduce((sum, photo) => sum + photo.mapPosition!.lat, 0) / groupedPhotos.length,
    lon: groupedPhotos.reduce((sum, photo) => sum + photo.mapPosition!.lon, 0) / groupedPhotos.length,
    photos: groupedPhotos,
  }))
}

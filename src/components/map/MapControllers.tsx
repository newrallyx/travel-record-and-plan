import { useEffect } from 'react'
import L, { type LatLngExpression } from 'leaflet'
import { useMap, useMapEvents } from 'react-leaflet'
import type { PhotoCoordinate } from '../../types/photo'
import type { Waypoint } from '../../types/trip'
import type { LinkedPhotoRecord } from '../../types/photo'

export function ViewportController({ points }: { points: LatLngExpression[] }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) {
      map.setView(points[0], 11)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24] })
  }, [map, points])

  return null
}

export function MapResizeController({ watchKey }: { watchKey: string }) {
  const map = useMap()

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 80)
    return () => window.clearTimeout(timer)
  }, [map])

  useEffect(() => {
    const handleResize = () => map.invalidateSize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [map])

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => map.invalidateSize())
    return () => window.cancelAnimationFrame(animationFrame)
  }, [map, watchKey])

  useEffect(() => {
    const container = map.getContainer()
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])

  return null
}

export function WaypointFocusController({ waypoint }: { waypoint: Waypoint | null }) {
  const map = useMap()

  useEffect(() => {
    if (!waypoint || typeof waypoint.lat !== 'number' || typeof waypoint.lng !== 'number') return
    map.flyTo([waypoint.lat, waypoint.lng], Math.max(map.getZoom(), 12), { duration: 0.8 })
  }, [map, waypoint])

  return null
}

export function PhotoFocusController({ photo }: { photo: LinkedPhotoRecord | null }) {
  const map = useMap()

  useEffect(() => {
    if (!photo?.mapPosition) return
    map.flyTo(
      [photo.mapPosition.lat, photo.mapPosition.lon],
      Math.max(map.getZoom(), 14),
      { duration: 0.8 },
    )
  }, [map, photo])

  return null
}

export function PhotoPositionPickController({
  active,
  onPick,
}: {
  active: boolean
  onPick: (coordinate: PhotoCoordinate) => void
}) {
  useMapEvents({
    click: (event: any) => {
      if (!active) return
      onPick({ lat: event.latlng.lat, lon: event.latlng.lng })
    },
  })
  return null
}

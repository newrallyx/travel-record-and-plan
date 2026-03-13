import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, Polyline, TileLayer, useMap } from 'react-leaflet'
import L, { type DivIcon, type LatLngExpression } from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { CoordPoint, RouteSegment, Waypoint } from '../types/trip'
import { planCyclingRoute, planDrivingRoute, searchAmapInputTips } from '../services/amap'
import { saveSegmentRouteCache } from '../services/routeCacheDb'
import { buildSegmentRouteKey } from '../utils/routeBuildKey'

interface ResolvedRoutePatch {
  segmentId: string
  points: CoordPoint[]
  distanceMeters: number | null
  routeBuildKey: string
}

interface MapPanelProps {
  filteredSegments: RouteSegment[]
  editingSegmentId: string | null
  onStartEdit: (segmentId: string) => void
  onCancelEdit: () => void
  onSaveEdit: (payload: {
    segmentId: string
    startCoord: CoordPoint
    endCoord: CoordPoint
    points: CoordPoint[]
  }) => void
  selectedWaypoint: Waypoint | null
  onRouteResolved: (patches: ResolvedRoutePatch[]) => void
  allowAutoBuild: boolean
  onEndpointDraftChange: (payload: {
    segmentId: string
    startCoord?: CoordPoint
    endCoord?: CoordPoint
  }) => void
}

type PointKind = 'start' | 'via' | 'end'
type EditMode = 'start' | 'end' | 'track'

interface SegmentTrack {
  segmentId: string
  segmentName: string
  points: Array<{ name: string; lat: number; lon: number; type: PointKind }>
  line: CoordPoint[]
}

interface SegmentRouteDescriptor {
  segment: RouteSegment
  buildKey: string
  canReusePersisted: boolean
}

interface ViewportControllerProps {
  points: LatLngExpression[]
}

interface WaypointFocusControllerProps {
  waypoint: Waypoint | null
}

interface MapResizeControllerProps {
  expanded: boolean
}

const defaultCenter: [number, number] = [35.8617, 104.1954]
const CONTROL_POINT_STEP = 25
const CONTROL_POINT_MAX = 16

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const pointIcons: Record<PointKind, DivIcon> = {
  start: L.divIcon({
    className: 'custom-point-icon-wrapper',
    html: '<div class="custom-point-icon start">S</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  }),
  end: L.divIcon({
    className: 'custom-point-icon-wrapper',
    html: '<div class="custom-point-icon end">E</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  }),
  via: L.divIcon({
    className: 'custom-point-icon-wrapper',
    html: '<div class="custom-point-icon via">•</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  }),
}

const controlPointIcon = L.divIcon({
  className: 'custom-point-icon-wrapper',
  html: '<div class="custom-point-icon control">●</div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

const selectedWaypointIcon = L.divIcon({
  className: 'custom-point-icon-wrapper',
  html: '<div class="custom-point-icon waypoint-selected">★</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

function ViewportController({ points }: ViewportControllerProps) {
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

function MapResizeController({ expanded }: MapResizeControllerProps) {
  const map = useMap()

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 80)
    return () => window.clearTimeout(timer)
  }, [map, expanded])

  useEffect(() => {
    const handleResize = () => map.invalidateSize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [map])

  return null
}

function WaypointFocusController({ waypoint }: WaypointFocusControllerProps) {
  const map = useMap()

  useEffect(() => {
    if (!waypoint || typeof waypoint.lat !== 'number' || typeof waypoint.lng !== 'number') return
    map.flyTo([waypoint.lat, waypoint.lng], Math.max(map.getZoom(), 12), { duration: 0.8 })
  }, [map, waypoint])

  return null
}

function toLatLng(points: CoordPoint[]): LatLngExpression[] {
  return points.map((point) => [point.lat, point.lon] as LatLngExpression)
}

function fallbackLineFromPoints(points: Array<{ lat: number; lon: number }>): CoordPoint[] {
  return points.map((point) => ({ lat: point.lat, lon: point.lon }))
}

async function resolvePointByName(placeName: string): Promise<{ lat: number; lon: number } | null> {
  const { tips } = await searchAmapInputTips({ keywords: placeName, citylimit: false })
  const first = tips[0]
  if (!first) return null
  return { lat: first.lat, lon: first.lng }
}

function MapPanel({
  filteredSegments,
  editingSegmentId,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  selectedWaypoint,
  onRouteResolved,
  allowAutoBuild,
  onEndpointDraftChange,
}: MapPanelProps) {
  const [tracks, setTracks] = useState<SegmentTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('请选择旅程/日期/路段以查看轨迹')
  const [mapExpanded, setMapExpanded] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>('start')
  const [draftLine, setDraftLine] = useState<CoordPoint[] | null>(null)
  const [originalLine, setOriginalLine] = useState<CoordPoint[] | null>(null)
  const buildRunIdRef = useRef(0)

  const segmentDescriptors = useMemo<SegmentRouteDescriptor[]>(
    () =>
      filteredSegments.map((segment) => {
        const buildKey = buildSegmentRouteKey(segment)
        const hasPersistentLine = Array.isArray(segment.points) && segment.points.length >= 2
        return {
          segment,
          buildKey,
          canReusePersisted: hasPersistentLine && segment.routeBuildKey === buildKey,
        }
      }),
    [filteredSegments],
  )

  const routeBuildKey = useMemo(() => segmentDescriptors.map((item) => `${item.segment.id}:${item.buildKey}`).join('||'), [segmentDescriptors])

  useEffect(() => {
    let active = true
    const runId = ++buildRunIdRef.current

    async function buildTracks() {
      if (!segmentDescriptors.length) {
        setTracks([])
        setLoading(false)
        setMessage('请选择旅程/日期/路段以查看轨迹')
        return
      }

      const shouldPlanMissing = allowAutoBuild
      setLoading(shouldPlanMissing)
      setMessage(shouldPlanMissing ? '正在按需加载路线...' : '当前为全局视图，仅展示已缓存轨迹。')

      const warnings: string[] = []
      const patches: ResolvedRoutePatch[] = []
      const partialTracks: Array<SegmentTrack | null> = new Array(segmentDescriptors.length).fill(null)

      const tasks = segmentDescriptors.map(({ segment, buildKey, canReusePersisted }, index) =>
        (async () => {
          const startName = segment.startPoint
          const endName = segment.endPoint
          let startCoord = segment.startCoord
          let endCoord = segment.endCoord

          const resolvedWaypoints = (segment.waypoints ?? []).filter(
            (point): point is Waypoint & { lat: number; lng: number } =>
              typeof point.lat === 'number' && typeof point.lng === 'number',
          )

          const markerPoints: Array<{ name: string; lat: number; lon: number; type: PointKind }> = []
          if (startCoord) markerPoints.push({ name: startName, lat: startCoord.lat, lon: startCoord.lon, type: 'start' })
          for (const waypoint of resolvedWaypoints) {
            markerPoints.push({ name: waypoint.name, lat: waypoint.lat, lon: waypoint.lng, type: 'via' })
          }
          if (endCoord) markerPoints.push({ name: endName, lat: endCoord.lat, lon: endCoord.lon, type: 'end' })

          if (canReusePersisted && segment.points) {
            partialTracks[index] = {
              segmentId: segment.id,
              segmentName: segment.name,
              points: markerPoints,
              line: segment.points,
            }
            return
          }

          if (!shouldPlanMissing) {
            warnings.push(`路段「${segment.name}」暂无缓存轨迹。`)
            return
          }

          if (!startCoord && startName) {
            const resolved = await resolvePointByName(startName)
            if (resolved) startCoord = resolved
          }
          if (!endCoord && endName) {
            const resolved = await resolvePointByName(endName)
            if (resolved) endCoord = resolved
          }

          const planningPoints: Array<{ lat: number; lng: number }> = []
          if (startCoord) planningPoints.push({ lat: startCoord.lat, lng: startCoord.lon })
          for (const waypoint of resolvedWaypoints) planningPoints.push({ lat: waypoint.lat, lng: waypoint.lng })
          if (endCoord) planningPoints.push({ lat: endCoord.lat, lng: endCoord.lon })

          if (planningPoints.length < 2) {
            warnings.push(`路段「${segment.name}」缺少可用起终点坐标，无法规划。`)
            return
          }

          const routeType = segment.routeType ?? 'DRIVING'
          const { route, error } =
            routeType === 'CYCLING'
              ? await planCyclingRoute(planningPoints)
              : await planDrivingRoute(planningPoints, segment.preference)

          if (!active || runId !== buildRunIdRef.current) return

          let line = fallbackLineFromPoints(planningPoints.map((point) => ({ lat: point.lat, lon: point.lng })))
          if (route?.polyline?.length) {
            line = route.polyline.map(([lat, lng]) => ({ lat, lon: lng }))
            patches.push({
              segmentId: segment.id,
              points: line,
              distanceMeters: typeof route.distanceMeters === 'number' ? route.distanceMeters : null,
              routeBuildKey: buildKey,
            })
            void saveSegmentRouteCache({
              segmentId: segment.id,
              routeBuildKey: buildKey,
              points: line,
            })
          } else {
            const reason = error?.message ?? '未知错误'
            warnings.push(`路段「${segment.name}」规划失败：${reason}。`)
          }

          partialTracks[index] = {
            segmentId: segment.id,
            segmentName: segment.name,
            points: [
              { name: startName, lat: planningPoints[0].lat, lon: planningPoints[0].lng, type: 'start' },
              ...resolvedWaypoints.map((waypoint) => ({ name: waypoint.name, lat: waypoint.lat, lon: waypoint.lng, type: 'via' as const })),
              {
                name: endName,
                lat: planningPoints[planningPoints.length - 1].lat,
                lon: planningPoints[planningPoints.length - 1].lng,
                type: 'end',
              },
            ],
            line,
          }
        })(),
      )

      await Promise.allSettled(tasks)
      if (!active || runId !== buildRunIdRef.current) return

      const finalTracks = partialTracks.filter((track): track is SegmentTrack => Boolean(track))
      setTracks(finalTracks)
      setLoading(false)

      if (patches.length) {
        onRouteResolved(patches)
      }

      if (!finalTracks.length) {
        setMessage('未解析出可展示路线，请检查起终点、途经点或进入更细粒度视图。')
        return
      }

      setMessage(warnings.length ? warnings.join(' ') : shouldPlanMissing ? '已加载路线。' : '已展示缓存轨迹。')
    }

    void buildTracks()

    return () => {
      active = false
    }
  }, [routeBuildKey, segmentDescriptors, allowAutoBuild, onRouteResolved])

  const editingTrack = useMemo(
    () => (editingSegmentId ? tracks.find((track) => track.segmentId === editingSegmentId) ?? null : null),
    [tracks, editingSegmentId],
  )

  useEffect(() => {
    if (!editingTrack) {
      setDraftLine(null)
      setOriginalLine(null)
      setEditMode('start')
      return
    }

    if (!draftLine) {
      const cloned = editingTrack.line.map((point) => ({ ...point }))
      setDraftLine(cloned)
      setOriginalLine(cloned.map((point) => ({ ...point })))
    }
  }, [editingTrack, draftLine])

  const displayedTracks = useMemo(() => {
    if (!editingTrack || !draftLine) return tracks

    return tracks.map((track) => {
      if (track.segmentId !== editingTrack.segmentId) return track

      const mutablePoints = track.points.map((point) => {
        if (!draftLine.length) return point
        if (point.type === 'start') return { ...point, lat: draftLine[0].lat, lon: draftLine[0].lon }
        if (point.type === 'end') {
          const end = draftLine[draftLine.length - 1]
          return { ...point, lat: end.lat, lon: end.lon }
        }
        return point
      })

      return {
        ...track,
        line: draftLine,
        points: mutablePoints,
      }
    })
  }, [tracks, editingTrack, draftLine])

  const controlPointIndices = useMemo(() => {
    if (!draftLine || draftLine.length <= 2 || editMode !== 'track') return []

    const indices: number[] = []
    for (let i = 1; i < draftLine.length - 1; i += CONTROL_POINT_STEP) {
      indices.push(i)
      if (indices.length >= CONTROL_POINT_MAX) break
    }

    if (!indices.length) indices.push(Math.floor(draftLine.length / 2))
    return indices
  }, [draftLine, editMode])

  const allLatLng = useMemo(() => displayedTracks.flatMap((track) => toLatLng(track.line)), [displayedTracks])

  const handleCancel = () => {
    if (originalLine) setDraftLine(originalLine.map((point) => ({ ...point })))
    onCancelEdit()
  }

  const handleSave = () => {
    if (!editingTrack || !draftLine || draftLine.length < 2) return

    onSaveEdit({
      segmentId: editingTrack.segmentId,
      startCoord: { lat: draftLine[0].lat, lon: draftLine[0].lon },
      endCoord: {
        lat: draftLine[draftLine.length - 1].lat,
        lon: draftLine[draftLine.length - 1].lon,
      },
      points: draftLine,
    })
    setDraftLine(null)
    setOriginalLine(null)
  }

  return (
    <section className="card-section map-section-with-toolbar">
      <h2>4) 地图轨迹</h2>
      {(loading || message) && <p className="hint-text">{loading ? '正在加载轨迹点位...' : message}</p>}

      <div className="map-toolbar">
        <button type="button" onClick={() => setMapExpanded((prev) => !prev)}>
          {mapExpanded ? '收起地图' : '展开地图'}
        </button>

        {!editingSegmentId ? (
          <button
            type="button"
            onClick={() => {
              if (filteredSegments[0]) onStartEdit(filteredSegments[0].id)
            }}
            disabled={!filteredSegments.length}
          >
            编辑轨迹
          </button>
        ) : (
          <>
            <button type="button" onClick={handleCancel}>
              取消
            </button>
            <button type="button" onClick={handleSave}>
              保存
            </button>
            <div className="edit-mode-tabs">
              <button type="button" className={editMode === 'start' ? 'active' : ''} onClick={() => setEditMode('start')}>
                改起点
              </button>
              <button type="button" className={editMode === 'end' ? 'active' : ''} onClick={() => setEditMode('end')}>
                改终点
              </button>
              <button type="button" className={editMode === 'track' ? 'active' : ''} onClick={() => setEditMode('track')}>
                改轨迹
              </button>
            </div>
          </>
        )}
      </div>

      <div className="map-panel-wrapper">
        <MapContainer
          center={defaultCenter}
          zoom={4}
          zoomSnap={0.25}
          zoomDelta={0.25}
          wheelPxPerZoomLevel={160}
          className={`map-container ${mapExpanded ? 'map-container-expanded' : ''}`}
        >
          <MapResizeController expanded={mapExpanded} />
          <TileLayer
            attribution='&copy; <a href="https://www.amap.com/">Amap</a>'
            url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
            subdomains={[1, 2, 3, 4]}
          />

          {displayedTracks.map((track) =>
            track.line.length >= 2 ? (
              <Polyline key={track.segmentId} positions={toLatLng(track.line)} color="#2563eb" weight={4} />
            ) : null,
          )}

          {displayedTracks.flatMap((track) =>
            track.points.map((point, index) => {
              const draggable =
                editingSegmentId === track.segmentId &&
                ((editMode === 'start' && point.type === 'start') || (editMode === 'end' && point.type === 'end'))

              return (
                <Marker
                  key={`${track.segmentId}-${point.name}-${index}`}
                  position={[point.lat, point.lon]}
                  icon={pointIcons[point.type]}
                  draggable={draggable}
                  eventHandlers={
                    draggable && draftLine
                      ? {
                          drag: (event: any) => {
                            const marker = event.target as any
                            const latlng = marker.getLatLng()
                            if (editingSegmentId === track.segmentId) {
                              onEndpointDraftChange({
                                segmentId: track.segmentId,
                                ...(point.type === 'start'
                                  ? { startCoord: { lat: latlng.lat, lon: latlng.lng } }
                                  : { endCoord: { lat: latlng.lat, lon: latlng.lng } }),
                              })
                            }
                            setDraftLine((prev) => {
                              if (!prev || !prev.length) return prev
                              const next = [...prev]
                              if (point.type === 'start') next[0] = { ...next[0], lat: latlng.lat, lon: latlng.lng }
                              if (point.type === 'end') {
                                next[next.length - 1] = {
                                  ...next[next.length - 1],
                                  lat: latlng.lat,
                                  lon: latlng.lng,
                                }
                              }
                              return next
                            })
                          },
                        }
                      : undefined
                  }
                >
                  <Popup>
                    {track.segmentName} · {point.type === 'start' ? '起点' : point.type === 'end' ? '终点' : '途经点'}
                  </Popup>
                </Marker>
              )
            }),
          )}

          {editingSegmentId && draftLine &&
            controlPointIndices.map((index) => {
              const point = draftLine[index]
              if (!point) return null
              return (
                <Marker
                  key={`control-${index}`}
                  position={[point.lat, point.lon]}
                  icon={controlPointIcon}
                  draggable
                  eventHandlers={{
                    drag: (event: any) => {
                      const marker = event.target as any
                      const latlng = marker.getLatLng()
                      setDraftLine((prev) => {
                        if (!prev) return prev
                        const next = [...prev]
                        next[index] = { ...next[index], lat: latlng.lat, lon: latlng.lng }
                        return next
                      })
                    },
                  }}
                >
                  <Popup>轨迹控制点</Popup>
                </Marker>
              )
            })}

          {selectedWaypoint && typeof selectedWaypoint.lat === 'number' && typeof selectedWaypoint.lng === 'number' ? (
            <Marker position={[selectedWaypoint.lat, selectedWaypoint.lng]} icon={selectedWaypointIcon}>
              <Popup>{selectedWaypoint.name || '已定位途经点'}</Popup>
            </Marker>
          ) : null}

          <WaypointFocusController waypoint={selectedWaypoint} />
          <ViewportController points={allLatLng} />
        </MapContainer>
      </div>
    </section>
  )
}

export default MapPanel

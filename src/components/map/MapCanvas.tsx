import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { MapContainer, Marker, Popup, Polyline, TileLayer } from 'react-leaflet'
import type { CoordPoint, RouteColorMode, RouteSegment, Waypoint } from '../../types/trip'
import type { LinkedPhotoRecord, PhotoCoordinate } from '../../types/photo'
import {
  getScoreGradient,
  getSegmentDisplayColor,
  getSegmentScore,
  UNRATED_SEGMENT_COLOR,
} from '../../utils/segmentScores'
import {
  MapResizeController,
  PhotoFocusController,
  PhotoPositionPickController,
  ViewportController,
  WaypointFocusController,
} from './MapControllers'
import { controlPointIcon, pointIcons, selectedPhotoMarkerIcon, selectedWaypointIcon } from './mapIcons'
import { DEFAULT_MAP_CENTER, OVERVIEW_MAX_POINTS_PER_SEGMENT, toLatLng } from './trackUtils'
import type { EditMode, SegmentTrack } from './types'
import { PhotoMarkerLayer } from './PhotoMarkerLayer'
import {
  getRenderableRoadParts,
  getRoadTypeMapCategory,
  ROAD_TYPE_MAP_CATEGORIES,
  ROAD_TYPE_MAP_COLORS,
  ROAD_TYPE_MAP_LABELS,
  roadTypeColorForClass,
  type RoadTypeLegendData,
  type RoadTypeVisibility,
  UNVERIFIED_ROAD_TYPE_COLOR,
} from './roadTypeVisualization'
import { formatDistance } from '../../utils/distance'
import { getVisibleTrackPoints } from './visibleTrackPoints'

interface MapCanvasProps {
  filteredSegments: RouteSegment[]
  renderedTracks: SegmentTrack[]
  routeColorMode: RouteColorMode
  roadTypeVisibility: RoadTypeVisibility
  roadTypeLegend: RoadTypeLegendData
  isOverviewMode: boolean
  editingSegmentId: string | null
  editMode: EditMode
  draftLine: CoordPoint[] | null
  setDraftLine: Dispatch<SetStateAction<CoordPoint[] | null>>
  controlPointIndices: number[]
  selectedWaypoint: Waypoint | null
  photos: LinkedPhotoRecord[]
  selectedPhotoId: string | null
  onSelectPhoto: (photoId: string) => void
  photoPositionEditId: string | null
  photoPositionDraft: PhotoCoordinate | null
  onPhotoPositionDraftChange: (coordinate: PhotoCoordinate) => void
  loading: boolean
  onEndpointDraftChange: (payload: {
    segmentId: string
    startCoord?: CoordPoint
    endCoord?: CoordPoint
  }) => void
}

function readDraggedLatLng(event: any): { lat: number; lng: number } {
  const marker = event.target as any
  return marker.getLatLng()
}

function RoadTypeLegend({ data }: { data: RoadTypeLegendData }) {
  return (
    <details className="map-score-legend map-road-type-legend">
      <summary className="map-road-type-legend-toggle" aria-label="展开或收起道路类型里程统计">
        <span className="map-road-type-legend-toggle-main">
          <span className="map-road-type-legend-dots" aria-hidden="true">
            {ROAD_TYPE_MAP_CATEGORIES.map((category) => (
              <span key={category} style={{ backgroundColor: ROAD_TYPE_MAP_COLORS[category] }} />
            ))}
          </span>
          <span>道路统计</span>
        </span>
        <span className="map-road-type-legend-toggle-action" aria-hidden="true" />
      </summary>
      <div className="map-road-type-legend-body" aria-label="道路类型里程图例">
        <div className="map-score-legend-title">道路类型着色</div>
        <div className="map-road-type-legend-note">
          {data.showCurrent ? '当前范围显示本次与历史累计里程。' : '全部旅程视图只显示历史累计里程。'}
        </div>
        <div className="map-road-type-legend-list">
          {ROAD_TYPE_MAP_CATEGORIES.map((category) => (
            <div className="map-road-type-legend-row" key={category}>
              <span className="map-score-legend-chip" style={{ backgroundColor: ROAD_TYPE_MAP_COLORS[category] }} />
              <span className="map-road-type-legend-label">{ROAD_TYPE_MAP_LABELS[category]}</span>
              <span className="map-road-type-legend-distance">
                {data.showCurrent
                  ? `本次 ${formatDistance(data.current.distances[category], '0.0 公里')} + 累计 ${formatDistance(data.historical.distances[category], '0.0 公里')}`
                  : `累计 ${formatDistance(data.historical.distances[category], '0.0 公里')}`}
              </span>
            </div>
          ))}
          <div className="map-road-type-legend-row map-road-type-legend-pending">
            <span className="map-score-legend-chip" style={{ backgroundColor: UNVERIFIED_ROAD_TYPE_COLOR }} />
            <span className="map-road-type-legend-label">待核实</span>
            <span className="map-road-type-legend-distance">
              {data.showCurrent
                ? `本次 ${formatDistance(data.current.unverifiedMeters, '0.0 公里')} + 累计 ${formatDistance(data.historical.unverifiedMeters, '0.0 公里')}`
                : `累计 ${formatDistance(data.historical.unverifiedMeters, '0.0 公里')}`}
            </span>
          </div>
        </div>
      </div>
    </details>
  )
}

export function MapCanvas({
  filteredSegments,
  renderedTracks,
  routeColorMode,
  roadTypeVisibility,
  roadTypeLegend,
  isOverviewMode,
  editingSegmentId,
  editMode,
  draftLine,
  setDraftLine,
  controlPointIndices,
  selectedWaypoint,
  photos,
  selectedPhotoId,
  onSelectPhoto,
  photoPositionEditId,
  photoPositionDraft,
  onPhotoPositionDraftChange,
  loading,
  onEndpointDraftChange,
}: MapCanvasProps) {
  const isDarkTheme = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
  const tileStyle = isDarkTheme ? 7 : 8
  const allLatLng = useMemo(() => renderedTracks.flatMap((track) => toLatLng(track.line)), [renderedTracks])
  const mapResizeKey = `${renderedTracks.length}-${editingSegmentId ?? ''}-${loading ? 'loading' : 'idle'}`
  const segmentMap = useMemo(
    () => new Map(filteredSegments.map((segment) => [segment.id, segment])),
    [filteredSegments],
  )
  const activeLegendMode = routeColorMode === 'scenic' || routeColorMode === 'difficulty'
    ? routeColorMode
    : null
  const showPointMarkers = !isOverviewMode
  const visibleTrackPoints = useMemo(
    () => getVisibleTrackPoints(filteredSegments, renderedTracks),
    [filteredSegments, renderedTracks],
  )
  const selectedPhoto = useMemo(
    () => photos.find((photo) => photo.id === selectedPhotoId) ?? null,
    [photos, selectedPhotoId],
  )
  const roadPartRenderMap = useMemo(
    () => new Map(renderedTracks.map((track) => [
      track.segmentId,
      getRenderableRoadParts(track.roadParts, {
        isOverviewMode,
        maximumPoints: OVERVIEW_MAX_POINTS_PER_SEGMENT,
      }),
    ])),
    [isOverviewMode, renderedTracks],
  )

  return (
    <div className="map-panel-wrapper">
      <MapContainer
        center={DEFAULT_MAP_CENTER}
        zoom={4}
        zoomSnap={0.25}
        zoomDelta={0.25}
        wheelPxPerZoomLevel={160}
        className={photoPositionEditId ? 'map-container photo-position-picking' : 'map-container'}
      >
        <MapResizeController watchKey={mapResizeKey} />
        <TileLayer
          attribution='&copy; <a href="https://www.amap.com/">Amap</a>'
          url={`https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=${tileStyle}&x={x}&y={y}&z={z}`}
          subdomains={[1, 2, 3, 4]}
        />

        {renderedTracks.map((track) => {
          if (track.line.length < 2) return null
          const sourceSegment = segmentMap.get(track.segmentId)
          const lineColor = routeColorMode === 'roadType'
            ? UNVERIFIED_ROAD_TYPE_COLOR
            : sourceSegment
              ? getSegmentDisplayColor(sourceSegment, routeColorMode, '#4f46e5')
              : '#4f46e5'
          const modeScore =
            routeColorMode === 'default' || routeColorMode === 'roadType' || !sourceSegment
              ? 'default'
              : getSegmentScore(sourceSegment, routeColorMode) ?? 'unrated'
          const lineWeight = routeColorMode === 'default' ? 4 : 6
          const roadPartRenderings = roadPartRenderMap.get(track.segmentId) ?? []

          if (routeColorMode === 'roadType' && roadPartRenderings.length) {
            return roadPartRenderings.map((part) => {
              const roadTypeCategory = getRoadTypeMapCategory(part.roadClass)
              if (routeColorMode === 'roadType' && roadTypeCategory && !roadTypeVisibility[roadTypeCategory]) {
                return null
              }
              const color = routeColorMode === 'roadType' ? roadTypeColorForClass(part.roadClass) : lineColor
              return (
                <Polyline
                  key={`${track.segmentId}-road-${part.sourceIndex}-${routeColorMode}-${modeScore}`}
                  positions={part.positions}
                  pathOptions={{ color, weight: lineWeight, opacity: 0.96 }}
                />
              )
            })
          }

          return (
            <Polyline
              key={`${track.segmentId}-${routeColorMode}-${modeScore}`}
              positions={toLatLng(track.line)}
              pathOptions={{ color: lineColor, weight: lineWeight, opacity: 0.96 }}
            />
          )
        })}

        {showPointMarkers && visibleTrackPoints.map(({ track, point, index }) => {
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
                        const latlng = readDraggedLatLng(event)
                        if (editingSegmentId === track.segmentId) {
                          onEndpointDraftChange({
                            segmentId: track.segmentId,
                            ...(point.type === 'start'
                              ? { startCoord: { lat: latlng.lat, lon: latlng.lng } }
                              : { endCoord: { lat: latlng.lat, lon: latlng.lng } }),
                          })
                        }
                        setDraftLine((prev) => {
                          if (!prev?.length) return prev
                          const next = [...prev]
                          if (point.type === 'start') {
                            next[0] = { ...next[0], lat: latlng.lat, lon: latlng.lng }
                          }
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
        })}

      {editingSegmentId && draftLine && controlPointIndices.map((index) => {
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
                const latlng = readDraggedLatLng(event)
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

      {showPointMarkers && selectedWaypoint && typeof selectedWaypoint.lat === 'number' && typeof selectedWaypoint.lng === 'number' ? (
        <Marker position={[selectedWaypoint.lat, selectedWaypoint.lng]} icon={selectedWaypointIcon}>
          <Popup>{selectedWaypoint.name || '已定位途经点'}</Popup>
        </Marker>
      ) : null}

      <PhotoMarkerLayer
        photos={photos}
        selectedPhotoId={selectedPhotoId}
        photoPositionEditId={photoPositionEditId}
        onSelectPhoto={onSelectPhoto}
      />

      {photoPositionEditId && photoPositionDraft && (
        <Marker
          position={[photoPositionDraft.lat, photoPositionDraft.lon]}
          icon={selectedPhotoMarkerIcon}
          zIndexOffset={1200}
          draggable
          eventHandlers={{
            dragend: (event: any) => {
              const latlng = readDraggedLatLng(event)
              onPhotoPositionDraftChange({ lat: latlng.lat, lon: latlng.lng })
            },
          }}
        >
          <Popup>拖动相机图标可微调照片位置</Popup>
        </Marker>
      )}

      <WaypointFocusController waypoint={selectedWaypoint} />
      <PhotoFocusController photo={selectedPhoto} />
      <PhotoPositionPickController
        active={Boolean(photoPositionEditId)}
        onPick={onPhotoPositionDraftChange}
      />
      <ViewportController points={allLatLng} />
    </MapContainer>

    {activeLegendMode && (
      <div className="map-score-legend">
        <div className="map-score-legend-title">{activeLegendMode === 'scenic' ? '风景评分着色' : '难度评分着色'}</div>
        <div className="map-score-legend-bar" style={{ backgroundImage: getScoreGradient(activeLegendMode) }} />
        <div className="map-score-legend-scale">
          <span>1</span>
          <span>10</span>
        </div>
        <div className="map-score-legend-note">
          未评分轨迹显示为 <span className="map-score-legend-chip" style={{ backgroundColor: UNRATED_SEGMENT_COLOR }} /> 灰色
        </div>
      </div>
    )}
    {routeColorMode === 'roadType' && <RoadTypeLegend data={roadTypeLegend} />}
  </div>
)
}

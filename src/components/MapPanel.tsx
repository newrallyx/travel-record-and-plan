import { useEffect, useMemo, useState } from 'react'
import type { CoordPoint, RouteColorMode, RouteSegment, Trip, Waypoint } from '../types/trip'
import type { LinkedPhotoRecord, PhotoCoordinate } from '../types/photo'
import { getAllSegmentRouteCache, subscribeRouteCacheChanges, type RouteCacheRecord } from '../services/routeCacheDb'
import { MapCanvas } from './map/MapCanvas'
import type { ResolvedRoutePatch, RouteRefreshRequest, TrackSavePayload } from './map/types'
import { useMapTracks } from './map/useMapTracks'
import { useTrackEditing } from './map/useTrackEditing'
import { useOverviewAggregation } from './map/useOverviewAggregation'
import {
  DEFAULT_ROAD_TYPE_VISIBILITY,
  summarizeCurrentRoadTypeDistances,
  summarizeHistoricalRoadTypeDistances,
  type RoadTypeVisibility,
} from './map/roadTypeVisualization'

interface MapPanelProps {
  filteredSegments: RouteSegment[]
  routeColorMode: RouteColorMode
  roadTypeVisibility?: RoadTypeVisibility
  allTrips?: Trip[]
  selectedTripId?: string
  overviewYear?: string
  isOverviewMode: boolean
  aggregateOverview?: boolean
  editingSegmentId: string | null
  onCancelEdit: () => void
  onSaveEdit: (payload: TrackSavePayload) => void
  selectedWaypoint: Waypoint | null
  photos: LinkedPhotoRecord[]
  selectedPhotoId: string | null
  onSelectPhoto: (photoId: string) => void
  photoPositionEditId: string | null
  photoPositionEditFilename: string
  photoPositionDraft: PhotoCoordinate | null
  isSavingPhotoPosition: boolean
  photoPositionError: string
  onPhotoPositionDraftChange: (coordinate: PhotoCoordinate) => void
  onSavePhotoPosition: () => void
  onCancelPhotoPosition: () => void
  onRouteResolved: (patches: ResolvedRoutePatch[]) => void
  routeServiceRevision: number
  routeRefreshRequest: RouteRefreshRequest
  onRouteLoadingChange: (loading: boolean) => void
  allowAutoBuild: boolean
  isReadonlyMode: boolean
  onEndpointDraftChange: (payload: {
    segmentId: string
    startCoord?: CoordPoint
    endCoord?: CoordPoint
  }) => void
}

function MapPanel({
  filteredSegments,
  routeColorMode,
  roadTypeVisibility = DEFAULT_ROAD_TYPE_VISIBILITY,
  allTrips = [],
  selectedTripId = '',
  overviewYear,
  isOverviewMode,
  aggregateOverview = false,
  editingSegmentId,
  onCancelEdit,
  onSaveEdit,
  selectedWaypoint,
  photos,
  selectedPhotoId,
  onSelectPhoto,
  photoPositionEditId,
  photoPositionEditFilename,
  photoPositionDraft,
  isSavingPhotoPosition,
  photoPositionError,
  onPhotoPositionDraftChange,
  onSavePhotoPosition,
  onCancelPhotoPosition,
  onRouteResolved,
  routeServiceRevision,
  routeRefreshRequest,
  onRouteLoadingChange,
  allowAutoBuild,
  isReadonlyMode,
  onEndpointDraftChange,
}: MapPanelProps) {
  const { tracks, loading, message } = useMapTracks({
    filteredSegments,
    allowAutoBuild,
    isReadonlyMode,
    onRouteResolved,
    routeServiceRevision,
    routeRefreshRequest,
  })

  useEffect(() => {
    onRouteLoadingChange(loading)
  }, [loading, onRouteLoadingChange])
  const [routeCaches, setRouteCaches] = useState<RouteCacheRecord[]>([])
  useEffect(() => {
    let active = true
    let revision = 0
    let refreshTimer: number | undefined
    const loadRouteCaches = async () => {
      const currentRevision = ++revision
      const records = await getAllSegmentRouteCache()
      if (active && currentRevision === revision) setRouteCaches(records)
    }
    // Refresh after committed writes, not after selecting another route. Coalesce
    // batch writes and discard any read started before the most recent write.
    const unsubscribe = subscribeRouteCacheChanges(() => {
      revision++
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void loadRouteCaches(), 100)
    })
    void loadRouteCaches()
    return () => {
      active = false
      unsubscribe()
      window.clearTimeout(refreshTimer)
    }
  }, [])
  const trackEditing = useTrackEditing({
    tracks,
    editingSegmentId,
    isOverviewMode,
    onCancelEdit,
    onSaveEdit,
  })
  const historicalRoadDistances = useMemo(
    () => summarizeHistoricalRoadTypeDistances(allTrips, routeCaches, overviewYear),
    [allTrips, routeCaches, overviewYear],
  )
  const roadTypeLegend = useMemo(() => ({
    overviewYear,
    current: summarizeCurrentRoadTypeDistances(trackEditing.renderedTracks, filteredSegments),
    historical: historicalRoadDistances,
    showCurrent: Boolean(selectedTripId),
  }), [filteredSegments, historicalRoadDistances, selectedTripId, overviewYear, trackEditing.renderedTracks])
  const overview = useOverviewAggregation(tracks, aggregateOverview && isOverviewMode && !selectedTripId && !editingSegmentId && !loading && tracks.length > 0)

  return (
    <section className="card-section map-section-with-toolbar">
      {loading && (
        <div className="map-loading-overlay" role="status" aria-live="polite">
          <span className="map-loading-spinner" />
          <span>正在加载轨迹点位…</span>
        </div>
      )}
      {!loading && message.startsWith('未解析') && <p className="hint-text">{message}</p>}
      {overview.pending && <p className="hint-text" role="status">正在加载总览轨迹，暂时显示原轨迹…</p>}
      {overview.error && <p className="hint-text" role="status">总览合并暂不可用，已保留原轨迹显示。</p>}

      {editingSegmentId && !isReadonlyMode && (
        <div className="map-toolbar">
          <button type="button" className="btn-secondary" onClick={trackEditing.cancelEdit}>
            取消
          </button>
          <button type="button" className="btn-primary" onClick={trackEditing.saveEdit}>
            保存
          </button>
          <div className="edit-mode-tabs">
            <button
              type="button"
              className={trackEditing.editMode === 'start' ? 'active' : ''}
              onClick={() => trackEditing.setEditMode('start')}
            >
              改起点
            </button>
            <button
              type="button"
              className={trackEditing.editMode === 'end' ? 'active' : ''}
              onClick={() => trackEditing.setEditMode('end')}
            >
              改终点
            </button>
            <button
              type="button"
              className={trackEditing.editMode === 'track' ? 'active' : ''}
              onClick={() => trackEditing.setEditMode('track')}
            >
              改轨迹
            </button>
          </div>
        </div>
      )}

      {photoPositionEditId && !isReadonlyMode && (
        <div className="map-toolbar photo-position-toolbar">
          <div>
            <strong>定位照片：{photoPositionEditFilename}</strong>
            <span>{photoPositionDraft ? '可继续点击地图或拖动相机图标微调' : '请在地图上点击照片拍摄位置'}</span>
          </div>
          <button type="button" className="btn-secondary" onClick={onCancelPhotoPosition} disabled={isSavingPhotoPosition}>取消</button>
          <button
            type="button"
            className="btn-primary"
            onClick={onSavePhotoPosition}
            disabled={!photoPositionDraft || isSavingPhotoPosition}
          >
            {isSavingPhotoPosition ? '保存中…' : '保存位置'}
          </button>
          {photoPositionError && <span className="error-text">{photoPositionError}</span>}
        </div>
      )}

      <MapCanvas
        filteredSegments={filteredSegments}
        renderedTracks={trackEditing.renderedTracks}
        overviewLines={overview.lines}
        routeColorMode={routeColorMode}
        roadTypeVisibility={roadTypeVisibility}
        roadTypeLegend={roadTypeLegend}
        isOverviewMode={isOverviewMode}
        editingSegmentId={editingSegmentId}
        editMode={trackEditing.editMode}
        draftLine={trackEditing.draftLine}
        setDraftLine={trackEditing.setDraftLine}
        controlPointIndices={trackEditing.controlPointIndices}
        selectedWaypoint={selectedWaypoint}
        photos={photos}
        selectedPhotoId={selectedPhotoId}
        onSelectPhoto={onSelectPhoto}
        photoPositionEditId={photoPositionEditId}
        photoPositionDraft={photoPositionDraft}
        onPhotoPositionDraftChange={onPhotoPositionDraftChange}
        loading={loading}
        onEndpointDraftChange={onEndpointDraftChange}
      />
    </section>
  )
}

export default MapPanel

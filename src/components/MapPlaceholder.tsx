import { useEffect, useMemo, useRef, useState } from 'react'
import { alertDialog } from './ConfirmDialog'
import EmptyState from './EmptyState'
import { AppIcon } from './icons'
import PlaceAutocomplete from './PlaceAutocomplete'
import type { RoutePreference, RouteSegment, RouteSummary, RouteType, SegmentReviewFacts, Waypoint } from '../types/trip'
import { formatDistance, getTrackDistanceMeters } from '../utils/distance'
import {
  formatDurationUpdatedAt,
  formatDurationSeconds,
  formatSegmentEstimatedDuration,
  hasCurrentDurationEstimate,
} from '../utils/durations'
import SegmentScoreFields from './SegmentScoreFields'
import SegmentReviewFactsEditor from './SegmentReviewFactsEditor'
import { formatScoreDisplay } from '../utils/segmentScores'
import { getRoutePreferenceLabel, routePreferenceOptions } from '../utils/routePreference'
import {
  formatSegmentEstimatedToll,
  formatTollDistance,
  formatTollUpdatedAt,
  hasCurrentTollEstimate,
} from '../utils/tolls'
import {
  buildReviewFactsFromDraft,
  formatSegmentActualDistance,
  formatSegmentActualDuration,
  formatSegmentActualToll,
  getReviewFactsDraftDefaults,
  type ReviewFactsDraftInput,
} from '../utils/reviewFacts'
import { getReviewTagLabel } from '../utils/reviewTags'
import { getCurrentWaypointEstimates } from '../utils/waypointEstimates'

function formatCoordText(coord?: { lat: number; lon: number }): string {
  if (!coord) return '未解析坐标'
  return `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`
}

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const detailAnchorItems = [
  { id: 'detail-seg-meta', label: '信息' },
  { id: 'detail-seg-route', label: '路线' },
  { id: 'detail-seg-endpoints', label: '起终点' },
  { id: 'detail-seg-waypoints', label: '途经点' },
  { id: 'detail-seg-score', label: '评分' },
  { id: 'detail-seg-note', label: '备注' },
]

interface FilterContext {
  tripName: string
  dayDate: string
  segmentName: string
}

interface EndpointDraft {
  segmentId: string
  startPoint: string
  endPoint: string
  startCoord?: { lat: number; lon: number }
  endCoord?: { lat: number; lon: number }
}

interface SegmentMetaDraft {
  segmentId: string
  name: string
  date: string
}

interface DetailEditDraft {
  segmentId: string
  routeMode: RouteType
  routePreference: RoutePreference
  scenicScore: number | null
  difficultyScore: number | null
  note: string
  reviewFactsDraft: ReviewFactsDraftInput
}

interface TripListItem {
  id: string
  title: string
  startDate: string
  endDate: string
  segmentCount: number
  tripDistanceText: string
  tripDurationText: string
  tripTollText: string
}

interface MapPlaceholderProps {
  isPlanning?: boolean
  isReadonlyMode: boolean
  placeholderMode: 'trip-list' | 'segment-list'
  tripListItems: TripListItem[]
  onViewTrip: (tripId: string) => void
  onOpenTripManager: () => void
  onOpenTripEditor: () => void
  onDeleteTrip: (tripId: string) => void

  filteredSegments: Array<RouteSegment & { dayDate?: string }>
  summary: RouteSummary
  filterContext: FilterContext
  activeSegmentId: string | null
  activeSegment: RouteSegment | null
  activeSegmentDate: string
  segmentMetaDraft: SegmentMetaDraft | null
  onDeleteSegment: (payload: { segmentId?: string; index: number; name: string }) => void
  onStartSegmentMetaEdit: (segmentId: string) => void
  onCancelSegmentMetaEdit: () => void
  onSaveSegmentMetaEdit: () => void
  onUpdateSegmentMetaDraft: (patch: { name?: string; date?: string }) => void

  routePreference: RoutePreference
  routeMode: RouteType
  onChangeRouteMode: (value: RouteType) => void
  onChangeRoutePreference: (value: RoutePreference) => void

  onMoveSegmentInTrip: (segmentId: string, direction: 'up' | 'down') => void
  canMoveSegmentUp: boolean
  canMoveSegmentDown: boolean

  waypoints: Waypoint[]
  onLocateWaypoint: (waypoint: Waypoint) => void
  onStartWaypointEdit: () => void
  onCancelWaypointEdit: () => void
  onSaveWaypoints: () => void
  onAddWaypoint: () => void
  onUpdateWaypointName: (id: string, name: string) => void
  onSelectWaypointPlace: (id: string, payload: { label: string; lat: number; lng: number; amapId?: string }) => void
  onMoveWaypoint: (id: string, direction: 'up' | 'down') => void
  onDeleteWaypoint: (id: string) => void

  endpointDraft: EndpointDraft | null
  onStartEndpointEdit: () => void
  onCancelEndpointEdit: () => void
  onSaveEndpoints: () => void
  onUpdateEndpointText: (field: 'startPoint' | 'endPoint', text: string) => void
  onSelectEndpointPlace: (field: 'startPoint' | 'endPoint', payload: { label: string; lat: number; lng: number; amapId?: string }) => void
  onUpdateSegmentScore: (field: 'scenicScore' | 'difficultyScore', value: number | null) => void
  onUpdateSegmentNote: (value: string) => void
  onUpdateSegmentReviewFacts: (facts: SegmentReviewFacts | undefined) => void
  onDetailDraftStateChange: (state: { segmentId: string | null; dirty: boolean }) => void
  onRefreshRouteEstimate: () => void
  isRouteEstimateRefreshing: boolean
  editRequest?: { segmentId: string; revision: number }
  onEditRequestConsumed?: () => void
}

function MapPlaceholder({
  isPlanning = false,
  isReadonlyMode,
  placeholderMode,
  tripListItems,
  onViewTrip,
  onOpenTripManager,
  onOpenTripEditor,
  onDeleteTrip,
  filteredSegments,
  summary,
  filterContext,
  activeSegmentId,
  activeSegment,
  activeSegmentDate,
  segmentMetaDraft,
  onDeleteSegment,
  onStartSegmentMetaEdit,
  onCancelSegmentMetaEdit,
  onSaveSegmentMetaEdit,
  onUpdateSegmentMetaDraft,
  routePreference,
  routeMode,
  onChangeRouteMode,
  onChangeRoutePreference,
  onMoveSegmentInTrip,
  canMoveSegmentUp,
  canMoveSegmentDown,
  waypoints,
  onLocateWaypoint,
  onStartWaypointEdit,
  onCancelWaypointEdit,
  onSaveWaypoints,
  onAddWaypoint,
  onUpdateWaypointName,
  onSelectWaypointPlace,
  onMoveWaypoint,
  onDeleteWaypoint,
  endpointDraft,
  onStartEndpointEdit,
  onCancelEndpointEdit,
  onSaveEndpoints,
  onUpdateEndpointText,
  onSelectEndpointPlace,
  onUpdateSegmentScore,
  onUpdateSegmentNote,
  onUpdateSegmentReviewFacts,
  onDetailDraftStateChange,
  onRefreshRouteEstimate,
  isRouteEstimateRefreshing,
  editRequest,
  onEditRequestConsumed,
}: MapPlaceholderProps) {
  const [detailDraft, setDetailDraft] = useState<DetailEditDraft | null>(null)
  const consumedEditRequest = useRef<number | undefined>()
  const detailEditMode = Boolean(activeSegment && detailDraft?.segmentId === activeSegment.id)
  const isSingleSegmentView = Boolean(activeSegment && filteredSegments.length === 1)
  const waypointEstimates = activeSegment ? getCurrentWaypointEstimates(activeSegment) : undefined

  const detailDraftDirty = useMemo(() => {
    if (!activeSegment || !detailDraft || detailDraft.segmentId !== activeSegment.id) return false
    const metaDirty = Boolean(
      segmentMetaDraft
      && segmentMetaDraft.segmentId === activeSegment.id
      && (segmentMetaDraft.name !== activeSegment.name || segmentMetaDraft.date !== activeSegmentDate)
    )
    const endpointDirty = Boolean(
      endpointDraft
      && endpointDraft.segmentId === activeSegment.id
      && (
        endpointDraft.startPoint !== activeSegment.startPoint
        || endpointDraft.endPoint !== activeSegment.endPoint
        || JSON.stringify(endpointDraft.startCoord ?? null) !== JSON.stringify(activeSegment.startCoord ?? null)
        || JSON.stringify(endpointDraft.endCoord ?? null) !== JSON.stringify(activeSegment.endCoord ?? null)
      )
    )
    const waypointDirty = JSON.stringify(waypoints) !== JSON.stringify(activeSegment.waypoints ?? [])
    const reviewFactsDirty = JSON.stringify(buildReviewFactsFromDraft(detailDraft.reviewFactsDraft))
      !== JSON.stringify(activeSegment.reviewFacts ?? undefined)
    return metaDirty
      || endpointDirty
      || waypointDirty
      || reviewFactsDirty
      || detailDraft.routeMode !== routeMode
      || detailDraft.routePreference !== routePreference
      || detailDraft.scenicScore !== (activeSegment.scenicScore ?? null)
      || detailDraft.difficultyScore !== (activeSegment.difficultyScore ?? null)
      || detailDraft.note !== (activeSegment.note ?? '')
  }, [activeSegment, activeSegmentDate, detailDraft, endpointDraft, routeMode, routePreference, segmentMetaDraft, waypoints])

  useEffect(() => {
    onDetailDraftStateChange({
      segmentId: detailDraft?.segmentId ?? null,
      dirty: detailDraftDirty,
    })
  }, [detailDraft?.segmentId, detailDraftDirty, onDetailDraftStateChange])

  useEffect(() => {
    if (!detailDraft || detailDraft.segmentId === activeSegmentId) return
    onCancelSegmentMetaEdit()
    onCancelEndpointEdit()
    onCancelWaypointEdit()
    setDetailDraft(null)
  }, [activeSegmentId, detailDraft, onCancelEndpointEdit, onCancelSegmentMetaEdit, onCancelWaypointEdit])

  useEffect(() => {
    if (!detailEditMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveDetailEdit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const startDetailEdit = () => {    if (!activeSegment || isReadonlyMode) return
    onStartSegmentMetaEdit(activeSegment.id)
    onStartEndpointEdit()
    onStartWaypointEdit()
    setDetailDraft({
      segmentId: activeSegment.id,
      routeMode,
      routePreference,
      scenicScore: activeSegment.scenicScore ?? null,
      difficultyScore: activeSegment.difficultyScore ?? null,
      note: activeSegment.note ?? '',
      reviewFactsDraft: getReviewFactsDraftDefaults(activeSegment.reviewFacts),
    })
  }

  useEffect(() => {
    if (!editRequest || editRequest.revision === consumedEditRequest.current
      || editRequest.segmentId !== activeSegment?.id || isReadonlyMode) return
    consumedEditRequest.current = editRequest.revision
    startDetailEdit()
    onEditRequestConsumed?.()
  }, [editRequest, activeSegment?.id, isReadonlyMode])

  const cancelDetailEdit = () => {
    onCancelSegmentMetaEdit()
    onCancelEndpointEdit()
    onCancelWaypointEdit()
    setDetailDraft(null)
  }

  const saveDetailEdit = () => {
    if (!activeSegment || !detailDraft || detailDraft.segmentId !== activeSegment.id) return
    onSaveSegmentMetaEdit()
    onSaveEndpoints()
    onSaveWaypoints()
    if (detailDraft.routeMode !== routeMode) onChangeRouteMode(detailDraft.routeMode)
    if (detailDraft.routePreference !== routePreference) onChangeRoutePreference(detailDraft.routePreference)
    if (detailDraft.scenicScore !== (activeSegment.scenicScore ?? null)) {
      onUpdateSegmentScore('scenicScore', detailDraft.scenicScore)
    }
    if (detailDraft.difficultyScore !== (activeSegment.difficultyScore ?? null)) {
      onUpdateSegmentScore('difficultyScore', detailDraft.difficultyScore)
    }
    if (detailDraft.note !== (activeSegment.note ?? '')) onUpdateSegmentNote(detailDraft.note)
    onUpdateSegmentReviewFacts(buildReviewFactsFromDraft(detailDraft.reviewFactsDraft))
    setDetailDraft(null)
  }

  // all-trips 时占位区显示“旅程列表模式”；底部真实地图仍由 mapRenderSegments 绘制总览。
  if (placeholderMode === 'trip-list') {
    return (
      <section className="card-section">
        <h2>全部旅程 · {tripListItems.length} 次</h2>
        <ul className="trip-placeholder-list">
          {tripListItems.map((trip) => (
            <li key={trip.id} className="trip-placeholder-item">
              <div className="trip-main-meta">
                <strong title={trip.title}>{trip.title}</strong>
                <small>
                  {trip.startDate} ～ {trip.endDate} · {trip.segmentCount} 条路段
                </small>
                <small>
                  预计里程：{trip.tripDistanceText}
                  {' · '}预计行驶：{trip.tripDurationText}
                  {' · '}预估过路费：{trip.tripTollText}
                </small>
              </div>
              <div className="trip-item-actions">
                <button type="button" onClick={() => onViewTrip(trip.id)}>
                  查看
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onViewTrip(trip.id)
                    onOpenTripManager()
                  }}
                >
                  {isReadonlyMode ? '查看详情' : '编辑'}
                </button>
                <button type="button" className="danger-btn" onClick={() => onDeleteTrip(trip.id)} disabled={isReadonlyMode}>
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!tripListItems.length && (
          <EmptyState
            icon="trip"
            title="还没有旅程"
            description={isReadonlyMode ? '当前工作区没有旅程。' : '在旅程编辑中创建第一条自驾记录。'}
            action={!isReadonlyMode && <button type="button" className="btn-primary" onClick={onOpenTripEditor}>前往旅程编辑</button>}
          />
        )}
      </section>
    )
  }

  return (
    <section className={`card-section detail-panel-card${isSingleSegmentView ? ' detail-panel-card-single' : ''}${detailEditMode ? ' detail-panel-editing' : ''}`}>
      {detailEditMode && (
        <div className="detail-save-toolbar" aria-label="路段编辑操作">
          <span role="status">{detailDraftDirty ? '有未保存更改' : '编辑中 · 暂无更改'}</span>
          <div className="segment-detail-edit-actions">
            <button type="button" className="btn-primary" onClick={saveDetailEdit} disabled={isReadonlyMode} title="保存全部（Ctrl+S）">保存全部</button>
            <button type="button" className="btn-secondary" onClick={cancelDetailEdit}>取消</button>
          </div>
        </div>
      )}
      {isSingleSegmentView && activeSegment ? (
        <div id="detail-seg-meta" className="detail-single-heading">
          <div className="detail-single-title-row">
            <div className="detail-single-title">
              <span className="detail-single-eyebrow">路段详情</span>
              <h2>{activeSegment.name}</h2>
              <p>{activeSegmentDate || '未设置日期'} · {filterContext.tripName}</p>
            </div>
            <div className="detail-single-actions" aria-label="路段操作">
              {!detailEditMode ? (
                <button type="button" className="btn-primary" onClick={startDetailEdit} disabled={isReadonlyMode}>编辑详情</button>
              ) : (
                <span className="hint-text">正在编辑</span>
              )}
              {!detailEditMode && <details className="detail-more-menu" onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary')?.focus()
                }
              }}>
                <summary>更多</summary>
                <div className="detail-more-actions">
                  <button type="button" onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    onMoveSegmentInTrip(activeSegment.id, 'up')
                  }} disabled={isReadonlyMode || !canMoveSegmentUp}>上移路段</button>
                  <button type="button" onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    onMoveSegmentInTrip(activeSegment.id, 'down')
                  }} disabled={isReadonlyMode || !canMoveSegmentDown}>下移路段</button>
                  <button type="button" className="danger-btn" onClick={(event) => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    onDeleteSegment({ segmentId: activeSegment.id, index: 0, name: activeSegment.name })
                  }} disabled={isReadonlyMode}>
                    <AppIcon name="trash" className="icon-inline" />删除路段
                  </button>
                </div>
              </details>}
            </div>
          </div>
          <p className="detail-single-endpoints">
            <span>{activeSegment.startPoint || '起点未设置'}</span>
            <span aria-hidden="true">→</span>
            <span>{activeSegment.endPoint || '终点未设置'}</span>
          </p>
          <div className="detail-metric-strip" aria-label="路段核心指标">
            <div><small>日期</small><strong>{activeSegmentDate || '未设置'}</strong></div>
            <div><small>预计里程</small><strong>{formatDistance(getTrackDistanceMeters(activeSegment))}</strong></div>
            <div><small>预计用时</small><strong>{formatSegmentEstimatedDuration(activeSegment)}</strong></div>
            <div><small>预估过路费</small><strong>{formatSegmentEstimatedToll(activeSegment)}</strong></div>
          </div>
        </div>
      ) : (
        <>
          <h2>轨迹详情</h2>
          <p className="hint-text">{filterContext.tripName} · {filterContext.dayDate} · {filteredSegments.length} 条路段</p>
        </>
      )}

      {!activeSegment && filterContext.segmentName === '全部路段' && (
        <p className="hint-text">当前为全部路段，请先选择一条具体轨迹以查看和编辑详情。</p>
      )}

      {!!activeSegment && (!isSingleSegmentView || detailEditMode) && (
        <div className={`segment-meta-editor ${detailEditMode ? 'editing' : ''}`}>
          {!isSingleSegmentView && !detailEditMode && <div className="segment-detail-edit-header">
            <div>
              <p>轨迹信息</p>
              <span>只读浏览</span>
            </div>
            <button type="button" className="btn-primary" onClick={startDetailEdit} disabled={isReadonlyMode}>编辑详情</button>
          </div>}
          {detailEditMode ? (
            <div className="segment-meta-row">
              <label>
                轨迹名称
                <input
                  value={segmentMetaDraft?.segmentId === activeSegment.id ? segmentMetaDraft.name : activeSegment.name}
                  onChange={(event) => onUpdateSegmentMetaDraft({ name: event.target.value })}
                  disabled={isReadonlyMode}
                />
              </label>
              <label>
                对应日期
                <input
                  type="date"
                  value={segmentMetaDraft?.segmentId === activeSegment.id ? segmentMetaDraft.date : activeSegmentDate}
                  onChange={(event) => onUpdateSegmentMetaDraft({ date: event.target.value })}
                  disabled={isReadonlyMode}
                />
              </label>
            </div>
          ) : !isSingleSegmentView ? (
            <div className="segment-detail-readonly-grid">
              <div><small>轨迹名称</small><strong>{activeSegment.name}</strong></div>
              <div><small>对应日期</small><strong>{activeSegmentDate || '未设置'}</strong></div>
            </div>
          ) : null}
          {!isSingleSegmentView && <div className="trip-item-actions">
            <button type="button" onClick={() => onMoveSegmentInTrip(activeSegment.id, 'up')} disabled={isReadonlyMode || !canMoveSegmentUp}>
              上移
            </button>
            <button
              type="button"
              onClick={() => onMoveSegmentInTrip(activeSegment.id, 'down')}
              disabled={isReadonlyMode || !canMoveSegmentDown}
            >
              下移
            </button>
          </div>}
        </div>
      )}

      {!isSingleSegmentView && <>
      <p>路段名称列表：</p>
      <ul className="route-list">
        {filteredSegments.map((segment, index) => (
          <li key={segment.id} className={`route-item ${segment.id === activeSegmentId ? 'active' : ''}`}>
            <div className="route-item-header">
              <strong title={segment.name}>{segment.name}</strong>
              <div className="route-actions">
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => onDeleteSegment({ segmentId: segment.id, index, name: segment.name })}
                  disabled={isReadonlyMode}
                >
                  <AppIcon name="trash" className="icon-inline" />
                  删除
                </button>
              </div>
            </div>
            <div className="route-item-meta">
              <span>日期：{segment.date || segment.dayDate || '未设置'}</span>
              <span>里程：{formatDistance(getTrackDistanceMeters(segment))}</span>
              <span>预计行驶时间：{formatSegmentEstimatedDuration(segment)}</span>
              <span>预估过路费：{formatSegmentEstimatedToll(segment)}</span>
            </div>
          </li>
        ))}
      </ul>
      </>}

      {filteredSegments.length === 0 && (
        <EmptyState
          icon="segment"
          title="当前筛选下暂无路段"
          description="试试调整上方的旅程 / 日期 / 路段筛选，或新建路段。"
        />
      )}

      {!!activeSegment && (
        <>
        <nav className="detail-anchor-nav" aria-label="路段详情快速导航">
          {detailAnchorItems.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => scrollToAnchor(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {detailEditMode && detailDraft ? (
          <div className="segment-route-edit-grid">
            <label className="route-type-control">
              路线类型
              <select
                value={detailDraft.routeMode}
                onChange={(event) => setDetailDraft((current) => current ? { ...current, routeMode: event.target.value as RouteType } : current)}
                disabled={isReadonlyMode}
              >
                <option value="DRIVING">驾车路线</option>
                <option value="CYCLING">骑行路线（走小路）</option>
              </select>
            </label>
            <label className="route-type-control">
              路线策略
              <select
                value={detailDraft.routePreference}
                onChange={(event) => setDetailDraft((current) => current ? { ...current, routePreference: event.target.value as RoutePreference } : current)}
                disabled={isReadonlyMode || detailDraft.routeMode === 'CYCLING'}
              >
                {routePreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="segment-detail-readonly-grid segment-route-readonly">
            <div><small>路线类型</small><strong>{routeMode === 'CYCLING' ? '骑行路线（走小路）' : '驾车路线'}</strong></div>
            <div><small>路线策略</small><strong>{getRoutePreferenceLabel(routePreference)}</strong></div>
          </div>
        )}

        <details id="detail-seg-route" className="detail-collapsible" open>
          <summary>路线预估</summary>
          <div className="detail-collapsible-body">
          <div className="segment-detail-readonly-grid">
            {isPlanning && <div><small>全程预计里程</small><strong>{formatDistance(getTrackDistanceMeters(activeSegment))}</strong></div>}
            <div><small>预计行驶时间</small><strong>{formatSegmentEstimatedDuration(activeSegment)}</strong></div>
            <div>
              <small>耗时计算时间</small>
              <strong>{hasCurrentDurationEstimate(activeSegment) ? formatDurationUpdatedAt(activeSegment.durationUpdatedAt) : '未计算'}</strong>
            </div>
            <div><small>预估过路费</small><strong>{formatSegmentEstimatedToll(activeSegment)}</strong></div>
            <div>
              <small>收费路段里程</small>
              <strong>{hasCurrentTollEstimate(activeSegment) ? formatTollDistance(activeSegment.tollDistanceMeters) : '待计算'}</strong>
            </div>
            <div><small>费用计算时间</small><strong>{hasCurrentTollEstimate(activeSegment) ? formatTollUpdatedAt(activeSegment.tollUpdatedAt) : '未计算'}</strong></div>
            <div><small>数据说明</small><strong>{routeMode === 'CYCLING' ? '高德骑行路线预估' : '高德驾车路线预估'}</strong></div>
          </div>
          {!isReadonlyMode && (
            <button
              type="button"
              className="btn-secondary toll-refresh-button"
              onClick={onRefreshRouteEstimate}
              disabled={isRouteEstimateRefreshing}
            >
              {isRouteEstimateRefreshing ? '正在重新计算…' : '重新计算路线、费用和时间'}
            </button>
          )}
          <p className="hint-text">预估时间仅包含路线行驶时间，实际用时受路况、天气及途中停留影响；预估金额以实际收费为准。</p>
          </div>
        </details>

        <div id="detail-seg-endpoints" className="endpoint-section">
          <p>起点 / 终点</p>
          {!detailEditMode ? (
            <div className="endpoint-readonly-grid">
              <div className="endpoint-readonly-card">
                <small>起点</small>
                <strong>{activeSegment?.startPoint || '未设置起点'}</strong>
                <span>{formatCoordText(activeSegment?.startCoord)}</span>
              </div>
              <div className="endpoint-readonly-card">
                <small>终点</small>
                <strong>{activeSegment?.endPoint || '未设置终点'}</strong>
                <span>{formatCoordText(activeSegment?.endCoord)}</span>
              </div>
            </div>
          ) : (
            <div className="endpoint-grid">
              <div>
                <label className="form-field-label" htmlFor="detail-segment-start">起点</label>
                <PlaceAutocomplete
                  inputId="detail-segment-start"
                  inputLabel="起点"
                  valueText={endpointDraft?.startPoint ?? ''}
                  onValueTextChange={(text) => onUpdateEndpointText('startPoint', text)}
                  onSelect={(result) =>
                    onSelectEndpointPlace('startPoint', {
                      label: result.label,
                      lat: result.lat,
                      lng: result.lng,
                      amapId: result.amapId,
                    })
                  }
                  placeholder="输入起点地名"
                  disabled={isReadonlyMode || !detailEditMode}
                />
              </div>
              <div>
                <label className="form-field-label" htmlFor="detail-segment-end">终点</label>
                <PlaceAutocomplete
                  inputId="detail-segment-end"
                  inputLabel="终点"
                  valueText={endpointDraft?.endPoint ?? ''}
                  onValueTextChange={(text) => onUpdateEndpointText('endPoint', text)}
                  onSelect={(result) =>
                    onSelectEndpointPlace('endPoint', {
                      label: result.label,
                      lat: result.lat,
                      lng: result.lng,
                      amapId: result.amapId,
                    })
                  }
                  placeholder="输入终点地名"
                  disabled={isReadonlyMode || !detailEditMode}
                />
              </div>
            </div>
          )}
        </div>

        <details id="detail-seg-waypoints" className="detail-collapsible" open>
          <summary>途经点<span className="detail-collapsible-count">{waypoints.length}</span></summary>
          <div className="detail-collapsible-body">
          <p>途经点数量：{waypoints.length}</p>
          {isPlanning && waypoints.length > 0 && <p className="hint-text">
            从本路段起点按途经顺序累计，不含游览、休息等停留时间。
            {detailEditMode ? ' 编辑期间不显示途经点预估，保存后查看。'
              : !waypointEstimates ? ' 分段预估待计算，可点击上方“重新计算路线、费用和时间”。' : ''}
          </p>}

          {detailEditMode && (
            <div className="waypoint-actions">
              <button type="button" onClick={onAddWaypoint} disabled={isReadonlyMode}>
                + 添加途经点
              </button>
            </div>
          )}

          <ul className="waypoint-list">
            {waypoints.map((waypoint, index) => (
              <li key={waypoint.id} className="waypoint-item">
                <span>#{index + 1}</span>

                {detailEditMode ? (
                  <PlaceAutocomplete
                    inputId={`detail-waypoint-${waypoint.id}`}
                    inputLabel={`途经点 ${index + 1}`}
                    valueText={waypoint.name}
                    onValueTextChange={(text) => onUpdateWaypointName(waypoint.id, text)}
                    onSelect={(result) =>
                      onSelectWaypointPlace(waypoint.id, {
                        label: result.label,
                        lat: result.lat,
                        lng: result.lng,
                        amapId: result.amapId,
                      })
                    }
                    placeholder="输入地名并选择候选"
                    disabled={isReadonlyMode}
                  />
                ) : (
                  <span className="waypoint-content">
                    <span>
                    {waypoint.name || '未命名途经点'}
                    {typeof waypoint.lat === 'number' && typeof waypoint.lng === 'number'
                      ? `（${waypoint.lat.toFixed(6)}, ${waypoint.lng.toFixed(6)}）`
                      : '（未解析坐标）'}
                    {waypoint.timestamp ? ` · ${waypoint.timestamp}` : ''}
                    </span>
                    {isPlanning && <small className="waypoint-estimate" aria-live="polite">
                      {isRouteEstimateRefreshing ? '正在计算途经点预估…'
                        : typeof waypoint.lat !== 'number' || typeof waypoint.lng !== 'number' ? '待解析坐标'
                        : !waypointEstimates ? '距起点：待计算 · 预计行驶：待计算'
                        : <>
                          距起点：{waypointEstimates[index]?.distanceMeters !== undefined
                            ? `${(waypointEstimates[index].distanceMeters! / 1000).toFixed(1)} 公里` : '暂无可靠数据'}
                          {' · '}预计行驶：{waypointEstimates[index]?.durationSeconds !== undefined
                            ? formatDurationSeconds(waypointEstimates[index].durationSeconds!) : '暂无可靠数据'}
                        </>}
                    </small>}
                  </span>
                )}

                <div className="waypoint-buttons">
                  {detailEditMode && (
                    <>
                      <button type="button" onClick={() => onMoveWaypoint(waypoint.id, 'up')} disabled={isReadonlyMode}>
                        上移
                      </button>
                      <button type="button" onClick={() => onMoveWaypoint(waypoint.id, 'down')} disabled={isReadonlyMode}>
                        下移
                      </button>
                      <button type="button" onClick={() => onDeleteWaypoint(waypoint.id)} disabled={isReadonlyMode}>
                        删除
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof waypoint.lat !== 'number' || typeof waypoint.lng !== 'number') {
                        void alertDialog('该途经点未解析坐标，请先选择搜索结果。')
                        return
                      }
                      onLocateWaypoint(waypoint)
                    }}
                  >
                    定位
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!waypoints.length && <p className="hint-text">当前路段无途经点。</p>}
          </div>
        </details>

        {detailEditMode && detailDraft ? (
          <div id="detail-seg-score" className="segment-score-section">
            <SegmentScoreFields
              title="轨迹评分"
              values={{ scenicScore: detailDraft.scenicScore, difficultyScore: detailDraft.difficultyScore }}
              onChange={(field, value) => {
                setDetailDraft((current) => current ? { ...current, [field]: value } : current)
              }}
              disabled={isReadonlyMode}
              hintText="支持 1.0 ~ 10.0，系统会自动限制范围并规范为 1 位小数。"
            />
            <SegmentReviewFactsEditor
              draft={detailDraft.reviewFactsDraft}
              onDraftChange={(patch) => {
                setDetailDraft((current) => current
                  ? { ...current, reviewFactsDraft: { ...current.reviewFactsDraft, ...patch } }
                  : current)
              }}
              disabled={isReadonlyMode}
              hintText="实际里程/时间/过路费可选填；未填写的路段在汇总时不会被统计。"
            />
          </div>
        ) : (
          <div id="detail-seg-score" className="segment-detail-section">
            <p>轨迹评分</p>
            <div className="segment-detail-readonly-grid">
              <div><small>风景评分</small><strong>{formatScoreDisplay(activeSegment.scenicScore)}</strong></div>
              <div><small>难度评分</small><strong>{formatScoreDisplay(activeSegment.difficultyScore)}</strong></div>
            </div>
          </div>
        )}

        {!detailEditMode && activeSegment.reviewFacts && (
          <div id="detail-seg-facts" className="segment-detail-section">
            <p>实际记录</p>
            {(activeSegment.reviewFacts.tags?.length ?? 0) > 0 && (
              <div className="segment-review-tag-options roadbook-tags-readonly">
                {activeSegment.reviewFacts.tags?.map((tag) => (
                  <span key={tag} className="review-tag-chip selected">{getReviewTagLabel(tag)}</span>
                ))}
              </div>
            )}
            {(() => {
              const actualDistance = formatSegmentActualDistance(activeSegment)
              const actualDuration = formatSegmentActualDuration(activeSegment)
              const actualToll = formatSegmentActualToll(activeSegment)
              const rows = [
                actualDistance ? ['里程', formatDistance(getTrackDistanceMeters(activeSegment)), actualDistance] : null,
                actualDuration ? ['用时', formatSegmentEstimatedDuration(activeSegment), actualDuration] : null,
                actualToll ? ['过路费', formatSegmentEstimatedToll(activeSegment), actualToll] : null,
              ].filter((row): row is string[] => Boolean(row))
              if (rows.length === 0) return null
              return (
                <table className="segment-actual-compare-table">
                  <thead>
                    <tr><th>项目</th><th>预计</th><th>实际</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, estimated, actual]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{estimated}</td>
                        <td><strong>{actual}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
          </div>
        )}

        <div id="detail-seg-note" className="segment-note-section">
          <label className="form-field-label" htmlFor="detail-segment-note">轨迹备注</label>
          {detailEditMode && detailDraft ? (
            <textarea
              id="detail-segment-note"
              value={detailDraft.note}
              onChange={(event) => setDetailDraft((current) => current ? { ...current, note: event.target.value } : current)}
              placeholder="记录这段轨迹的观感、注意事项、补给信息等。"
              rows={4}
              disabled={isReadonlyMode}
            />
          ) : (
            <p className="segment-note-readonly">{activeSegment.note?.trim() || '暂无备注'}</p>
          )}
        </div>

        <p>总里程：{summary.totalDistanceText}</p>
        <p>预计行驶时间：{summary.totalEstimatedDurationText}</p>
        <p>预估过路费：{summary.totalEstimatedTollText}</p>
        </>
      )}
    </section>
  )
}

export default MapPlaceholder

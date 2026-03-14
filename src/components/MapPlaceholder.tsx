import PlaceAutocomplete from './PlaceAutocomplete'
import type { RoutePreference, RouteSegment, RouteSummary, RouteType, Waypoint } from '../types/trip'
import { formatDistance, getTrackDistanceMeters } from '../utils/distance'

function formatCoordText(coord?: { lat: number; lon: number }): string {
  if (!coord) return '未解析坐标'
  return `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`
}

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

interface TripListItem {
  id: string
  title: string
  startDate: string
  endDate: string
  segmentCount: number
  tripDistanceText: string
}

interface MapPlaceholderProps {
  isReadonlyMode: boolean
  placeholderMode: 'trip-list' | 'segment-list'
  tripListItems: TripListItem[]
  onViewTrip: (tripId: string) => void
  onOpenTripManager: () => void
  onDeleteTrip: (tripId: string) => void

  filteredSegments: Array<RouteSegment & { dayDate?: string }>
  summary: RouteSummary
  filterContext: FilterContext
  editingSegmentId: string | null
  activeSegmentId: string | null
  activeSegment: RouteSegment | null
  activeSegmentDate: string
  segmentMetaDraft: SegmentMetaDraft | null
  onEditSegment: (segmentId: string) => void
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
  waypointEditMode: boolean
  onStartWaypointEdit: () => void
  onCancelWaypointEdit: () => void
  onSaveWaypoints: () => void
  onAddWaypoint: () => void
  onUpdateWaypointName: (id: string, name: string) => void
  onSelectWaypointPlace: (id: string, payload: { label: string; lat: number; lng: number; amapId?: string }) => void
  onMoveWaypoint: (id: string, direction: 'up' | 'down') => void
  onDeleteWaypoint: (id: string) => void

  endpointEditMode: boolean
  endpointDraft: EndpointDraft | null
  onStartEndpointEdit: () => void
  onCancelEndpointEdit: () => void
  onSaveEndpoints: () => void
  onUpdateEndpointText: (field: 'startPoint' | 'endPoint', text: string) => void
  onSelectEndpointPlace: (field: 'startPoint' | 'endPoint', payload: { label: string; lat: number; lng: number; amapId?: string }) => void
}

function MapPlaceholder({
  isReadonlyMode,
  placeholderMode,
  tripListItems,
  onViewTrip,
  onOpenTripManager,
  onDeleteTrip,
  filteredSegments,
  summary,
  filterContext,
  editingSegmentId,
  activeSegmentId,
  activeSegment,
  activeSegmentDate,
  segmentMetaDraft,
  onEditSegment,
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
  waypointEditMode,
  onStartWaypointEdit,
  onCancelWaypointEdit,
  onSaveWaypoints,
  onAddWaypoint,
  onUpdateWaypointName,
  onSelectWaypointPlace,
  onMoveWaypoint,
  onDeleteWaypoint,
  endpointEditMode,
  endpointDraft,
  onStartEndpointEdit,
  onCancelEndpointEdit,
  onSaveEndpoints,
  onUpdateEndpointText,
  onSelectEndpointPlace,
}: MapPlaceholderProps) {
  // all-trips 时占位区显示“旅程列表模式”；底部真实地图仍由 mapRenderSegments 绘制总览。
  if (placeholderMode === 'trip-list') {
    return (
      <section className="card-section">
        <h2>3) 轨迹详情区</h2>
        <p>当前筛选：旅程【{filterContext.tripName}】 / 日期【{filterContext.dayDate}】 / 路段【{filterContext.segmentName}】</p>
        <p className="hint-text">已切换为“所有旅程列表”视图，便于管理旅程。</p>
        <ul className="trip-placeholder-list">
          {tripListItems.map((trip) => (
            <li key={trip.id} className="trip-placeholder-item">
              <div className="trip-main-meta">
                <strong>{trip.title}</strong>
                <small>
                  {trip.startDate} ~ {trip.endDate} · {trip.segmentCount} 条路段 · 旅程总里程：{trip.tripDistanceText}
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
        {!tripListItems.length && <p className="hint-text">暂无旅程，请先在上方新增旅程。</p>}
      </section>
    )
  }

  return (
    <section className="card-section">
      <h2>3) 轨迹详情区</h2>

      <p>
        当前筛选：旅程【{filterContext.tripName}】 / 日期【{filterContext.dayDate}】 / 路段【
        {filterContext.segmentName}
        】
      </p>

      <p>当前筛选路段数量：{filteredSegments.length}</p>

      {!activeSegment && filterContext.segmentName === '全部路段' && (
        <p className="hint-text">当前为全部路段，请先选择一条具体轨迹以查看和编辑详情。</p>
      )}

      {!!activeSegment && (
        <div className="segment-meta-editor">
          <p>轨迹信息</p>
          {!segmentMetaDraft || segmentMetaDraft.segmentId !== activeSegment.id ? (
            <button type="button" onClick={() => onStartSegmentMetaEdit(activeSegment.id)} disabled={isReadonlyMode}>
              编辑轨迹信息
            </button>
          ) : (
            <div className="waypoint-actions">
              <button type="button" onClick={onSaveSegmentMetaEdit} disabled={isReadonlyMode}>
                保存
              </button>
              <button type="button" onClick={onCancelSegmentMetaEdit}>
                取消
              </button>
            </div>
          )}
          <div className="segment-meta-row">
            <label>
              轨迹名称
              <input
                value={segmentMetaDraft?.segmentId === activeSegment.id ? segmentMetaDraft.name : activeSegment.name}
                onChange={(event) => onUpdateSegmentMetaDraft({ name: event.target.value })}
                disabled={isReadonlyMode || segmentMetaDraft?.segmentId !== activeSegment.id}
              />
            </label>
            <label>
              对应日期
              <input
                type="date"
                value={segmentMetaDraft?.segmentId === activeSegment.id ? segmentMetaDraft.date : activeSegmentDate}
                onChange={(event) => onUpdateSegmentMetaDraft({ date: event.target.value })}
                disabled={isReadonlyMode || segmentMetaDraft?.segmentId !== activeSegment.id}
              />
            </label>
          </div>
          <div className="trip-item-actions">
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
          </div>
        </div>
      )}

      <p>路段名称列表：</p>
      <ul className="route-list">
        {filteredSegments.map((segment, index) => (
          <li key={segment.id} className={`route-item ${segment.id === activeSegmentId ? 'active' : ''}`}>
            <div className="route-item-header">
              <strong title={segment.name}>{segment.name}</strong>
              <div className="route-actions">
                <button type="button" onClick={() => onEditSegment(segment.id)} disabled={isReadonlyMode}>
                  {editingSegmentId === segment.id ? '编辑中' : '编辑轨迹'}
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => onDeleteSegment({ segmentId: segment.id, index, name: segment.name })}
                  disabled={isReadonlyMode}
                >
                  删除
                </button>
              </div>
            </div>
            <div className="route-item-meta">
              <span>日期：{segment.date || segment.dayDate || '未设置'}</span>
              <span>里程：{formatDistance(getTrackDistanceMeters(segment))}</span>
            </div>
          </li>
        ))}
      </ul>

      {filteredSegments.length === 0 && <p className="hint-text">当前筛选下暂无路段数据。</p>}

      {!!activeSegment && (
        <>
          <label className="route-type-control">
          路线类型
          <select value={routeMode} onChange={(e) => onChangeRouteMode(e.target.value as RouteType)} disabled={isReadonlyMode}>
            <option value="DRIVING">驾车路线</option>
            <option value="CYCLING">骑行路线（走小路）</option>
          </select>
          </label>

        <label className="route-type-control">
          路线策略
          <select
            value={routePreference}
            onChange={(e) => onChangeRoutePreference(e.target.value as RoutePreference)}
            disabled={isReadonlyMode || routeMode === 'CYCLING'}
          >
            <option value="HIGHWAY_FIRST">高速优先</option>
            <option value="AVOID_TOLL">避免收费</option>
          </select>
        </label>

        <div className="endpoint-section">
          <p>起点 / 终点</p>
          {!endpointEditMode ? (
            <button type="button" onClick={onStartEndpointEdit} disabled={isReadonlyMode || !activeSegmentId}>
              编辑起终点
            </button>
          ) : (
            <div className="waypoint-actions">
              <button type="button" onClick={onSaveEndpoints} disabled={isReadonlyMode}>
                保存
              </button>
              <button type="button" onClick={onCancelEndpointEdit}>
                取消
              </button>
            </div>
          )}

          {!endpointEditMode ? (
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
                <small>起点</small>
                <PlaceAutocomplete
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
                  disabled={isReadonlyMode || !endpointEditMode}
                />
              </div>
              <div>
                <small>终点</small>
                <PlaceAutocomplete
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
                  disabled={isReadonlyMode || !endpointEditMode}
                />
              </div>
            </div>
          )}
        </div>

        <div className="waypoint-section">
          <p>途经点（Waypoints）</p>
          <p>途经点数量：{waypoints.length}</p>

          {!waypointEditMode ? (
            <button type="button" onClick={onStartWaypointEdit} disabled={isReadonlyMode || !activeSegmentId}>
              编辑途经点
            </button>
          ) : (
            <div className="waypoint-actions">
              <button type="button" onClick={onAddWaypoint} disabled={isReadonlyMode}>
                + 添加途经点
              </button>
              <button type="button" onClick={onSaveWaypoints} disabled={isReadonlyMode}>
                保存途经点
              </button>
              <button type="button" onClick={onCancelWaypointEdit}>
                取消
              </button>
            </div>
          )}

          <ul className="waypoint-list">
            {waypoints.map((waypoint, index) => (
              <li key={waypoint.id} className="waypoint-item">
                <span>#{index + 1}</span>

                {waypointEditMode ? (
                  <PlaceAutocomplete
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
                  <span>
                    {waypoint.name || '未命名途经点'}
                    {typeof waypoint.lat === 'number' && typeof waypoint.lng === 'number'
                      ? `（${waypoint.lat.toFixed(6)}, ${waypoint.lng.toFixed(6)}）`
                      : '（未解析坐标）'}
                    {waypoint.timestamp ? ` · ${waypoint.timestamp}` : ''}
                  </span>
                )}

                <div className="waypoint-buttons">
                  <button type="button" onClick={() => onMoveWaypoint(waypoint.id, 'up')} disabled={isReadonlyMode || !waypointEditMode}>
                    上移
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveWaypoint(waypoint.id, 'down')}
                    disabled={isReadonlyMode || !waypointEditMode}
                  >
                    下移
                  </button>
                  <button type="button" onClick={() => onDeleteWaypoint(waypoint.id)} disabled={isReadonlyMode || !waypointEditMode}>
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof waypoint.lat !== 'number' || typeof waypoint.lng !== 'number') {
                        window.alert('该途经点未解析坐标，请先选择搜索结果。')
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

        <p>总里程：{summary.totalDistanceText}</p>
        </>
      )}
    </section>
  )
}

export default MapPlaceholder

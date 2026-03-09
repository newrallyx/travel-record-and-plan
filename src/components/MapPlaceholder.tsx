import PlaceAutocomplete from './PlaceAutocomplete'
import type { RoutePreference, RouteSegment, RouteSummary, RouteType, Waypoint } from '../types/trip'
import { getRouteTypeLabel, routePreferenceOptions, routeTypeOptions } from '../utils/routePreference'

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

interface TripListItem {
  id: string
  title: string
  startDate: string
  endDate: string
  segmentCount: number
}

interface MapPlaceholderProps {
  placeholderMode: 'trip-list' | 'segment-list'
  tripListItems: TripListItem[]
  onViewTrip: (tripId: string) => void
  onOpenTripManager: () => void
  onDeleteTrip: (tripId: string) => void

  filteredSegments: RouteSegment[]
  summary: RouteSummary
  filterContext: FilterContext
  editingSegmentId: string | null
  activeSegmentId: string | null
  activeSegment: RouteSegment | null
  activeSegmentDate: string
  onEditSegment: (segmentId: string) => void
  onDeleteSegment: (payload: { segmentId?: string; index: number; name: string }) => void

  routeType: RouteType
  onChangeRouteType: (value: RouteType) => void
  routePreference?: RoutePreference
  onChangeRoutePreference: (value: RoutePreference) => void

  onUpdateSegmentMeta: (segmentId: string, patch: { name: string; date: string }) => void
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
  onEditSegment,
  onDeleteSegment,
  routeType,
  onChangeRouteType,
  routePreference,
  onChangeRoutePreference,
  onUpdateSegmentMeta,
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
        <h2>3) 地图占位区</h2>
        <p>当前筛选：旅程【{filterContext.tripName}】 / 日期【{filterContext.dayDate}】 / 路段【{filterContext.segmentName}】</p>
        <p className="hint-text">已切换为“所有旅程列表”视图，便于管理旅程。</p>
        <ul className="trip-placeholder-list">
          {tripListItems.map((trip) => (
            <li key={trip.id} className="trip-placeholder-item">
              <div className="trip-main-meta">
                <strong>{trip.title}</strong>
                <small>
                  {trip.startDate} ~ {trip.endDate} · {trip.segmentCount} 条路段
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
                  编辑
                </button>
                <button type="button" className="danger-btn" onClick={() => onDeleteTrip(trip.id)}>
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
      <h2>3) 地图占位区</h2>

      <p>
        当前筛选：旅程【{filterContext.tripName}】 / 日期【{filterContext.dayDate}】 / 路段【
        {filterContext.segmentName}
        】
      </p>

      <p>当前筛选路段数量：{filteredSegments.length}</p>

      {!!activeSegment && (
        <div className="segment-meta-editor">
          <p>轨迹信息</p>
          <div className="segment-meta-row">
            <label>
              轨迹名称
              <input
                value={activeSegment.name}
                onChange={(event) =>
                  onUpdateSegmentMeta(activeSegment.id, { name: event.target.value, date: activeSegmentDate })
                }
              />
            </label>
            <label>
              对应日期
              <input
                type="date"
                value={activeSegmentDate}
                onChange={(event) =>
                  onUpdateSegmentMeta(activeSegment.id, { name: activeSegment.name, date: event.target.value })
                }
              />
            </label>
          </div>
          <div className="trip-item-actions">
            <button type="button" onClick={() => onMoveSegmentInTrip(activeSegment.id, 'up')} disabled={!canMoveSegmentUp}>
              上移
            </button>
            <button
              type="button"
              onClick={() => onMoveSegmentInTrip(activeSegment.id, 'down')}
              disabled={!canMoveSegmentDown}
            >
              下移
            </button>
          </div>
        </div>
      )}

      <label className="route-type-control">
        路线类型
        <select value={routeType} onChange={(e) => onChangeRouteType(e.target.value as RouteType)}>
          {routeTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {routeType === 'driving' && (
        <label className="route-type-control">
          路线策略
          <select
            value={routePreference ?? 'HIGHWAY_FIRST'}
            onChange={(e) => onChangeRoutePreference(e.target.value as RoutePreference)}
          >
            {routePreferenceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <p>路段名称列表：</p>
      <ul className="route-list">
        {filteredSegments.map((segment, index) => (
          <li key={segment.id} className={segment.id === activeSegmentId ? 'active' : ''}>
            <span>{segment.name} · {getRouteTypeLabel(segment.routeType)}</span>
            <div className="route-actions">
              <button type="button" onClick={() => onEditSegment(segment.id)}>
                {editingSegmentId === segment.id ? '编辑中' : '编辑轨迹'}
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => onDeleteSegment({ segmentId: segment.id, index, name: segment.name })}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>

      {filteredSegments.length === 0 && <p className="hint-text">当前筛选下暂无路段数据。</p>}

      <div className="endpoint-section">
        <p>起点 / 终点</p>
        {!endpointEditMode ? (
          <button type="button" onClick={onStartEndpointEdit} disabled={!activeSegmentId}>
            编辑起终点
          </button>
        ) : (
          <div className="waypoint-actions">
            <button type="button" onClick={onSaveEndpoints}>
              保存
            </button>
            <button type="button" onClick={onCancelEndpointEdit}>
              取消
            </button>
          </div>
        )}

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
              disabled={!endpointEditMode}
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
              disabled={!endpointEditMode}
            />
          </div>
        </div>
      </div>

      <div className="waypoint-section">
        <p>途经点（Waypoints）</p>
        <p>途经点数量：{waypoints.length}</p>

        {!waypointEditMode ? (
          <button type="button" onClick={onStartWaypointEdit} disabled={!activeSegmentId}>
            编辑途经点
          </button>
        ) : (
          <div className="waypoint-actions">
            <button type="button" onClick={onAddWaypoint}>
              + 添加途经点
            </button>
            <button type="button" onClick={onSaveWaypoints}>
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
                <button type="button" onClick={() => onMoveWaypoint(waypoint.id, 'up')} disabled={!waypointEditMode}>
                  上移
                </button>
                <button
                  type="button"
                  onClick={() => onMoveWaypoint(waypoint.id, 'down')}
                  disabled={!waypointEditMode}
                >
                  下移
                </button>
                <button type="button" onClick={() => onDeleteWaypoint(waypoint.id)} disabled={!waypointEditMode}>
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
      </div>

      <p>总里程：{summary.totalDistanceText}</p>
      <p>总时长：{summary.totalDurationText}</p>
    </section>
  )
}

export default MapPlaceholder

import PlaceAutocomplete from './PlaceAutocomplete'
import type { RoutePreference, RouteSegment, RouteSummary, Waypoint } from '../types/trip'

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

interface MapPlaceholderProps {
  filteredSegments: RouteSegment[]
  summary: RouteSummary
  filterContext: FilterContext
  editingSegmentId: string | null
  activeSegmentId: string | null
  onEditSegment: (segmentId: string) => void
  onDeleteSegment: (payload: { segmentId?: string; index: number; name: string }) => void

  routeType: RoutePreference
  onChangeRouteType: (value: RoutePreference) => void

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

// 地图占位组件：展示筛选结果、路线级编辑入口、途经点与起终点编辑。
function MapPlaceholder({
  filteredSegments,
  summary,
  filterContext,
  editingSegmentId,
  activeSegmentId,
  onEditSegment,
  onDeleteSegment,
  routeType,
  onChangeRouteType,
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
  return (
    <section className="card-section">
      <h2>3) 地图占位区</h2>

      <p>
        当前筛选：旅程【{filterContext.tripName}】 / 日期【{filterContext.dayDate}】 / 路段【
        {filterContext.segmentName}
        】
      </p>

      <p>当前筛选路段数量：{filteredSegments.length}</p>

      <label className="route-type-control">
        路线类型
        <select value={routeType} onChange={(e) => onChangeRouteType(e.target.value as RoutePreference)}>
          <option value="HIGHWAY_FIRST">高速优先</option>
          <option value="LESS_TOLL">避开高速</option>
          <option value="NORMAL_ROAD_FIRST">普通道路优先</option>
          <option value="AVOID_TOLL">避免收费</option>
          <option value="SHORTEST_TIME">最短时间</option>
        </select>
      </label>

      <p>路段名称列表：</p>
      <ul className="route-list">
        {filteredSegments.map((segment, index) => (
          <li key={segment.id} className={segment.id === activeSegmentId ? 'active' : ''}>
            <span>{segment.name}</span>
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

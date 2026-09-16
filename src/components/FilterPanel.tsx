import { useEffect, useMemo, useState } from 'react'
import type { FilterState, RouteColorMode, Trip } from '../types/trip'
import { sortTripDaysByDate } from '../utils/date'
import {
  ROAD_TYPE_MAP_CATEGORIES,
  ROAD_TYPE_MAP_COLORS,
  ROAD_TYPE_MAP_LABELS,
  type RoadTypeVisibility,
} from './map/roadTypeVisualization'

interface FilterPanelProps {
  trips: Trip[]
  filters: FilterState
  onChange: (next: FilterState) => void
  routeColorMode: RouteColorMode
  onChangeRouteColorMode: (mode: RouteColorMode) => void
  roadTypeVisibility: RoadTypeVisibility
  onChangeRoadTypeVisibility: (visibility: RoadTypeVisibility) => void
  canUseScoreColoring: boolean
  onOpenTripManager: () => void
  onDuplicateTrip: (tripId: string) => void
  onInsertDayAfter: (tripId: string, dayId: string) => void
  onDeleteDay: (tripId: string, dayId: string) => void
  onReorderDaySegments: (tripId: string, dayId: string, orderedSegmentIds: string[]) => void
  isReadonlyMode: boolean
  dayDistanceText: string
  tripDistanceText: string
  dayTollText: string
  tripTollText: string
  dayDurationText: string
  tripDurationText: string
}

// 筛选区：按“旅程 / 日期 / 路段”逐级筛选，并处理筛选联动重置。
function FilterPanel({
  trips,
  filters,
  onChange,
  routeColorMode,
  onChangeRouteColorMode,
  roadTypeVisibility,
  onChangeRoadTypeVisibility,
  canUseScoreColoring,
  onOpenTripManager,
  onDuplicateTrip,
  onInsertDayAfter,
  onDeleteDay,
  onReorderDaySegments,
  isReadonlyMode,
  dayDistanceText,
  tripDistanceText,
  dayTollText,
  tripTollText,
  dayDurationText,
  tripDurationText,
}: FilterPanelProps) {
  const [isSegmentOrderOpen, setIsSegmentOrderOpen] = useState(false)
  const [draggingSegmentId, setDraggingSegmentId] = useState<string | null>(null)
  const selectedTrip = trips.find((trip) => trip.id === filters.tripId)

  const dayOptions = useMemo(() => {
    return sortTripDaysByDate(selectedTrip?.days ?? [])
  }, [selectedTrip])

  const selectedDay = dayOptions.find((day) => day.id === filters.dayId)
  const segmentOptions = selectedDay?.routeSegments ?? []
  const areAllRoadTypesVisible = ROAD_TYPE_MAP_CATEGORIES.every((category) => roadTypeVisibility[category])
  const showTripStats = Boolean(filters.tripId && (!filters.dayId || filters.segmentId))
  const showDayStats = Boolean(filters.dayId && filters.segmentId)

  useEffect(() => {
    setIsSegmentOrderOpen(false)
    setDraggingSegmentId(null)
  }, [filters.tripId, filters.dayId])

  const moveSegmentToIndex = (segmentId: string, targetIndex: number) => {
    if (!selectedTrip || !selectedDay || isReadonlyMode) return
    const orderedSegmentIds = segmentOptions.map((segment) => segment.id)
    const currentIndex = orderedSegmentIds.indexOf(segmentId)
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedSegmentIds.length || currentIndex === targetIndex) {
      return
    }

    const [movedId] = orderedSegmentIds.splice(currentIndex, 1)
    orderedSegmentIds.splice(targetIndex, 0, movedId)
    onReorderDaySegments(selectedTrip.id, selectedDay.id, orderedSegmentIds)
  }

  return (
    <section className="card-section filter-panel-card">
      <div className="filter-row">
        <div className="filter-field trip-filter-field">
          <label className="filter-field-label" htmlFor="trip-filter-select">旅程</label>
          <div className="filter-control-row">
            <select
              id="trip-filter-select"
              value={filters.tripId}
              onChange={(e) => onChange({ tripId: e.target.value, dayId: '', segmentId: '' })}
            >
              <option value="">全部旅程</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
            <details className="filter-more-menu">
              <summary aria-label="打开旅程操作菜单" title="旅程操作菜单">⋯</summary>
              <div className="filter-more-menu-panel">
                <button type="button" onClick={onOpenTripManager}>
                  {isReadonlyMode ? '查看旅程' : '管理旅程'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (filters.tripId) onDuplicateTrip(filters.tripId)
                  }}
                  disabled={isReadonlyMode || !filters.tripId}
                >
                  新建副本
                </button>
              </div>
            </details>
          </div>
        </div>

        <div className="filter-field date-filter-field">
          <label className="filter-field-label" htmlFor="day-filter-select">日期</label>
          <div className="filter-control-row">
            <select
              id="day-filter-select"
              value={filters.dayId}
              onChange={(e) => onChange({ ...filters, dayId: e.target.value, segmentId: '' })}
              disabled={!filters.tripId}
            >
              <option value="">全部日期</option>
              {dayOptions.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.date}
                </option>
              ))}
            </select>
            <details className="filter-more-menu">
              <summary aria-label="打开日期操作菜单" title="日期操作菜单">⋯</summary>
              <div className="filter-more-menu-panel">
                <button
                  type="button"
                  onClick={() => onInsertDayAfter(filters.tripId, filters.dayId)}
                  disabled={isReadonlyMode || !filters.tripId || !filters.dayId}
                  title="在当前日期后插入空白的一天，并将后续日期顺延一天"
                >
                  插入下一天
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  onClick={() => onDeleteDay(filters.tripId, filters.dayId)}
                  disabled={isReadonlyMode || !filters.tripId || !filters.dayId}
                  title="删除当前日期，并将后续日期提前一天"
                >
                  删除当天
                </button>
                <button
                  type="button"
                  aria-expanded={isSegmentOrderOpen}
                  aria-controls="day-segment-order-panel"
                  onClick={() => setIsSegmentOrderOpen((current) => !current)}
                  disabled={isReadonlyMode || !filters.tripId || !filters.dayId || segmentOptions.length < 2}
                  title={segmentOptions.length < 2 ? '当天至少需要两条路段才能排序' : '调整当天全部路段的先后顺序'}
                >
                  {isSegmentOrderOpen ? '收起路段排序' : '调整路段顺序'}
                </button>
              </div>
            </details>
          </div>
        </div>

        <div className="filter-field segment-filter-field">
          <label className="filter-field-label" htmlFor="segment-filter-select">路段</label>
          <select
            id="segment-filter-select"
            value={filters.segmentId}
            onChange={(e) => onChange({ ...filters, segmentId: e.target.value })}
            disabled={!filters.dayId}
          >
            <option value="">全部路段</option>
            {segmentOptions.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSegmentOrderOpen && selectedTrip && selectedDay && (
        <section id="day-segment-order-panel" className="day-segment-order-panel" aria-label={`${selectedDay.date} 路段排序`}>
          <div className="day-segment-order-header">
            <div>
              <h3>{selectedDay.date} 路段顺序</h3>
              <p>拖拽路段，或使用上移、下移按钮；保存会立即生效。</p>
            </div>
            <button type="button" onClick={() => setIsSegmentOrderOpen(false)}>
              完成
            </button>
          </div>
          <ol className="day-segment-order-list">
            {segmentOptions.map((segment, index) => (
              <li
                key={segment.id}
                className={draggingSegmentId === segment.id ? 'dragging' : ''}
                draggable={!isReadonlyMode}
                onDragStart={() => setDraggingSegmentId(segment.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!draggingSegmentId) return
                  moveSegmentToIndex(draggingSegmentId, index)
                  setDraggingSegmentId(null)
                }}
                onDragEnd={() => setDraggingSegmentId(null)}
              >
                <span className="day-segment-order-number">#{index + 1}</span>
                <div className="day-segment-order-meta">
                  <strong>{segment.name}</strong>
                  <small>{segment.startPoint} → {segment.endPoint}</small>
                </div>
                <div className="day-segment-order-actions">
                  <button
                    type="button"
                    aria-label={`上移路段“${segment.name}”`}
                    onClick={() => moveSegmentToIndex(segment.id, index - 1)}
                    disabled={isReadonlyMode || index === 0}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    aria-label={`下移路段“${segment.name}”`}
                    onClick={() => moveSegmentToIndex(segment.id, index + 1)}
                    disabled={isReadonlyMode || index === segmentOptions.length - 1}
                  >
                    下移
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="route-color-mode-section">
        <div className="route-color-toolbar">
          <span className="route-color-mode-title">着色</span>
          <div className="route-color-mode-options" role="radiogroup" aria-label="地图轨迹着色模式">
            <label className={`route-color-mode-option ${routeColorMode === 'default' ? 'active' : ''}`}>
              <input
                type="radio"
                name="route-color-mode"
                checked={routeColorMode === 'default'}
                onChange={() => onChangeRouteColorMode('default')}
              />
              默认
            </label>
            <label className={`route-color-mode-option ${routeColorMode === 'scenic' ? 'active' : ''}`}>
              <input
                type="radio"
                name="route-color-mode"
                checked={routeColorMode === 'scenic'}
                disabled={!canUseScoreColoring}
                onChange={() => onChangeRouteColorMode('scenic')}
              />
              风景评分
            </label>
            <label className={`route-color-mode-option ${routeColorMode === 'difficulty' ? 'active' : ''}`}>
              <input
                type="radio"
                name="route-color-mode"
                checked={routeColorMode === 'difficulty'}
                disabled={!canUseScoreColoring}
                onChange={() => onChangeRouteColorMode('difficulty')}
              />
              难度评分
            </label>
            <label className={`route-color-mode-option ${routeColorMode === 'roadType' ? 'active' : ''}`}>
              <input
                type="radio"
                name="route-color-mode"
                checked={routeColorMode === 'roadType'}
                onChange={() => onChangeRouteColorMode('roadType')}
              />
              道路类型
            </label>
          </div>
          <div className={`route-color-trailing-controls ${routeColorMode === 'roadType' ? 'has-road-type-controls' : ''}`}>
            {routeColorMode === 'roadType' && (
              <div className="road-type-visibility-controls" aria-label="道路类型显示开关">
                <div className="road-type-visibility-options">
                  {ROAD_TYPE_MAP_CATEGORIES.map((category) => (
                    <label className="road-type-visibility-option" key={category}>
                      <input
                        type="checkbox"
                        checked={roadTypeVisibility[category]}
                        onChange={(event) => onChangeRoadTypeVisibility({
                          ...roadTypeVisibility,
                          [category]: event.target.checked,
                        })}
                      />
                      <span className="road-type-color-chip" style={{ backgroundColor: ROAD_TYPE_MAP_COLORS[category] }} />
                      {ROAD_TYPE_MAP_LABELS[category]}
                    </label>
                  ))}
                </div>
                <div className="road-type-visibility-actions">
                  <button
                    type="button"
                    onClick={() => onChangeRoadTypeVisibility({
                      EXPRESSWAY: true,
                      NATIONAL_ROAD: true,
                      PROVINCIAL_ROAD: true,
                      OTHER: true,
                    })}
                    disabled={areAllRoadTypesVisible}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeRoadTypeVisibility({
                      EXPRESSWAY: false,
                      NATIONAL_ROAD: false,
                      PROVINCIAL_ROAD: false,
                      OTHER: false,
                    })}
                    disabled={!ROAD_TYPE_MAP_CATEGORIES.some((category) => roadTypeVisibility[category])}
                  >
                    全不选
                  </button>
                </div>
              </div>
            )}
            <details className="route-color-info">
              <summary aria-label="查看地图着色说明" title="查看地图着色说明">ⓘ</summary>
              <div className="route-color-info-popover">
                <p>着色模式互斥，同一时间最多开启一种可视化。</p>
                {routeColorMode === 'roadType' ? (
                  <p>灰色代表待核实，且不受四类道路开关影响；地图上的“道路统计”图例可查看当前范围与历史累计。</p>
                ) : !canUseScoreColoring ? (
                  <p>评分着色仅在选中具体旅程时可用；“全部旅程”会混合多次记录，已自动关闭评分着色。</p>
                ) : null}
              </div>
            </details>
          </div>
        </div>
      </div>

      {(showTripStats || showDayStats) && (
        <div
          className={`filter-stats-row ${showTripStats && showDayStats ? 'has-two-scopes' : ''}`}
          aria-label="筛选范围统计"
        >
          {showTripStats && (
            <p>
              <strong className="filter-stat-label">旅程总计</strong>
              里程 {tripDistanceText} · 预计 {tripDurationText} · 过路费 {tripTollText}
            </p>
          )}
          {showDayStats && (
            <p>
              <strong className="filter-stat-label">当日统计</strong>
              里程 {dayDistanceText} · 预计 {dayDurationText} · 过路费 {dayTollText}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export default FilterPanel

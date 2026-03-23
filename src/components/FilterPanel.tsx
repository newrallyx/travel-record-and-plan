import { useMemo } from 'react'
import type { FilterState, RouteColorMode, Trip } from '../types/trip'

interface FilterPanelProps {
  trips: Trip[]
  filters: FilterState
  onChange: (next: FilterState) => void
  routeColorMode: RouteColorMode
  onChangeRouteColorMode: (mode: RouteColorMode) => void
  canUseScoreColoring: boolean
  onOpenTripManager: () => void
  isReadonlyMode: boolean
  dayDistanceText: string
  tripDistanceText: string
}

// 筛选区：按“旅程 / 日期 / 路段”逐级筛选，并处理筛选联动重置。
function FilterPanel({
  trips,
  filters,
  onChange,
  routeColorMode,
  onChangeRouteColorMode,
  canUseScoreColoring,
  onOpenTripManager,
  isReadonlyMode,
  dayDistanceText,
  tripDistanceText,
}: FilterPanelProps) {
  const selectedTrip = trips.find((trip) => trip.id === filters.tripId)

  const dayOptions = useMemo(() => {
    return selectedTrip?.days ?? []
  }, [selectedTrip])

  const segmentOptions = useMemo(() => {
    const selectedDay = dayOptions.find((day) => day.id === filters.dayId)
    return selectedDay?.routeSegments ?? []
  }, [dayOptions, filters.dayId])

  return (
    <section className="card-section filter-panel-card">
      <h2 className="filter-panel-title">2) 筛选区</h2>

      <div className="filter-row">
        <label>
          旅程
          <div className="trip-filter-row">
            <select
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
            <button type="button" onClick={onOpenTripManager}>
              {isReadonlyMode ? '查看旅程' : '管理旅程'}
            </button>
          </div>
        </label>

        <label>
          日期
          <select
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
        </label>

        <label>
          路段
          <select
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
        </label>
      </div>

      {!filters.tripId && <p className="hint-text filter-hint">已选择“全部旅程”，可查看所有路段。</p>}
      {filters.tripId && !filters.dayId && <p className="hint-text filter-hint">当前为该旅程下“全部日期”。</p>}
      {filters.dayId && !filters.segmentId && <p className="hint-text filter-hint">当前为该日期下“全部路段”。</p>}

      <div className="filter-stats-row">
        {filters.tripId && <p>旅程总里程：{tripDistanceText}</p>}
        {filters.dayId && <p>当日总里程：{dayDistanceText}</p>}
      </div>

      <div className="route-color-mode-section">
        <p className="route-color-mode-title">地图轨迹着色</p>
        <div className="route-color-mode-options" role="radiogroup" aria-label="地图轨迹评分可视化">
          <label className={`route-color-mode-option ${routeColorMode === 'default' ? 'active' : ''}`}>
            <input
              type="radio"
              name="route-color-mode"
              checked={routeColorMode === 'default'}
              onChange={() => onChangeRouteColorMode('default')}
            />
            默认颜色
          </label>
          <label className={`route-color-mode-option ${routeColorMode === 'scenic' ? 'active' : ''}`}>
            <input
              type="radio"
              name="route-color-mode"
              checked={routeColorMode === 'scenic'}
              disabled={!canUseScoreColoring}
              onChange={() => onChangeRouteColorMode('scenic')}
            />
            风景评分可视化
          </label>
          <label className={`route-color-mode-option ${routeColorMode === 'difficulty' ? 'active' : ''}`}>
            <input
              type="radio"
              name="route-color-mode"
              checked={routeColorMode === 'difficulty'}
              disabled={!canUseScoreColoring}
              onChange={() => onChangeRouteColorMode('difficulty')}
            />
            难度评分可视化
          </label>
        </div>
        <p className="hint-text filter-hint">
          {canUseScoreColoring
            ? '评分着色模式互斥，同一时间最多开启一种可视化。'
            : '评分着色仅在选中具体旅程时可用；“全部旅程”会混合多次记录，已自动关闭评分着色。'}
        </p>
      </div>
    </section>
  )
}

export default FilterPanel

import { useEffect, useMemo, useState } from 'react'
import type { FilterState, RouteColorMode, Trip } from '../types/trip'
import { sortTripDaysByDate } from '../utils/date'
import { filterTripsByYear, getSelectedYear, getTripYear } from '../utils/tripYear'
import type { RoadTypeVisibility } from './map/roadTypeVisualization'
import RouteColorControls from './map/RouteColorControls'
import RoadbookExportPanel from './roadbook/RoadbookExportPanel'

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
  const [exportTripId, setExportTripId] = useState<string | null>(null)
  const selectedTrip = trips.find((trip) => trip.id === filters.tripId)
  const selectedYear = getSelectedYear(trips, filters)
  const yearOptions = [...new Set(trips.map(getTripYear))].sort((a, b) => a.localeCompare(b))
  const yearTrips = filterTripsByYear(trips, selectedYear)
  const showYearStats = Boolean(selectedYear && !filters.tripId)

  const dayOptions = useMemo(() => {
    return sortTripDaysByDate(selectedTrip?.days ?? [])
  }, [selectedTrip])

  const selectedDay = dayOptions.find((day) => day.id === filters.dayId)
  const segmentOptions = selectedDay?.routeSegments ?? []
  const showTripStats = Boolean(filters.tripId && (!filters.dayId || filters.segmentId))
  const showDayStats = Boolean(filters.dayId && filters.segmentId)

  useEffect(() => {
    setIsSegmentOrderOpen(false)
    setDraggingSegmentId(null)
  }, [filters.tripId, filters.dayId])

  useEffect(() => { setExportTripId(null) }, [filters.tripId])

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
        <div className="filter-field year-filter-field">
          <label className="filter-field-label" htmlFor="year-filter-select">年份</label>
          <select
            id="year-filter-select"
            value={selectedYear}
            onChange={(e) => onChange({ year: e.target.value, tripId: '', dayId: '', segmentId: '' })}
            title="按旅程开始年份分组，跨年旅程归入开始年份"
          >
            <option value="">全部年份</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year === 'unknown' ? '未注明年份' : `${year}年`}</option>
            ))}
          </select>
        </div>
        <div className="filter-field trip-filter-field">
          <label className="filter-field-label" htmlFor="trip-filter-select">旅程</label>
          <div className="filter-control-row">
            <select
              id="trip-filter-select"
              value={filters.tripId}
              onChange={(e) => onChange({ year: selectedYear, tripId: e.target.value, dayId: '', segmentId: '' })}
            >
              <option value="">{selectedYear ? '全年旅程' : '全部旅程'}</option>
              {yearTrips.map((trip) => (
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

      <RouteColorControls
        routeColorMode={routeColorMode}
        onChangeRouteColorMode={onChangeRouteColorMode}
        roadTypeVisibility={roadTypeVisibility}
        onChangeRoadTypeVisibility={onChangeRoadTypeVisibility}
        canUseScoreColoring={canUseScoreColoring}
        actions={trips.some(trip => trip.category === 'plan') && (
          <button type="button" className="btn-secondary planning-roadbook-export-button" disabled={selectedTrip?.category !== 'plan'}
            title={selectedTrip?.category === 'plan' ? '导出整个规划旅程，不受日期或路段筛选影响' : '请先选择一个规划旅程'}
            onClick={() => setExportTripId(selectedTrip?.id ?? null)}>导出规划路书</button>
        )}
      />

      {selectedTrip?.category === 'plan' && exportTripId === selectedTrip.id && (
        <RoadbookExportPanel key={selectedTrip.id} trip={selectedTrip} asDialog onClose={() => setExportTripId(null)} />
      )}

      {(showYearStats || showTripStats || showDayStats) && (
        <div
          className={`filter-stats-row ${showTripStats && showDayStats ? 'has-two-scopes' : ''}`}
          aria-label="筛选范围统计"
        >
          {(showTripStats || showYearStats) && (
            <p>
              <strong className="filter-stat-label">{showYearStats ? `全年总计 · ${yearTrips.length} 个旅程` : '旅程总计'}</strong>
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

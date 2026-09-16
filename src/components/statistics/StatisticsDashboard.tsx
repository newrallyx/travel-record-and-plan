import { useEffect, useMemo, useState } from 'react'
import type {
  ScoreDistribution,
  TripStatisticsBreakdown,
} from '../../types/tripStatistics.ts'
import type {
  DifficultyScoreBandKey,
  NumericBandDistribution,
  ScenicScoreBandKey,
} from '../../types/roadStatistics.ts'
import type { Trip } from '../../types/trip.ts'
import {
  DEFAULT_STATISTICS_FILTER,
  DEFAULT_TRIP_STATISTICS_SORT,
  filterStatisticsTrips,
  getStatisticsTripOptions,
  getStatisticsYears,
  sortTripStatisticsRows,
  type StatisticsDashboardFilter,
  type TripStatisticsSort,
  type TripStatisticsSortKey,
} from '../../utils/statisticsDashboard.ts'
import { useTripStatistics } from '../../hooks/useTripStatistics.ts'
import { NamedRoadTable, RoadComposition } from './RoadStatisticsPanels.tsx'
import RoadAnalysisManager from './RoadAnalysisManager.tsx'
import type { ResolvedRoutePatch } from '../map/types.ts'
import {
  COMPLETENESS_LABEL,
  formatNullableDistance,
  formatPercentage,
  MetricValue,
  OverviewCard,
} from './StatisticsPrimitives.tsx'

type DistributionMode =
  | 'plannedMileage'
  | 'actualMileage'
  | 'tripDays'
  | 'estimatedDrivingTime'
  | 'actualDrivingTime'

interface StatisticsDashboardProps {
  trips: readonly Trip[]
  currentTripId?: string
  currentSegmentId?: string
  isReadonlyMode?: boolean
  onRouteReplacement: (patch: ResolvedRoutePatch) => void
}

interface DistributionView {
  title: string
  description: string
  distribution: NumericBandDistribution<string>
}

function getScoreBandLabel(key: string): string {
  switch (key) {
    case 'TOP': return '9–10 分'
    case 'HIGH': return '7–<9 分'
    case 'MEDIUM': return '5–<7 分'
    case 'LOW': return '1–<5 分'
    default: return key
  }
}

function ScoreStatisticsModule<Key extends ScenicScoreBandKey | DifficultyScoreBandKey>({
  title,
  distribution,
  segmentCount,
}: {
  title: string
  distribution: ScoreDistribution<Key>
  segmentCount: number
}) {
  const orderedBands = [...distribution.bands].reverse()

  return (
    <section className="statistics-module" aria-label={`${title}统计`}>
      <header className="statistics-module-heading">
        <div>
          <h3>{title}</h3>
          <p>风景与驾驶难度分别按路段记录统计；未评分路段不进入平均分或评分里程占比。</p>
        </div>
      </header>
      <div className="statistics-score-summary">
        <article>
          <span>里程加权平均分</span>
          <strong>{distribution.distanceWeightedAverage === null ? '待补全' : `${distribution.distanceWeightedAverage.toFixed(1)} 分`}</strong>
          <small>仅使用已评分且里程已知的路段</small>
        </article>
        <article>
          <span>评分覆盖路段数</span>
          <strong>{distribution.ratedSegmentCount} / {segmentCount}</strong>
          <small>{segmentCount === 0 ? '暂无路段' : `${((distribution.ratedSegmentCount / segmentCount) * 100).toFixed(1)}% 路段已评分`}</small>
        </article>
        <article>
          <span>评分覆盖里程</span>
          <strong>{formatNullableDistance(distribution.ratedDistanceMeters)}</strong>
          <small>{distribution.distancePendingSegmentCount > 0
            ? `${distribution.distancePendingSegmentCount} 个已评分路段缺少里程`
            : '评分里程已按已知路段累计'}</small>
        </article>
      </div>
      <div className="statistics-table-wrap">
        <table className="statistics-table statistics-score-table">
          <thead>
            <tr>
              <th scope="col">评分档位</th>
              <th scope="col">路段数</th>
              <th scope="col">累计里程</th>
              <th scope="col">占已评分里程</th>
            </tr>
          </thead>
          <tbody>
            {orderedBands.map((band) => (
              <tr key={band.key}>
                <th scope="row">{getScoreBandLabel(band.key)}</th>
                <td>{band.itemCount}</td>
                <td>{formatNullableDistance(band.distanceMeters)}</td>
                <td>{formatPercentage(band.distanceShare)}</td>
              </tr>
            ))}
            <tr className="statistics-pending-row">
              <th scope="row">未评分</th>
              <td>{distribution.unrated.itemCount}</td>
              <td>{formatNullableDistance(distribution.unrated.distanceMeters)}</td>
              <td>—（不纳入）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DistributionModule({ mode, onChange, views }: {
  mode: DistributionMode
  onChange: (mode: DistributionMode) => void
  views: Record<DistributionMode, DistributionView>
}) {
  const current = views[mode]
  return (
    <section className="statistics-module" aria-label="旅程档位分布">
      <header className="statistics-module-heading statistics-module-heading-with-tabs">
        <div>
          <h3>旅程档位分布</h3>
          <p>{current.description}</p>
        </div>
        <div className="statistics-segmented-control" role="tablist" aria-label="统计档位类型">
          {(Object.entries(views) as Array<[DistributionMode, DistributionView]>).map(([key, view]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? 'active' : ''}
              onClick={() => onChange(key)}
            >
              {view.title}
            </button>
          ))}
        </div>
      </header>
      <div className="statistics-table-wrap">
        <table className="statistics-table">
          <thead>
            <tr>
              <th scope="col">档位</th>
              <th scope="col">旅程数</th>
              <th scope="col">关联里程</th>
              <th scope="col">关联里程占比</th>
            </tr>
          </thead>
          <tbody>
            {current.distribution.bands.map((band) => (
              <tr key={band.key}>
                <th scope="row">{band.label}</th>
                <td>{band.itemCount}</td>
                <td>{formatNullableDistance(band.distanceMeters)}</td>
                <td>{formatPercentage(band.distanceShare)}</td>
              </tr>
            ))}
            <tr className="statistics-pending-row">
              <th scope="row">待补全（不进入档位）</th>
              <td>{current.distribution.pending.itemCount}</td>
              <td>{formatNullableDistance(current.distribution.pending.distanceMeters)}</td>
              <td>—（不纳入）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SortHeader({
  label,
  sortKey,
  sort,
  onChange,
}: {
  label: string
  sortKey: TripStatisticsSortKey
  sort: TripStatisticsSort
  onChange: (key: TripStatisticsSortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="statistics-sort-button" onClick={() => onChange(sortKey)}>
        {label}<span aria-hidden="true">{active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
      </button>
    </th>
  )
}

function TripBreakdownTable({
  rows,
  sort,
  onChangeSort,
}: {
  rows: readonly TripStatisticsBreakdown[]
  sort: TripStatisticsSort
  onChangeSort: (key: TripStatisticsSortKey) => void
}) {
  return (
    <section className="statistics-module" aria-label="每次旅程明细">
      <header className="statistics-module-heading">
        <div>
          <h3>每次旅程明细</h3>
          <p>规划与实际字段分列汇总。标有“已记录”的合计仅覆盖已填写路段，不与待补全数据混合。</p>
        </div>
      </header>
      <div className="statistics-table-wrap">
        <table className="statistics-table statistics-trip-table">
          <thead>
            <tr>
              <SortHeader label="旅程" sortKey="startDate" sort={sort} onChange={onChangeSort} />
              <SortHeader label="规划里程" sortKey="plannedDistance" sort={sort} onChange={onChangeSort} />
              <SortHeader label="实际里程" sortKey="actualDistance" sort={sort} onChange={onChangeSort} />
              <SortHeader label="旅行天数" sortKey="tripDays" sort={sort} onChange={onChangeSort} />
              <SortHeader label="预计驾驶时间" sortKey="estimatedDrivingTime" sort={sort} onChange={onChangeSort} />
              <SortHeader label="实际驾驶时间" sortKey="actualDrivingTime" sort={sort} onChange={onChangeSort} />
              <SortHeader label="数据完整度" sortKey="completeness" sort={sort} onChange={onChangeSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((trip) => (
              <tr key={trip.tripId}>
                <th scope="row">
                  <span className="statistics-trip-title">{trip.title}</span>
                  <small>{trip.segmentCount} 个路段</small>
                </th>
                <td><MetricValue metric={trip.plannedDistanceMeters} kind="distance" /></td>
                <td><MetricValue metric={trip.actualDistanceMeters} kind="distance" /></td>
                <td><MetricValue metric={trip.tripDays} kind="days" /></td>
                <td><MetricValue metric={trip.estimatedDrivingTimeSeconds} kind="duration" /></td>
                <td><MetricValue metric={trip.actualDrivingTimeSeconds} kind="duration" /></td>
                <td>
                  <span className={`statistics-completeness-badge ${trip.dataCompleteness.overallStatus}`}>
                    {COMPLETENESS_LABEL[trip.dataCompleteness.overallStatus]}
                  </span>
                  <small className="statistics-cell-note">
                    规划：{COMPLETENESS_LABEL[trip.dataCompleteness.plannedDistance.status]}<br />
                    实际：{COMPLETENESS_LABEL[trip.dataCompleteness.actualDistance.status]}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StatisticsDashboard({ trips, currentTripId, currentSegmentId, isReadonlyMode, onRouteReplacement }: StatisticsDashboardProps) {
  const [filter, setFilter] = useState<StatisticsDashboardFilter>(DEFAULT_STATISTICS_FILTER)
  const [sort, setSort] = useState<TripStatisticsSort>(DEFAULT_TRIP_STATISTICS_SORT)
  const [distributionMode, setDistributionMode] = useState<DistributionMode>('plannedMileage')
  const [cacheRevision, setCacheRevision] = useState(0)

  const reviewTrips = useMemo(() => getStatisticsTripOptions(trips), [trips])
  const years = useMemo(() => getStatisticsYears(trips), [trips])

  useEffect(() => {
    if (filter.scope === 'year' && filter.year && !years.includes(filter.year)) {
      setFilter((current) => ({ ...current, year: '' }))
    }
    if (filter.scope === 'trip' && filter.tripId && !reviewTrips.some((trip) => trip.id === filter.tripId)) {
      setFilter((current) => ({ ...current, tripId: '' }))
    }
  }, [filter.scope, filter.tripId, filter.year, reviewTrips, years])

  const filteredTrips = useMemo(() => filterStatisticsTrips(trips, filter), [filter, trips])
  const { statistics, cacheStatus } = useTripStatistics(filteredTrips, trips, cacheRevision)
  const summary = statistics.current
  const rows = useMemo(() => sortTripStatisticsRows(summary.tripBreakdown, sort), [sort, summary.tripBreakdown])

  const distributionViews = useMemo<Record<DistributionMode, DistributionView>>(() => ({
    plannedMileage: {
      title: '规划里程',
      description: '仅对规划里程完整的旅程分档；未完成记录单列，不参与档位或里程占比。',
      distribution: summary.distributions.plannedMileage,
    },
    actualMileage: {
      title: '实际里程',
      description: '仅对实际里程完整的旅程分档；实际未记录或不完整的旅程不会并入规划里程。',
      distribution: summary.distributions.actualMileage,
    },
    tripDays: {
      title: '旅行天数',
      description: '按起止日期（含首尾两日）分档；日期不完整的旅程单列为待补全。',
      distribution: summary.distributions.tripDays,
    },
    estimatedDrivingTime: {
      title: '预计驾驶',
      description: '仅对预计驾驶时间完整的旅程分档；待计算路段不会以 0 小时计入。',
      distribution: summary.distributions.estimatedDrivingTime,
    },
    actualDrivingTime: {
      title: '实际驾驶',
      description: '仅对实际驾驶时间完整的旅程分档；实际未记录的数据单列，不与预计时间混合。',
      distribution: summary.distributions.actualDrivingTime,
    },
  }), [summary.distributions])

  const changeSort = (key: TripStatisticsSortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'startDate' ? 'asc' : 'desc' })
  }

  return (
    <section className="statistics-dashboard" aria-label="数据统计">
      <header className="statistics-dashboard-header">
        <div>
          <h2>数据统计</h2>
          <p>从已复盘旅程中查看规划、实际记录与评分覆盖情况。所有实际数据均与预计数据独立统计。</p>
        </div>
        {cacheStatus !== 'ready' && (
          <span className="statistics-cache-note">
            {cacheStatus === 'loading' ? '正在读取路线分析缓存…' : '路线分析缓存暂不可用'}
          </span>
        )}
      </header>

      <div className="statistics-filter-bar" role="search" aria-label="筛选统计范围">
        <label>
          <span>统计范围</span>
          <select
            value={filter.scope}
            onChange={(event) => setFilter((current) => ({ ...current, scope: event.target.value as StatisticsDashboardFilter['scope'] }))}
          >
            <option value="all">全部旅程</option>
            <option value="year">按年份</option>
            <option value="trip">具体旅程</option>
          </select>
        </label>
        {filter.scope === 'year' && (
          <label>
            <span>年份</span>
            <select value={filter.year} onChange={(event) => setFilter((current) => ({ ...current, year: event.target.value }))}>
              <option value="">全部年份</option>
              {years.map((year) => <option key={year} value={year}>{year} 年</option>)}
            </select>
          </label>
        )}
        {filter.scope === 'trip' && (
          <label className="statistics-trip-filter">
            <span>旅程</span>
            <select value={filter.tripId} onChange={(event) => setFilter((current) => ({ ...current, tripId: event.target.value }))}>
              <option value="">请选择旅程</option>
              {reviewTrips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
            </select>
          </label>
        )}
        {filter.scope !== 'all' && (
          <button type="button" className="btn-secondary" onClick={() => setFilter(DEFAULT_STATISTICS_FILTER)}>清除筛选</button>
        )}
      </div>

      <RoadAnalysisManager
        trips={trips}
        currentTripId={currentTripId}
        currentSegmentId={currentSegmentId}
        isReadonlyMode={isReadonlyMode}
        onReplacement={onRouteReplacement}
        onCacheChange={() => setCacheRevision((value) => value + 1)}
      />

      {filteredTrips.length === 0 ? (
        <div className="statistics-empty-state">
          <strong>{reviewTrips.length === 0 ? '还没有可统计的复盘旅程' : '没有匹配当前范围的旅程'}</strong>
          <span>{reviewTrips.length === 0 ? '在规划页完成旅程并转入复盘后，统计会自动生成。' : '请调整年份或选择其他旅程。'}</span>
        </div>
      ) : (
        <>
          <section className="statistics-overview" aria-label="统计总览">
            <article className="statistics-overview-card statistics-count-card">
              <span>已统计旅程</span>
              <strong>{summary.tripCount} 次</strong>
              <small>{summary.segmentCount} 个路段</small>
            </article>
            <OverviewCard label="规划里程" metric={summary.plannedDistanceMeters} kind="distance" />
            <OverviewCard label="实际里程" metric={summary.actualDistanceMeters} kind="distance" />
            <OverviewCard label="预计驾驶时间" metric={summary.estimatedDrivingTimeSeconds} kind="duration" />
            <OverviewCard label="实际驾驶时间" metric={summary.actualDrivingTimeSeconds} kind="duration" />
            <OverviewCard label="旅行天数" metric={summary.tripDays} kind="days" />
          </section>

          <TripBreakdownTable rows={rows} sort={sort} onChangeSort={changeSort} />
          <DistributionModule mode={distributionMode} onChange={setDistributionMode} views={distributionViews} />
          <ScoreStatisticsModule title="风景评分" distribution={summary.scenicScoreDistribution} segmentCount={summary.segmentCount} />
          <ScoreStatisticsModule title="驾驶难度" distribution={summary.difficultyScoreDistribution} segmentCount={summary.segmentCount} />

          <RoadComposition allScope={filter.scope === 'all' || (filter.scope === 'year' && !filter.year)} statistics={statistics} currentLabel={filter.scope === 'trip' ? '本次' : '当前范围'} />
          <NamedRoadTable key={`${filter.scope}:${filter.year}:${filter.tripId}`} allScope={filter.scope === 'all' || (filter.scope === 'year' && !filter.year)} statistics={statistics} currentLabel={filter.scope === 'trip' ? '本次' : '当前范围'} />
        </>
      )}
    </section>
  )
}

export default StatisticsDashboard

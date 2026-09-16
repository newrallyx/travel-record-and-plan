import { useMemo } from 'react'
import type { Trip } from '../../types/trip.ts'
import type { ScoreDistribution } from '../../types/tripStatistics.ts'
import type { ScenicScoreBandKey, DifficultyScoreBandKey } from '../../types/roadStatistics.ts'
import { useTripStatistics } from '../../hooks/useTripStatistics.ts'
import { getSingleTripClassificationRows } from '../../utils/roadStatisticsComparison.ts'
import { NamedRoadTable, RoadComposition } from '../statistics/RoadStatisticsPanels.tsx'
import { formatNullableDistance, formatPercentage, MetricValue } from '../statistics/StatisticsPrimitives.tsx'

function CompactScore({ title, distribution }: { title: string; distribution: ScoreDistribution<ScenicScoreBandKey | DifficultyScoreBandKey> }) {
  return <section className="statistics-module roadbook-score-module" aria-label={`${title}分布`}>
    <header className="statistics-module-heading"><div><h3>{title}分布</h3><p>里程加权平均：{distribution.distanceWeightedAverage === null ? '待补全' : `${distribution.distanceWeightedAverage.toFixed(1)} 分`} · 已评分 {distribution.ratedSegmentCount} 段</p></div></header>
    <ul className="roadbook-score-list">
      {[...distribution.bands].reverse().map((band) => <li key={band.key}><span>{band.label}</span><strong>{band.itemCount} 段</strong><span>{formatPercentage(band.distanceShare)}</span></li>)}
      <li className="is-unrated"><span>未评分</span><strong>{distribution.unrated.itemCount} 段</strong><span>—</span></li>
    </ul>
    <p className="statistics-road-note">占已评分里程（{formatNullableDistance(distribution.ratedDistanceMeters)}）；未评分单列。</p>
  </section>
}

export default function TripStatisticsPanel({ trip, trips }: { trip: Trip; trips: readonly Trip[] }) {
  const currentTrips = useMemo(() => [trip], [trip])
  const { statistics, cacheStatus } = useTripStatistics(currentTrips, trips)
  const classificationRows = useMemo(() => getSingleTripClassificationRows(statistics.current), [statistics.current])
  return <details className="roadbook-statistics">
    <summary>本次旅程统计</summary>
    {cacheStatus !== 'ready' && <p className="statistics-road-note">{cacheStatus === 'loading' ? '正在读取道路分析…' : '道路分析暂不可用，里程与评分记录仍可查看。'}</p>}
    <div className="roadbook-statistics-grid">
      <RoadComposition statistics={statistics} compact />
      <section className="statistics-module" aria-label="本次里程与时间分类">
        <header className="statistics-module-heading"><div><h3>本次里程与时间分类</h3></div></header>
        <dl className="roadbook-classification-list">{classificationRows.map((row) => <div key={row.label}>
          <dt>{row.label}</dt><dd><MetricValue metric={row.metric} kind={row.kind} /><span className="roadbook-band-label">{row.bandLabel}</span></dd>
        </div>)}</dl>
      </section>
      <div className="roadbook-score-pair">
        <CompactScore title="风景" distribution={statistics.current.scenicScoreDistribution} />
        <CompactScore title="难度" distribution={statistics.current.difficultyScoreDistribution} />
      </div>
    </div>
    <NamedRoadTable statistics={statistics} compact />
  </details>
}

import { useMemo, useState } from 'react'
import type { Trip } from '../../types/trip.ts'
import type { RouteCacheRecord } from '../../services/routeCacheDb.ts'
import type { NamedRoadComparisonRow } from '../../types/tripStatistics.ts'
import { buildRoadArchive, type TravelRecordTarget } from '../../utils/travelRetrospective.ts'
import { parseIsoDateUtc } from '../../utils/tripStatistics.ts'
import { summarizeRoadStatisticsComparison } from '../../utils/roadStatisticsComparison.ts'
import { presentRoadNames } from '../../utils/roadNamePresentation.ts'
import { NamedRoadTable } from './RoadStatisticsPanels.tsx'
import { formatNullableDistance } from './StatisticsPrimitives.tsx'

export function roadArchiveTitle(road: NamedRoadComparisonRow) {
  const ref = road.routeRef ?? ({ EXPRESSWAY: '无编号高速', NATIONAL_ROAD: '无编号国道', PROVINCIAL_ROAD: '无编号省道' }[road.roadClass])
  return road.roadClass === 'PROVINCIAL_ROAD' || road.routeRef?.startsWith('S')
    ? `${road.provinceName ?? road.provinceCode ?? '省份待确认'} · ${ref}` : ref
}

interface Props {
  trips: readonly Trip[]
  caches: readonly RouteCacheRecord[]
  selectedRoadKey: string | null
  onSelectRoad: (key: string | null) => void
  onNavigate: (target: TravelRecordTarget, photos?: boolean) => void
  loading: boolean
  onOpenFootprint: (key: string) => void
}

function RoadArchivePanel({ trips, caches, selectedRoadKey, onSelectRoad, onNavigate, loading, onOpenFootprint }: Props) {
  const statistics = useMemo(() => summarizeRoadStatisticsComparison(trips.filter(trip => trip.category === 'review'), trips, caches), [trips, caches])
  const archive = useMemo(() => buildRoadArchive(trips, caches), [trips, caches])
  const [year, setYear] = useState('')
  const road = statistics.namedRoads.find(row => row.key === selectedRoadKey)
  const allVisits = selectedRoadKey ? archive.get(selectedRoadKey) ?? [] : []
  const years = [...new Set(allVisits.map(visit => parseIsoDateUtc(visit.date) !== null ? visit.date.slice(0, 4) : '').filter(Boolean))].sort().reverse()
  const selectedYear = years.includes(year) ? year : ''
  const visits = selectedYear ? allVisits.filter(visit => visit.date.startsWith(`${selectedYear}-`)) : allVisits
  const dated = allVisits.map(visit => visit.date).filter(date => parseIsoDateUtc(date) !== null).sort()
  const names = road ? presentRoadNames(road.roadNames, road.routeRef, road.roadClass).summary : ''

  return <div className="travel-retrospective">
    {!road ? <>
      <p className="statistics-road-note">选择道路查看全部复盘记录。省道和省级高速按省份区分；缺失或过期分析不推断道路归属。</p>
      <NamedRoadTable statistics={statistics} allScope defaultExpanded onOpenFootprint={onOpenFootprint} onOpenArchive={key => { setYear(''); onSelectRoad(key) }} />
    </> : <section className="statistics-module" aria-label="道路档案详情">
      <header className="statistics-module-heading">
        <div><h3>{roadArchiveTitle(road)} · 道路档案</h3><p>{names || '暂无道路名称'} · 全部复盘旅程</p></div>
        <div className="retrospective-actions"><button type="button" className="btn-secondary" onClick={() => onOpenFootprint(road.key)}>查看足迹</button><button type="button" className="btn-secondary" onClick={() => onSelectRoad(null)}>‹ 返回道路列表</button></div>
      </header>
      <div className="retrospective-metrics">
        <article><small>已分析累计里程</small><strong>{formatNullableDistance(allVisits.length ? allVisits.reduce((sum, visit) => sum + visit.distanceMeters, 0) : null)}</strong></article>
        <article><small>涉及旅程</small><strong>{new Set(allVisits.map(visit => visit.tripId)).size} 次</strong></article>
        <article><small>关联路段记录</small><strong>{allVisits.length} 条</strong></article>
        <article><small>首次 / 最近记录日期</small><strong className="retrospective-date-range">{dated.length ? `${dated[0]} / ${dated[dated.length - 1]}` : '日期待补全'}</strong></article>
      </div>
      <p className="statistics-road-note">里程含已标注的共线区间，重复经过照常累计，不代表去重道路长度；不同道路的共线里程不能相加作为总行驶里程。评分和照片属于所在路段，不表示只针对这条道路。{loading ? '正在读取道路分析…' : ''}</p>
      <label className="retrospective-year-filter"><span>记录年份</span><select value={selectedYear} onChange={event => setYear(event.target.value)}><option value="">全部年份</option>{years.map(value => <option key={value} value={value}>{value} 年</option>)}</select></label>
      <div className="statistics-table-wrap"><table className="statistics-table road-archive-visits">
        <thead><tr><th>日期 / 旅程</th><th>所在路段</th><th>本道路里程</th><th>路段风景评分</th><th>查看记录</th></tr></thead>
        <tbody>{visits.map(visit => <tr key={`${visit.tripId}:${visit.segmentId}`}>
          <td>{parseIsoDateUtc(visit.date) === null ? '日期待补全' : visit.date}<small className="statistics-route-names">{visit.tripTitle}</small></td>
          <td>{visit.segment.name}<small className="statistics-route-names">{visit.segment.startPoint} → {visit.segment.endPoint}</small></td>
          <td>{formatNullableDistance(visit.distanceMeters)}</td>
          <td>{typeof visit.segment.scenicScore === 'number' && visit.segment.scenicScore >= 1 && visit.segment.scenicScore <= 10 ? `${visit.segment.scenicScore} 分` : '未评分'}</td>
          <td><div className="retrospective-actions"><button type="button" className="btn-secondary" onClick={() => onNavigate(visit)}>地图</button><button type="button" className="btn-secondary" disabled={!visit.segment.photoIds?.length} onClick={() => onNavigate(visit, true)}>相册（{new Set(visit.segment.photoIds ?? []).size}）</button></div></td>
        </tr>)}{!visits.length && <tr><td colSpan={5}>当前范围暂无有效道路记录。</td></tr>}</tbody>
      </table></div>
    </section>}
  </div>
}

export default RoadArchivePanel

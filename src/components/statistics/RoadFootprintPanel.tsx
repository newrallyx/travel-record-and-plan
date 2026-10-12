import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Trip } from '../../types/trip'
import type { NamedRoadComparisonRow } from '../../types/tripStatistics'
import type { RouteCacheRecord } from '../../services/routeCacheDb'
import type { TravelRecordTarget } from '../../utils/travelRetrospective'
import { buildRoadFootprint, FOOTPRINT_COLORS, FOOTPRINT_LABELS, footprintColor } from '../../utils/roadFootprint'
import { parseIsoDateUtc } from '../../utils/tripStatistics'
import { presentRoadNames } from '../../utils/roadNamePresentation'
import { type RoadFootprintLine } from '../map/overviewAggregation'
import { MapResizeController } from '../map/MapControllers'
import { DEFAULT_MAP_CENTER } from '../map/trackUtils'
import { roadArchiveTitle } from './RoadArchivePanel'

function FootprintViewport({ points }: { points: Array<[number, number]> }) {
  const map = useMap()
  useEffect(() => {
    const fit = () => {
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 16, animate: false })
    }
    fit()
    map.on('resize', fit)
    return () => { map.off('resize', fit) }
  }, [map, points])
  return null
}

function FootprintLayer({ lines, title, onSelect }: {
  lines: RoadFootprintLine[]; title: string; onSelect: (line: RoadFootprintLine) => void
}) {
  const map = useMap()
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.2 })
    const group = L.layerGroup().addTo(map)
    for (const line of lines) {
      const tooltip = document.createElement('div')
      const heading = document.createElement('strong')
      heading.textContent = title
      tooltip.append(heading, document.createElement('br'), `经过 ${line.count} 次（双向合计，按路线记录）`,
        document.createElement('br'), '点击查看关联记录')
      L.polyline(line.positions, { renderer, color: footprintColor(line.count), weight: 5, opacity: 0.9 })
        .addTo(group).bindTooltip(tooltip, { sticky: true }).on('click', () => onSelect(line))
    }
    return () => { group.remove(); renderer.remove() }
  }, [map, lines, title, onSelect])
  return null
}

interface Props {
  roadKey: string
  road?: NamedRoadComparisonRow
  trips: readonly Trip[]
  caches: readonly RouteCacheRecord[]
  cacheStatus: 'loading' | 'ready' | 'unavailable'
  onBack: () => void
  onNavigate: (target: TravelRecordTarget) => void
}

export default function RoadFootprintPanel({ roadKey, road, trips, caches, cacheStatus, onBack, onNavigate }: Props) {
  const [year, setYear] = useState('')
  const data = useMemo(() => buildRoadFootprint(trips, caches, roadKey, year), [trips, caches, roadKey, year])
  const [result, setResult] = useState<{ tracks: typeof data.tracks; lines?: RoadFootprintLine[]; error?: boolean }>()
  const [selected, setSelected] = useState<RoadFootprintLine | null>(null)
  useEffect(() => {
    setSelected(null)
    if (!data.tracks.length) return
    let active = true
    let worker: Worker | undefined
    try {
      worker = new Worker(new URL('../map/roadFootprint.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<RoadFootprintLine[]>) => {
        if (active) setResult({ tracks: data.tracks, lines: event.data })
        worker?.terminate()
      }
      worker.onerror = () => {
        if (active) setResult({ tracks: data.tracks, error: true })
        worker?.terminate()
      }
      worker.postMessage({ tracks: data.tracks, passageTracks: data.passageTracks })
    } catch {
      worker?.terminate()
      setResult({ tracks: data.tracks, error: true })
    }
    return () => { active = false; worker?.terminate() }
  }, [data.tracks])
  const current = result?.tracks === data.tracks ? result : undefined
  const lines = current?.lines
  const points = useMemo(() => lines?.flatMap(line => line.positions) ?? [], [lines])
  const roadName = road ? presentRoadNames(road.roadNames, road.routeRef, road.roadClass).summary : ''
  const title = road ? `${roadArchiveTitle(road)}${roadName ? ` · ${roadName}` : ''}` : roadKey
  const selection = lines?.includes(selected!) ? selected : null
  const visibleSourceIds = useMemo(() => new Set(lines?.flatMap(line => line.sourceIds)), [lines])
  const visibleRecords = lines ? data.passageRecords.filter(record => visibleSourceIds.has(record.sourceId)) : data.records
  const records = selection ? visibleRecords.filter(record => selection.sourceIds.includes(record.sourceId)) : visibleRecords
  const busy = cacheStatus === 'loading' || (data.tracks.length > 0 && !current)
  return <section className="statistics-module road-footprint" aria-label="道路足迹">
    <header className="statistics-module-heading">
      <div><h3>{title} · 道路足迹</h3><p>仅显示这条道路已记录的轨迹；按路线记录统计往返次数。</p></div>
      <button type="button" className="btn-secondary" onClick={onBack}>‹ 返回道路列表</button>
    </header>
    <div className="road-footprint-toolbar">
      <label className="retrospective-year-filter"><span>记录年份</span><select value={year} onChange={event => setYear(event.target.value)}>
        <option value="">全部年份</option>{data.years.map(value => <option key={value} value={value}>{value} 年</option>)}
      </select></label>
      <span>可显示记录：{new Set(visibleRecords.map(record => record.tripId)).size} 个旅程 · {visibleRecords.length} 条路段记录</span>
    </div>
    <div className="road-footprint-legend" aria-label="经过次数图例">{FOOTPRINT_LABELS.map((label, i) => <span key={label}><i style={{ background: FOOTPRINT_COLORS[i] }} />{label}</span>)}</div>
    <p className="statistics-road-note">年份按记录日期筛选。轨迹含已标注的共线区间，同一次经过不会因多个道路编号而重复计数。缺失或过期分析不推断道路归属。不确定的重合保留独立线，涉及旅程数不等于经过次数。</p>
    {data.missingGeometry > 0 && <p role="status" className="hint-text">{data.missingGeometry} 个本道路片段缺少有效坐标，暂未绘制。</p>}
    {busy ? <p role="status">正在整理道路足迹…</p>
      : cacheStatus === 'unavailable' ? <p role="status">路线分析缓存暂不可用，无法显示道路足迹。</p>
      : current?.error ? <p role="alert">道路足迹计算失败，请返回后重试。</p>
      : !lines?.length ? <p className="statistics-table-empty">当前范围暂无可显示的道路轨迹。</p>
      : <div className="road-footprint-map">
        <MapContainer
          center={DEFAULT_MAP_CENTER}
          zoom={4}
          zoomSnap={0.25}
          zoomDelta={0.25}
          wheelPxPerZoomLevel={160}
          zoomAnimation={false}
          className="map-container"
        >
          <TileLayer attribution='&copy; <a href="https://www.amap.com/">Amap</a>'
            url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}" subdomains={[1, 2, 3, 4]} />
          <MapResizeController watchKey={`${roadKey}:${year}`} />
          <FootprintViewport points={points} />
          <FootprintLayer lines={lines} title={road ? roadArchiveTitle(road) : roadKey} onSelect={setSelected} />
        </MapContainer>
      </div>}
    <header className="statistics-module-heading road-footprint-record-heading">
      <div><h4>{selection ? `所选位置经过 ${selection.count} 次 · 关联记录` : '关联记录'}</h4><p>点击地图轨迹可筛选；同一条记录中的往返可贡献多次经过。</p></div>
      {selection && <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>显示全部记录</button>}
    </header>
    <div className="statistics-table-wrap"><table className="statistics-table">
      <thead><tr><th>日期 / 旅程</th><th>所在路段</th><th>查看记录</th></tr></thead>
      <tbody>{records.map(record => <tr key={record.sourceId}>
        <td>{parseIsoDateUtc(record.date) === null ? '日期待补全' : record.date}<small className="statistics-route-names">{record.tripTitle}</small></td>
        <td>{record.segmentName}</td><td><button type="button" className="btn-secondary" onClick={() => onNavigate(record)}>查看旅程地图</button></td>
      </tr>)}{!records.length && <tr><td colSpan={3}>当前范围暂无可显示的关联记录。</td></tr>}</tbody>
    </table></div>
  </section>
}

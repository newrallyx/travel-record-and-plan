import { useMemo, useState } from 'react'
import { ROAD_CLASS_COLORS, ROAD_CLASS_LABELS } from '../../config/roadStatistics.ts'
import type { RoadStatisticsComparison, StatisticsCompleteness } from '../../types/tripStatistics.ts'
import { selectNamedRoadRows } from '../../utils/roadStatisticsComparison.ts'
import { formatNullableDistance, formatPercentage } from './StatisticsPrimitives.tsx'
import { presentRoadNames } from '../../utils/roadNamePresentation.ts'
import { provinceNameFromCode } from '../../utils/province.ts'

function RoadCoverage({ label, completeness }: { label: string; completeness: StatisticsCompleteness }) {
  return <span>{label}：完整 {completeness.completeItemCount} 段 · 部分 {completeness.partialItemCount} 段 · 待分析 {completeness.missingItemCount} 段 · 已过期 {completeness.staleItemCount} 段</span>
}

export function RoadComposition({ statistics, compact = false, currentLabel = '本次', allScope = false }: {
  statistics: RoadStatisticsComparison; compact?: boolean; currentLabel?: string; allScope?: boolean
}) {
  const showHistory = !compact && !allScope
  return (
    <section className="statistics-module" aria-label={`${currentLabel}道路类型组成`}>
      <header className="statistics-module-heading">
        <div><h3>{compact ? '本次道路组成' : '道路类型组成'}</h3>
          {!compact && <p>{allScope ? '当前统计全部复盘旅程。' : '当前范围随筛选变化，历史累计包含当前已复盘旅程。'}道路里程来自规划路线分析，占比以各自规划总里程为分母。</p>}
        </div>
      </header>
      <div className="statistics-road-bar" aria-hidden="true">
        {statistics.composition.map((row) => <span key={row.roadClass} style={{ width: `${(row.currentDistanceShare ?? 0) * 100}%`, background: ROAD_CLASS_COLORS[row.roadClass] }} />)}
      </div>
      <div className="statistics-table-wrap">
        <table className={`statistics-table statistics-road-composition${compact ? ' is-compact' : ''}`}>
          <thead><tr><th scope="col">道路类型</th><th scope="col">{allScope ? '累计' : currentLabel}里程</th><th scope="col">{allScope ? '里程' : currentLabel}占比</th>
            {showHistory && <><th scope="col">历史累计里程</th><th scope="col">累计占比</th></>}
          </tr></thead>
          <tbody>
            {statistics.composition.map((row) => <tr key={row.roadClass}>
              <th scope="row"><span className="statistics-road-dot" style={{ background: ROAD_CLASS_COLORS[row.roadClass] }} />{row.label}</th>
              <td>{formatNullableDistance(row.currentDistanceMeters)}</td><td>{formatPercentage(row.currentDistanceShare)}</td>
              {showHistory && <><td>{formatNullableDistance(row.historicalDistanceMeters)}</td><td>{formatPercentage(row.historicalDistanceShare)}</td></>}
            </tr>)}
            <tr className="statistics-pending-row">
              <th scope="row">未分类 / 待确认</th><td>{formatNullableDistance(statistics.unclassified.currentDistanceMeters)}</td><td>{formatPercentage(statistics.unclassified.currentDistanceShare)}</td>
              {showHistory && <><td>{formatNullableDistance(statistics.unclassified.historicalDistanceMeters)}</td><td>{formatPercentage(statistics.unclassified.historicalDistanceShare)}</td></>}
            </tr>
          </tbody>
        </table>
      </div>
       <p className="statistics-road-note">其他道路含县、乡、村道与城市道路。未知、过期、未分析及不适用路线里程不计入四类；已有有效骑行道路分析会进入对应类型。</p>
      <div className="statistics-road-coverage">
        <RoadCoverage label={currentLabel} completeness={statistics.current.dataCompleteness.roadAnalysis} />
        {showHistory && <RoadCoverage label="全部复盘" completeness={statistics.historical.dataCompleteness.roadAnalysis} />}
      </div>
    </section>
  )
}

export function NamedRoadTable({ statistics, compact = false, currentLabel = '本次', allScope = false }: {
  statistics: RoadStatisticsComparison; compact?: boolean; currentLabel?: string; allScope?: boolean
}) {
  const [showOtherHistory, setShowOtherHistory] = useState(false)
  const showHistory = !allScope
  const distanceLabel = allScope ? '累计' : currentLabel
  const formatKm = (value: number | null) => value === null ? '待补全' : (value / 1000).toFixed(1)
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [roadClass, setRoadClass] = useState<'ALL' | 'EXPRESSWAY' | 'NATIONAL_ROAD' | 'PROVINCIAL_ROAD'>('ALL')
  const [province, setProvince] = useState('ALL')
  const provinceOptions = useMemo(() => Array.from(new Map(
    statistics.namedRoads
      .filter((row) => row.provinceStatus === 'confirmed' && row.provinceCode)
      .map((row) => [row.provinceCode as string, row.provinceName ?? provinceNameFromCode(row.provinceCode) ?? row.provinceCode as string]),
  ).entries()).sort((left, right) => left[1].localeCompare(right[1], 'zh-CN')), [statistics.namedRoads])
  const rows = useMemo(() => selectNamedRoadRows(statistics.namedRoads, {
    query,
    direction,
    currentOnly: compact || (!allScope && !showOtherHistory),
    roadClass,
    province,
  }), [statistics.namedRoads, query, direction, compact, roadClass, province, allScope, showOtherHistory])

  const isProvinceSensitiveRow = (row: typeof statistics.namedRoads[number]) => (
    row.roadClass === 'PROVINCIAL_ROAD' || (row.roadClass === 'EXPRESSWAY' && row.routeRef?.startsWith('S'))
  )
  const formatIdentity = (row: typeof statistics.namedRoads[number]) => {
    const ref = row.routeRef ?? (row.roadClass === 'PROVINCIAL_ROAD' ? '无编号省道' : row.roadClass === 'EXPRESSWAY' ? '无编号高速' : '无编号国道')
    if (!isProvinceSensitiveRow(row)) return ref
    const provinceText = row.provinceStatus === 'confirmed'
      ? row.provinceName ?? provinceNameFromCode(row.provinceCode) ?? row.provinceCode ?? '省份待确认'
      : '省份待确认'
    return `${provinceText} · ${ref}`
  }
  const formatRoadType = (row: typeof statistics.namedRoads[number]) => ROAD_CLASS_LABELS[row.roadClass]
  return (
    <section className="statistics-module" aria-label={compact ? '本次与历史命名路线对照' : '命名路线统计'}>
      <header className="statistics-module-heading">
        <div><h3>{compact ? '高速 / 国道 / 省道 · 本次与历史' : '命名路线统计'}</h3>
           <p>{compact ? '列出本次经过的高速、国道和省道。' : '高速、国道及省道使用同一身份标识；涉及旅程数按全部复盘旅程去重，同一旅程多次经过只计 1 个，里程照常累计。'}{allScope ? '当前统计全部复盘旅程，累计里程已包含所有复盘记录。' : '历史累计包含当前选中的已复盘旅程。'}省份待确认和无编号省道独立汇总。</p>
         </div>
           <div className="statistics-road-filters">
             <label className="statistics-road-search"><span>搜索道路/省份/编号</span>
               <input type="search" value={query} placeholder="例如 陕西、S101、G65" onChange={(event) => setQuery(event.target.value)} />
             </label>
             <label><span>道路类型</span><select value={roadClass} onChange={(event) => setRoadClass(event.target.value as typeof roadClass)}>
               <option value="ALL">全部类型</option><option value="EXPRESSWAY">高速公路</option><option value="NATIONAL_ROAD">国道</option><option value="PROVINCIAL_ROAD">省道</option>
             </select></label>
             <label><span>省份</span><select value={province} onChange={(event) => setProvince(event.target.value)}>
               <option value="ALL">全部省份</option><option value="pending">省份待确认</option>
               {provinceOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
             </select></label>
             {!compact && !allScope && <label className="statistics-history-toggle"><input type="checkbox" checked={showOtherHistory} onChange={(event) => setShowOtherHistory(event.target.checked)} />显示其他历史道路</label>}
           </div>
      </header>
      <div className={`statistics-table-wrap${compact ? ' statistics-compact-route-scroll' : ''}`}>
        <table className="statistics-table statistics-named-road-table">
           <thead><tr><th scope="col">道路身份 / 名称</th><th scope="col">类型</th>
            <th scope="col" aria-sort={direction === 'asc' ? 'ascending' : 'descending'}><button className="statistics-sort-button" type="button" onClick={() => setDirection((value) => value === 'asc' ? 'desc' : 'asc')}>{distanceLabel}里程（公里） <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span></button></th>
            {!compact && !allScope && <th scope="col">{currentLabel}占比</th>}
            {showHistory && <th scope="col">历史累计里程（公里）</th>}
            {!compact && <th scope="col">{allScope ? '' : '历史'}涉及旅程数（个）</th>}
            {!compact && allScope && <th scope="col">里程占比</th>}
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const names = presentRoadNames(row.roadNames, row.routeRef)
              return <tr key={row.key}>
                <th scope="row"><span>{formatIdentity(row)}</span>
                  {names.summary && <small className="statistics-route-names statistics-route-summary" title={names.summary}>{names.summary}</small>}
                  {row.roadNames.length > 0 && <details className="statistics-road-name-details">
                    <summary>历史记录名称（{row.roadNames.length}）{names.conflicts.length > 0 && <span className="statistics-name-conflict"> · 含其他编号</span>}</summary>
                    <div className="statistics-route-names">{row.roadNames.join('、')}</div>
                    {names.conflicts.length > 0 && <p className="statistics-name-conflict">以下名称含其他编号，归属待核对：{names.conflicts.join('、')}</p>}
                  </details>}
                  {!row.roadNames.length && row.routeRefs?.length ? <small className="statistics-route-names">待确认编号：{row.routeRefs.join('、')}</small> : null}
                </th>
                <td>{formatRoadType(row)}</td>
                <td>{formatKm(row.currentDistanceMeters)}</td>
                {!compact && !allScope && <td>{formatPercentage(row.currentDistanceShare)}</td>}
                {showHistory && <td>{formatKm(row.historicalDistanceMeters)}</td>}
                {!compact && <td>{row.historicalTripCount ?? '待补全'}</td>}
                {!compact && allScope && <td>{formatPercentage(row.currentDistanceShare)}</td>}
              </tr>
            })}
            {rows.length === 0 && <tr><td colSpan={compact ? (showHistory ? 4 : 3) : (showHistory ? 6 : 5)} className="statistics-table-empty">{query || roadClass !== 'ALL' || province !== 'ALL' ? '没有匹配当前筛选的路线' : '当前范围暂无有效的高速、国道或省道分析记录'}</td></tr>}
          </tbody>
        </table>
      </div>
       <p className="statistics-road-note">道路里程来自规划路线分析。按{distanceLabel}里程排序，占比的分母为{currentLabel}规划总里程（{formatNullableDistance(statistics.current.plannedDistanceMeters.value)}），随年份或旅程选择变化，不受搜索、类型或省份筛选影响。省份待确认不会合入任何已知省份。</p>
    </section>
  )
}

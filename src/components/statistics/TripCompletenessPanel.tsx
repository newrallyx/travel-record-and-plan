import { useMemo, useState } from 'react'
import type { Trip } from '../../types/trip.ts'
import type { RouteCacheRecord } from '../../services/routeCacheDb.ts'
import type { TravelRecordTarget } from '../../utils/travelRetrospective.ts'
import { buildTripCompletenessItems } from '../../utils/tripCompleteness.ts'

export default function TripCompletenessPanel({ trips, caches, cacheReady, onEdit, onAnalyze }: {
  trips: readonly Trip[]; caches: readonly RouteCacheRecord[]; cacheReady: boolean
  onEdit: (target: TravelRecordTarget) => void; onAnalyze: (target: TravelRecordTarget) => void
}) {
  const [showOptional, setShowOptional] = useState(false)
  const [limit, setLimit] = useState(30)
  const items = useMemo(() => buildTripCompletenessItems(trips, caches, cacheReady), [trips, caches, cacheReady])
  const actionable = items.filter(item => item.required.length || item.analysis)
  const visible = showOptional ? items : actionable
  return <details className="statistics-module trip-completeness-panel">
    <summary>待处理清单 · {actionable.length} 条记录待处理 · {items.filter(item => item.optional.length).length} 条可选补充</summary>
    <p className="statistics-road-note">跟随当前统计范围。实际记录与评分允许留空，不会自动填成零。点击“查看道路分析”后核对对象，再开始分析。</p>
    {!cacheReady && <p role="status" className="statistics-road-note">道路缓存尚未就绪，暂不判断道路分析完整度。</p>}
    <label><input type="checkbox" checked={showOptional} onChange={event => { setShowOptional(event.target.checked); setLimit(30) }} />显示可选的实际记录与评分</label>
    <div className="statistics-table-wrap"><table className="statistics-table">
      <thead><tr><th>旅程 / 日期</th><th>路段</th><th>待处理项目</th><th>操作</th></tr></thead>
      <tbody>{visible.slice(0, limit).map(item => <tr key={`${item.tripId}:${item.dayId}:${item.segmentId}`}>
        <td>{item.tripTitle}<small className="statistics-route-names">{item.date || '日期待核对'}</small></td>
        <td>{item.segmentName}</td><td>{[...item.required, ...(item.analysis ? [item.analysis] : [])].join('、') || '无必填项目'}
          {showOptional && item.optional.length > 0 && <small className="statistics-route-names">可选：{item.optional.join('、')}</small>}</td>
        <td><div className="retrospective-actions"><button type="button" className="btn-secondary" onClick={() => onEdit(item)}>编辑记录</button>
          {item.analysis && <button type="button" className="btn-secondary" onClick={() => onAnalyze(item)}>查看道路分析</button>}</div></td>
      </tr>)}{visible.length === 0 && <tr><td colSpan={4}>当前范围没有待处理项目。{!showOptional && items.length > 0 ? '可显示可选补充项目。' : ''}</td></tr>}</tbody>
    </table></div>
    {visible.length > limit && <button type="button" className="btn-secondary" onClick={() => setLimit(value => value + 30)}>显示更多（还有 {visible.length - limit} 条）</button>}
  </details>
}

import type { AnnualReview } from './travelRetrospective.ts'
import type { RouteSegment } from '../types/trip.ts'
import type { NumericStatisticsTotal } from '../types/tripStatistics.ts'

export const escapeReportText = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
const km = (value: number | null) => value === null ? '待补全' : `${(value / 1000).toFixed(1)} 公里`
function metricText(metric: NumericStatisticsTotal) {
  return `${metric.completeness.status === 'partial' ? '已记录 ' : ''}${km(metric.value)}`
}

/** 无底图的本地路线示意图，保留分离的路段，绝不连接不同旅程端点。 */
export function buildAnnualRouteSvg(segments: readonly RouteSegment[]) {
  const lines = segments.map(segment => (segment.points ?? []).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180)).filter(points => points.length >= 2)
  if (!lines.length) return '<p>暂无可显示的已保存路线。</p>'
  const project = (point: { lat: number; lon: number }) => [point.lon, Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, point.lat)) * Math.PI / 360)) * 180 / Math.PI]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const line of lines) for (const point of line) {
    const [x, y] = project(point)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const scale = Math.min(760 / Math.max(maxX - minX, 0.001), 380 / Math.max(maxY - minY, 0.001))
  const offsetX = (800 - (maxX - minX) * scale) / 2, offsetY = (420 - (maxY - minY) * scale) / 2
  const paths = lines.map((line, index) => {
    const step = Math.max(1, Math.ceil(line.length / 1500))
    const points = line.filter((_, i) => i % step === 0 || i === line.length - 1).map(point => {
      const [x, y] = project(point)
      return `${((x - minX) * scale + offsetX).toFixed(2)},${((maxY - y) * scale + offsetY).toFixed(2)}`
    }).join(' ')
    return `<polyline fill="none" stroke="hsl(${(index * 47) % 360},60%,42%)" stroke-width="2" stroke-linecap="round" points="${points}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" role="img" aria-label="全年已保存路线示意图"><rect width="800" height="420" fill="#f1f5f9"/>${paths}<text x="765" y="28" fill="#475569">北 ↑</text></svg>`
}

export interface AnnualReportPhoto { filename: string; caption: string; dataUrl?: string }

export function buildAnnualReviewHtml(review: AnnualReview, photos: readonly AnnualReportPhoto[] = []) {
  const text = escapeReportText
  const longest = (kind: 'Planned' | 'Actual') => {
    const row = review[`longest${kind}`]
    return row ? `${text(row.title)} · ${km(row[kind === 'Planned' ? 'plannedDistanceMeters' : 'actualDistanceMeters'].value)}` : '暂无里程完整的旅程'
  }
  const roadName = (road: AnnualReview['roads'][number]) => text(`${road.provinceName ?? road.provinceCode ?? (road.roadClass === 'PROVINCIAL_ROAD' || road.routeRef?.startsWith('S') ? '省份待确认' : '')} ${road.routeRef ?? '无编号道路'}`.trim())
  const photoHtml = photos.map(photo => `<figure>${photo.dataUrl && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl)
    ? `<img src="${photo.dataUrl}" alt="${text(photo.filename)}"/>` : '<p>缩略图不可用</p>'}<figcaption>${text(photo.caption)} · ${text(photo.filename)}</figcaption></figure>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(review.year)} 年度旅行回顾</title><style>
body{margin:0;background:#f1f5f9;color:#172b42;font:16px/1.7 "Microsoft YaHei",sans-serif}main{max-width:1000px;margin:auto;padding:32px}header{padding:28px;border-radius:20px;background:#172b42;color:white}h1{margin:0;font-size:32px}h2{margin:0 0 16px}section{background:white;border-radius:16px;padding:24px;margin-top:20px}.metrics,.photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.metrics p{margin:0}.metrics strong{display:block;font-size:24px}small,.note{color:#58697b}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #e2e8f0}figure{margin:0}img{width:100%;height:220px;object-fit:contain;background:#f1f5f9}svg{width:100%;height:auto}button{margin:16px 0;padding:8px 18px}@media(max-width:600px){main{padding:12px}section{padding:16px}table{font-size:13px}}@media print{body{background:white}main{padding:0}button{display:none}section{break-inside:avoid;border:1px solid #ddd}header{background:white;color:#172b42;border:1px solid #ddd}}
</style></head><body><main><header><h1>${text(review.year)} 年度旅行回顾</h1><p>只统计复盘旅程，跨年旅程整体归入开始年份。</p></header>
<section class="metrics"><p>旅程<strong>${review.summary.tripCount} 次</strong></p><p>路段<strong>${review.summary.segmentCount} 条</strong></p><p>规划里程<strong>${metricText(review.summary.plannedDistanceMeters)}</strong></p><p>实际里程<strong>${metricText(review.summary.actualDistanceMeters)}</strong></p></section>
<section><h2>全年路线</h2>${buildAnnualRouteSvg(review.mapSegments)}<p class="note">路线示意图不含地理底图。已保存 ${review.mapSegments.length} 条路段；${review.missingMapSegmentCount} 条缺少匹配的路线，未推测补画。</p></section>
<section><h2>最长旅程</h2><p>按完整规划里程：${longest('Planned')}</p><p>按完整实际里程：${longest('Actual')}</p><p class="note">仅在对应里程记录完整的旅程中比较。</p></section>
<section><h2>常走道路</h2><p class="note">按涉及旅程数排序，同一旅程重复经过只计一个旅程，里程照常累计。里程来自有效规划路线分析。</p><table><thead><tr><th>道路</th><th>涉及旅程</th><th>已分析里程</th></tr></thead><tbody>${review.roads.map(road => `<tr><td>${roadName(road)}</td><td>${road.historicalTripCount ?? '待补全'}</td><td>${km(road.currentDistanceMeters)}</td></tr>`).join('') || '<tr><td colspan="3">暂无有效道路分析。</td></tr>'}</tbody></table></section>
<section><h2>高评分路段</h2><p class="note">风景评分至少 7 分，最多列出 5 条。</p>${review.scenicSegments.map(item => `<p><strong>${text(item.segment.name)} · ${item.segment.scenicScore} 分</strong><br>${text(item.tripTitle)} · ${text(item.date)} · ${text(item.segment.startPoint)} → ${text(item.segment.endPoint)}</p>`).join('') || '<p>暂无达到条件的已评分路段。</p>'}</section>
<section><h2>精选照片</h2><div class="photos">${photoHtml || '<p>未选择精选照片。</p>'}</div></section>
<section><h2>全年旅程</h2>${review.trips.map(trip => `<p><strong>${text(trip.title)}</strong> · ${text(trip.startDate)} ～ ${text(trip.endDate)}</p>`).join('') || '<p>该年没有复盘旅程。</p>'}</section>
<p class="note">规划与实际分别统计；“已记录”表示部分合计，缺失数据不作为零。道路分析完整 ${review.summary.dataCompleteness.roadAnalysis.completeItemCount} 段、部分 ${review.summary.dataCompleteness.roadAnalysis.partialItemCount} 段、待分析 ${review.summary.dataCompleteness.roadAnalysis.missingItemCount} 段、过期 ${review.summary.dataCompleteness.roadAnalysis.staleItemCount} 段。精选照片嵌入本地缩略图，原图不包含在报告中。</p>
</main></body></html>`
}

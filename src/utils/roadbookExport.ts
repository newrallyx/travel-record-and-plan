import type { Trip, RouteSegment, TripCategory } from '../types/trip.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import type { NumericStatisticsTotal } from '../types/tripStatistics.ts'
import { escapeReportText } from './annualReviewExport.ts'
import { buildRoadbookMapModel, buildRoadbookMapSvg, type RoadbookMapAsset } from './roadbookMapExport.ts'
import { summarizeSingleTripStatistics } from './tripStatistics.ts'
import { formatDistance, getTrackDistanceMeters } from './distance.ts'
import { formatDurationSeconds, formatDurationSummary, formatSegmentEstimatedDuration, summarizeEstimatedDurations } from './durations.ts'
import { formatSegmentEstimatedToll, formatTollSummary, summarizeEstimatedTolls } from './tolls.ts'
import { formatSegmentActualDistance, formatSegmentActualDuration, formatSegmentActualToll } from './reviewFacts.ts'
import { getReviewTagLabel } from './reviewTags.ts'
import { ROAD_CLASS_LABELS } from '../config/roadStatistics.ts'

export interface RoadbookReportPhoto { id: string; segmentId: string; filename: string; note?: string; dataUrl?: string }
const text = escapeReportText
const reportDistance = (meters: number) => meters === 0 ? '0.0 公里' : formatDistance(meters)
const image = (photo?: RoadbookReportPhoto) => photo?.dataUrl && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl)
  ? `<img src="${photo.dataUrl}" alt="${text(photo.filename)}">` : '<p class="muted">照片缩略图不可用</p>'
const metric = (value: NumericStatisticsTotal, formatter: (value: number) => string) => value.value === null ? '待补全'
  : `${value.completeness.status === 'partial' ? '已记录 ' : ''}${formatter(value.value)}`
export const createRoadbookFilename = (title: string, extension: 'html' | 'pdf', category?: TripCategory) => `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || '旅行'}-${category === 'plan' ? '规划路书' : '路书'}.${extension}`

/** 所有图片及底图快照内嵌，文本转义；只导出已有路线，不重新规划。 */
export function buildRoadbookHtml(trip: Trip, caches: readonly RouteCacheRecord[], photos: readonly RoadbookReportPhoto[] = [], cover?: RoadbookReportPhoto, mapAssets: ReadonlyMap<string, RoadbookMapAsset> = new Map()) {
  const segments = trip.days.flatMap(day => day.routeSegments)
  const isPlan = trip.category === 'plan'
  const sortedDays = [...trip.days].sort((a, b) => a.date.localeCompare(b.date))
  const overview = buildRoadbookMapModel(segments, caches)
  const summary = summarizeSingleTripStatistics(trip, caches)
  const renderSegment = (segment: RouteSegment) => {
    const actual = [formatSegmentActualDistance(segment), formatSegmentActualDuration(segment), formatSegmentActualToll(segment)].filter(Boolean)
    const ownPhotos = photos.filter(photo => photo.segmentId === segment.id && segment.photoIds?.includes(photo.id))
    return `<article><h3>${text(segment.name)}</h3><p>${text(segment.startPoint)} → ${text(segment.endPoint)}</p>
      ${segment.waypoints?.length || segment.viaPointsText ? `<p>途经：${text(segment.waypoints?.length ? segment.waypoints.map(point => point.name).join(' → ') : segment.viaPointsText ?? '')}</p>` : ''}
      <p class="muted">规划里程 ${text(formatDistance(getTrackDistanceMeters(segment)))} · 预计 ${text(formatSegmentEstimatedDuration(segment))} · 预估过路费 ${text(formatSegmentEstimatedToll(segment))}</p>
      ${isPlan ? `<p class="muted">${segment.routeType === 'CYCLING' ? '骑行' : `驾车 · ${text(({ SPEED_FIRST: '速度优先', HIGHWAY_FIRST: '高速优先', AVOID_TOLL: '避免收费' })[segment.preference])}`}</p>` : ''}
      ${!isPlan && actual.length ? `<p>实际记录：${text(actual.join(' · '))}</p>` : ''}
      ${!isPlan ? `<p class="muted">风景评分 ${segment.scenicScore ?? '未评分'} · 难度评分 ${segment.difficultyScore ?? '未评分'}${segment.reviewFacts?.tags?.length ? ` · ${text(segment.reviewFacts.tags.map(getReviewTagLabel).join('、'))}` : ''}</p>` : ''}
      ${segment.note ? `<p class="note">${text(segment.note)}</p>` : ''}
      ${ownPhotos.length ? `<div class="photos">${ownPhotos.map(photo => `<figure>${image(photo)}<figcaption>${text(photo.filename)}${photo.note ? `<br>${text(photo.note)}` : ''}</figcaption></figure>`).join('')}</div>` : ''}</article>`
  }
  const planningSummary = isPlan ? `<section><h2>逐日规划汇总</h2><table><thead><tr><th>日期</th><th>路段数</th><th>规划里程</th><th>预计路线用时</th><th>预估过路费</th></tr></thead><tbody>${sortedDays.map(day => {
    const daySummary = summarizeSingleTripStatistics({ ...trip, days: [day] }, caches)
    return `<tr><td>${text(day.date)}</td><td>${day.routeSegments.length}</td><td>${metric(daySummary.plannedDistanceMeters, reportDistance)}</td><td>${text(formatDurationSummary(summarizeEstimatedDurations(day.routeSegments)))}</td><td>${text(formatTollSummary(summarizeEstimatedTolls(day.routeSegments)))}</td></tr>`
  }).join('')}</tbody></table><p class="muted">本路书为规划快照。预计用时仅为路线用时，不含游览、休息和住宿；未计算的数据不计为零，部分汇总仅覆盖已记录路段。</p></section>` : ''
  const days = sortedDays.map((day, index) => {
    const model = buildRoadbookMapModel(day.routeSegments, caches)
    return `<section class="day"><h2>第 ${index + 1} 天 · ${text(day.date)}</h2>${buildRoadbookMapSvg(model, mapAssets.get(`day:${day.id}`))}
      ${day.routeSegments.map(renderSegment).join('') || `<p>这一天没有${isPlan ? '规划' : '记录'}路段。</p>`}</section>`
  }).join('')
  const roadRows = summary.roadClassDistance.analyzedDistanceMeters === null ? '' : summary.roadClassDistance.entries.map(entry => `<tr><td>${text(ROAD_CLASS_LABELS[entry.roadClass])}</td><td>${reportDistance(entry.distanceMeters)}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${text(trip.title)} · 路书</title><style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;background:#edf2f7;color:#1e293b;font:15px/1.7 "Microsoft YaHei","Noto Sans CJK SC",sans-serif}main{max-width:920px;margin:auto;padding:24px}header,section{background:white;padding:28px;margin-bottom:24px;border-radius:16px}h1{font-size:34px;line-height:1.35}h2{font-size:24px}h3{font-size:18px;margin:0}p,figcaption{overflow-wrap:anywhere}.cover img{height:360px}.cover{border-top:8px solid #475569}.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.metrics p{margin:0;border:1px solid #e2e8f0;padding:12px}.metrics strong{display:block;font-size:22px}.muted,figcaption{color:#64748b}.note{white-space:pre-wrap}svg{width:100%;height:auto;max-height:300px}article{border-top:1px solid #e2e8f0;padding:18px 0}.photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0;break-inside:avoid}img{width:100%;height:200px;object-fit:contain;background:#f1f5f9}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}@media(max-width:600px){main{padding:12px}header,section{padding:16px}.photos{grid-template-columns:1fr}}@media print{body{background:white;font-size:11pt}main{max-width:none;padding:0}header,section{padding:0;border-radius:0}.cover{break-after:page;border:0}.day{break-before:page}h2,h3{break-after:avoid}svg,.metrics,tr{break-inside:avoid}img{height:48mm}.cover img{height:90mm}}
.export-map{break-inside:avoid}.export-map svg{max-height:none;display:block;border:1px solid #dbe3ec;border-radius:6px}.export-map-legend{display:flex;flex-wrap:wrap;gap:8px 20px;padding:12px 0;font-size:13px}.export-map-legend span{display:inline-flex;align-items:center;gap:6px}.export-map-legend i{display:inline-block;width:20px;height:4px;border-radius:2px}.export-map>.muted{font-size:12px}
</style></head><body><main><header class="cover"><p>旅行路书 · ${trip.category === 'plan' ? '规划' : '复盘'}</p><h1>${text(trip.title)}</h1><p>${text(trip.startDate)} ～ ${text(trip.endDate)} · ${trip.days.length} 天 · ${segments.length} 条路段</p>${cover ? image(cover) : ''}
<div class="metrics"><p>规划里程<strong>${metric(summary.plannedDistanceMeters, reportDistance)}</strong></p><p>预计驾车用时<strong>${metric(summary.estimatedDrivingTimeSeconds, formatDurationSeconds)}</strong></p>${!isPlan ? `<p>实际里程<strong>${metric(summary.actualDistanceMeters, reportDistance)}</strong></p><p>实际驾车用时<strong>${metric(summary.actualDrivingTimeSeconds, formatDurationSeconds)}</strong></p>` : ''}</div><p>预估过路费：${text(formatTollSummary(summarizeEstimatedTolls(segments)))}</p></header>
${planningSummary}
<section><h2>旅程路线总览</h2>${buildRoadbookMapSvg(overview, mapAssets.get('trip'))}</section>
${days}<section><h2>道路统计</h2><table><thead><tr><th>道路类别</th><th>已分析里程</th></tr></thead><tbody>${roadRows || '<tr><td colspan="2">暂无有效道路分析。</td></tr>'}</tbody></table><p class="muted">道路分析完整 ${summary.dataCompleteness.roadAnalysis.completeItemCount} 段，部分 ${summary.dataCompleteness.roadAnalysis.partialItemCount} 段，待分析 ${summary.dataCompleteness.roadAnalysis.missingItemCount} 段，过期 ${summary.dataCompleteness.roadAnalysis.staleItemCount} 段。规划与实际分别统计，缺失数据不作为零。</p></section>
${!isPlan && trip.travelogue?.trim() ? `<section><h2>游记</h2><div class="note">${text(trip.travelogue)}</div></section>` : ''}<p class="muted">${isPlan ? '本路书使用导出时已保存的规划数据。' : `精选照片内嵌缩略图，未包含原图或本地目录。共选 ${photos.length} 张照片。`}HTML 可离线打开，并通过浏览器打印保存为 PDF。</p></main></body></html>`
}

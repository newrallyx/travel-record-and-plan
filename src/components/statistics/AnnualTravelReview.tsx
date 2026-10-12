import { useMemo, useState } from 'react'
import type { Trip } from '../../types/trip.ts'
import type { RouteCacheRecord } from '../../services/routeCacheDb.ts'
import { buildAnnualReview, getAnnualPhotoCandidates, getAnnualReviewYears, selectAnnualPhotoDefaults, type TravelRecordTarget } from '../../utils/travelRetrospective.ts'
import { buildAnnualReviewHtml, type AnnualReportPhoto } from '../../utils/annualReviewExport.ts'
import { useRoadbookLibraryPhotos } from '../../hooks/useRoadbookPhotos.ts'
import { loadPhotoThumbnail } from '../../services/photoThumbnailLoadQueue.ts'
import RoadbookMap from '../roadbook/RoadbookMap.tsx'
import SegmentPhotoThumbnail from '../SegmentPhotoThumbnail.tsx'
import { OverviewCard, formatNullableDistance } from './StatisticsPrimitives.tsx'
import { roadArchiveTitle } from './RoadArchivePanel.tsx'

interface Props {
  trips: readonly Trip[]
  caches: readonly RouteCacheRecord[]
  onNavigate: (target: TravelRecordTarget, photos?: boolean) => void
  onOpenRoad: (key: string) => void
  cacheStatus: 'loading' | 'ready' | 'unavailable'
}

const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('缩略图读取失败'))
  reader.readAsDataURL(blob)
})

function AnnualTravelReview({ trips, caches, onNavigate, onOpenRoad, cacheStatus }: Props) {
  const years = useMemo(() => getAnnualReviewYears(trips), [trips])
  const [requestedYear, setRequestedYear] = useState('')
  const year = years.includes(requestedYear) ? requestedYear : years[0] ?? ''
  const review = useMemo(() => buildAnnualReview(trips, caches, year), [trips, caches, year])
  const { photosByTrip, desktopAvailable, isLoading: photosLoading, loadError } = useRoadbookLibraryPhotos(review.trips)
  const candidates = useMemo(() => getAnnualPhotoCandidates(review.trips, [...photosByTrip.values()].flat()), [review.trips, photosByTrip])
  const [photoSelectionByYear, setPhotoSelectionByYear] = useState<Record<string, string[]>>({})
  const selectedIds = photoSelectionByYear[year] ?? selectAnnualPhotoDefaults(candidates)
  const selectedPhotos = candidates.filter(candidate => selectedIds.includes(candidate.photo.id))
  const [choosingPhotos, setChoosingPhotos] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const referencedPhotoCount = new Set(review.trips.flatMap(trip => trip.days.flatMap(day => day.routeSegments.flatMap(segment => segment.photoIds ?? [])))).size

  const togglePhoto = (id: string) => {
    setPhotoSelectionByYear(current => {
      const currentIds = current[year] ?? selectAnnualPhotoDefaults(candidates)
      return { ...current, [year]: currentIds.includes(id) ? currentIds.filter(value => value !== id)
        : currentIds.length < 12 ? [...currentIds, id] : currentIds }
    })
  }
  const exportReport = async () => {
    setExporting(true)
    setExportMessage('正在整理报告和精选照片…')
    try {
      const results = await Promise.allSettled(selectedPhotos.map(async item => {
        const asset = await loadPhotoThumbnail(item.photo.id)
        return { filename: item.photo.originalFilename, caption: item.trip.title,
          dataUrl: asset ? await blobDataUrl(asset.blob) : undefined } satisfies AnnualReportPhoto
      }))
      const photos = results.map((result, index) => result.status === 'fulfilled' ? result.value
        : { filename: selectedPhotos[index].photo.originalFilename, caption: selectedPhotos[index].trip.title })
      const failedPhotos = photos.filter(photo => !('dataUrl' in photo) || !photo.dataUrl).length
      const html = buildAnnualReviewHtml(review, photos)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${year}-年度旅行回顾.html`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportMessage(`已生成 ${year} 年报告，可离线打开。${failedPhotos ? `${failedPhotos} 张缩略图不可用，已保留照片说明。` : ''}`)
    } catch (error) {
      setExportMessage(`报告导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  if (!year) return <div className="statistics-empty-state"><strong>暂无可生成年度回顾的复盘旅程</strong><span>请先记录有效的旅程开始日期。</span></div>

  return <div className="travel-retrospective annual-travel-review">
    <section className="statistics-module annual-review-heading">
      <header className="statistics-module-heading"><div><h3>{year} · 年度旅行回顾</h3><p>跨年旅程整体归入开始年份，只使用已复盘记录。</p></div>
        <div className="retrospective-actions"><label className="retrospective-year-filter"><span>年份</span><select aria-label="年度回顾年份" value={year} disabled={exporting} onChange={event => { setRequestedYear(event.target.value); setExportMessage(''); setChoosingPhotos(false) }}>{years.map(value => <option key={value} value={value}>{value} 年</option>)}</select></label>
        <button type="button" className="btn-primary" disabled={exporting || cacheStatus !== 'ready' || photosLoading} onClick={() => void exportReport()}>{exporting ? '正在生成…' : '下载年度报告'}</button></div>
      </header>
      <div className="statistics-overview annual-review-overview">
        <article className="statistics-overview-card"><span>复盘旅程</span><strong>{review.summary.tripCount} 次</strong><small>{review.summary.segmentCount} 条路段 · 已关联 {referencedPhotoCount} 张照片</small></article>
        <OverviewCard label="规划里程" metric={review.summary.plannedDistanceMeters} kind="distance" />
        <OverviewCard label="实际里程" metric={review.summary.actualDistanceMeters} kind="distance" />
        <OverviewCard label="旅行天数" metric={review.summary.tripDays} kind="days" />
      </div>
      <p className="statistics-road-note">报告内嵌路线示意图和所选照片的缩略图，可离线浏览、通过浏览器打印。{cacheStatus !== 'ready' ? '路线缓存尚未就绪，暂不能导出。' : ''}</p>
      {exportMessage && <p role="status" className="retrospective-export-message">{exportMessage}</p>}
    </section>

    <section className="statistics-module"><header className="statistics-module-heading"><div><h3>全年路线地图</h3><p>显示已有路线，不自动重新规划。已保存 {review.mapSegments.length} 条，{review.missingMapSegmentCount} 条缺少匹配路线。</p></div></header>
      {review.mapSegments.length ? <div className="annual-review-map"><RoadbookMap segments={review.mapSegments} trips={review.trips} overviewYear={year} showScoreOptions={false} animateViewport={false} /></div> : <p className="hint-text">暂无可显示的已保存路线。</p>}
    </section>

    <section className="statistics-module"><header className="statistics-module-heading"><div><h3>最长旅程</h3><p>分别比较里程记录完整的旅程；部分记录不参与排名。</p></div></header>
      <div className="annual-review-highlights">{(['planned', 'actual'] as const).map(kind => {
        const row = kind === 'planned' ? review.longestPlanned : review.longestActual
        const trip = review.trips.find(trip => trip.id === row?.tripId)
        return <article key={kind}><small>{kind === 'planned' ? '按规划里程' : '按实际里程'}</small><h4>{row?.title ?? '暂无完整记录'}</h4>
          <strong>{formatNullableDistance(row ? row[kind === 'planned' ? 'plannedDistanceMeters' : 'actualDistanceMeters'].value : null)}</strong>
          {row && <p>{row.startDate}</p>}{trip && <button type="button" className="btn-secondary" onClick={() => onNavigate({ tripId: trip.id, dayId: '', segmentId: '' })}>查看旅程路线</button>}
        </article>
      })}</div>
    </section>

    <section className="statistics-module"><header className="statistics-module-heading"><div><h3>常走道路</h3><p>按涉及旅程数排序，最多列出 5 条；里程来自有效规划路线分析。</p></div></header>
      <div className="annual-review-road-list">{review.roads.map(road => <button type="button" key={road.key} onClick={() => onOpenRoad(road.key)}><strong>{roadArchiveTitle(road)}</strong><span>{road.historicalTripCount} 个旅程 · {formatNullableDistance(road.currentDistanceMeters)}</span><small>查看道路档案 ›</small></button>)}</div>
      {!review.roads.length && <p className="hint-text">暂无有效道路分析，可在统计总览中补全。</p>}
      <p className="statistics-road-note">同一旅程重复经过只计一个旅程，里程仍累计。分析完整 {review.summary.dataCompleteness.roadAnalysis.completeItemCount} 段、部分 {review.summary.dataCompleteness.roadAnalysis.partialItemCount} 段、待分析 {review.summary.dataCompleteness.roadAnalysis.missingItemCount} 段、过期 {review.summary.dataCompleteness.roadAnalysis.staleItemCount} 段。</p>
    </section>

    <section className="statistics-module"><header className="statistics-module-heading"><div><h3>值得回看的路段</h3><p>风景评分至少 7 分，按评分列出前 5 条。</p></div></header>
      <div className="annual-review-scenic-list">{review.scenicSegments.map(item => <article key={item.segmentId}><div><strong>{item.segment.name}</strong><small>{item.tripTitle} · {item.date}</small><p>{item.segment.startPoint} → {item.segment.endPoint}</p></div><div className="retrospective-actions"><strong>{item.segment.scenicScore} 分</strong><button type="button" className="btn-secondary" onClick={() => onNavigate(item)}>地图</button><button type="button" className="btn-secondary" disabled={!item.segment.photoIds?.length} onClick={() => onNavigate(item, true)}>相册</button></div></article>)}</div>
      {!review.scenicSegments.length && <p className="hint-text">暂无达到条件的已评分路段。</p>}
    </section>

    <section className="statistics-module"><header className="statistics-module-heading"><div><h3>精选照片</h3><p>默认优先选取各旅程封面，可自行调整，最多 12 张。已选 {selectedPhotos.length} 张。</p></div>
      {desktopAvailable && candidates.length > 0 && <button type="button" className="btn-secondary" onClick={() => setChoosingPhotos(value => !value)}>{choosingPhotos ? '完成选择' : '调整精选照片'}</button>}</header>
      {!desktopAvailable && <p className="hint-text">照片预览与选择需要桌面照片接口，当前仍可导出文字与路线报告。</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {desktopAvailable && photosLoading && <p role="status">正在读取照片索引…</p>}
      {desktopAvailable && !photosLoading && !candidates.length && <p className="hint-text">该年份暂无可用的关联照片。</p>}
      {choosingPhotos && <div className="retrospective-actions"><button type="button" className="btn-secondary" onClick={() => setPhotoSelectionByYear(current => ({ ...current, [year]: selectAnnualPhotoDefaults(candidates) }))}>恢复推荐</button><button type="button" className="btn-secondary" onClick={() => setPhotoSelectionByYear(current => ({ ...current, [year]: [] }))}>清空选择</button></div>}
      <div className="annual-review-photos">{(choosingPhotos ? candidates : selectedPhotos).map(item => <div key={item.photo.id}><SegmentPhotoThumbnail photo={item.photo} onOpen={() => onNavigate(item.target, true)} selectionMode={choosingPhotos} selected={selectedIds.includes(item.photo.id)} onToggleSelection={togglePhoto} /><small>{item.trip.title}</small></div>)}</div>
    </section>
  </div>
}

export default AnnualTravelReview

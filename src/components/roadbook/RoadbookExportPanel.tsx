import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { Trip } from '../../types/trip'
import type { LinkedPhotoRecord } from '../../types/photo'
import { electronPhotoRepository } from '../../services/electronPhotoRepository'
import { getAllSegmentRouteCacheStrict } from '../../services/routeCacheDb'
import { loadPhotoThumbnail } from '../../services/photoThumbnailLoadQueue'
import { getAnnualPhotoCandidates, selectAnnualPhotoDefaults } from '../../utils/travelRetrospective'
import { buildRoadbookHtml, createRoadbookFilename, type RoadbookReportPhoto } from '../../utils/roadbookExport'
import SegmentPhotoThumbnail from '../SegmentPhotoThumbnail'
import { buildRoadbookMapModel, type RoadbookMapAsset } from '../../utils/roadbookMapExport'
import { createRoadbookBasemapLoader } from '../../services/roadbookBasemap'

const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('缩略图读取失败'))
  reader.readAsDataURL(blob)
})
export default function RoadbookExportPanel({ trip, onClose, asDialog = false }: { trip: Trip; onClose: () => void; asDialog?: boolean }) {
  const isPlan = trip.category === 'plan'
  const panelRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!asDialog) return
    const previousFocus = document.activeElement as HTMLElement | null
    return () => { previousFocus?.focus() }
  }, [asDialog])
  useFocusTrap(panelRef, asDialog)
  const [photos, setPhotos] = useState<LinkedPhotoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [photoError, setPhotoError] = useState('')
  useEffect(() => {
    if (!asDialog) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !exporting) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape) }
  }, [asDialog, exporting, onClose])
  useEffect(() => {
    let cancelled = false
    if (isPlan || !window.roadtripDesktop?.photoLibrary) { setLoading(false); return }
    void electronPhotoRepository.listPhotos().then(records => { if (!cancelled) setPhotos(records) })
      .catch(() => { if (!cancelled) setPhotoError('照片索引读取失败，可继续导出文字与路线。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [trip.id, isPlan])
  const candidates = useMemo(() => getAnnualPhotoCandidates([trip], photos), [trip, photos])
  const defaults = useMemo(() => selectAnnualPhotoDefaults(candidates, 6), [candidates])
  const ids = selectedIds ?? defaults
  const cover = candidates.find(item => item.photo.id === trip.coverPhotoId)?.photo ?? candidates[0]?.photo
  const [includeCover, setIncludeCover] = useState(true)
  const toggle = (id: string) => setSelectedIds(current => {
    const values = current ?? defaults
    return values.includes(id) ? values.filter(value => value !== id) : values.length < 12 ? [...values, id] : values
  })
  const exportBook = async (format: 'html' | 'pdf') => {
    setExporting(true)
    setMessage('正在整理路书与照片…')
    try {
      const caches = await getAllSegmentRouteCacheStrict()
      const selected = candidates.filter(item => ids.includes(item.photo.id)).map(item => item.photo)
      const needed = [...new Map([...selected, ...(includeCover && cover ? [cover] : [])].map(photo => [photo.id, photo])).values()]
      const embedded = await Promise.all(needed.map(async photo => {
        let dataUrl: string | undefined
        try { const asset = await loadPhotoThumbnail(photo.id); if (asset) dataUrl = await blobDataUrl(asset.blob) } catch { /* 留下说明 */ }
        return { id: photo.id, segmentId: photo.segmentId, filename: photo.originalFilename, note: photo.note, dataUrl } satisfies RoadbookReportPhoto
      }))
      const byId = new Map(embedded.map(photo => [photo.id, photo]))
      const loadBasemap = createRoadbookBasemapLoader()
      const scopes = [{ key: 'trip', segments: trip.days.flatMap(day => day.routeSegments) },
        ...[...trip.days].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({ key: `day:${day.id}`, segments: day.routeSegments }))]
      const mapAssets = new Map<string, RoadbookMapAsset>()
      for (const [index, scope] of scopes.entries()) {
        const model = buildRoadbookMapModel(scope.segments, caches)
        if (!model.viewport) continue
        setMessage(`正在生成带底图的道路类型地图（${index + 1}/${scopes.length}）…`)
        mapAssets.set(scope.key, await loadBasemap(model.viewport))
      }
      const html = buildRoadbookHtml(trip, caches, selected.map(photo => byId.get(photo.id)!), includeCover && cover ? byId.get(cover.id) : undefined, mapAssets)
      const filename = createRoadbookFilename(trip.title, format, trip.category)
      if (format === 'pdf') {
        const api = window.roadtripDesktop?.roadbook
        if (!api) throw new Error('直接导出 PDF 需要桌面版。可先下载 HTML，再用浏览器打印保存为 PDF。')
        const result = await api.exportPdf({ html, filename })
        if (result.cancelled) { setMessage('已取消 PDF 导出。'); return }
      } else {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = filename; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      const missing = embedded.filter(photo => !photo.dataUrl).length
      const failedMaps = [...mapAssets.values()].filter(asset => !asset.dataUrl).length
      setMessage(`已导出 ${filename}。${missing ? `${missing} 张照片缩略图不可用，已保留说明。` : ''}${failedMaps ? `${failedMaps} 张地图底图获取失败，已降级为明确标注的路线示意图。` : ''}`)
    } catch (error) { setMessage(`路书导出失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setExporting(false) }
  }
  const panel = <section ref={panelRef} className={`roadbook-export-panel${asDialog ? ' feature-dialog' : ''}`} role={asDialog ? 'dialog' : undefined} aria-modal={asDialog || undefined} aria-label={isPlan ? '规划路书导出设置' : '路书导出设置'}>
    <header><h3>{isPlan ? '导出规划路书' : '导出路书'}</h3><button type="button" className="btn-secondary" disabled={exporting} onClick={onClose}>{asDialog ? '关闭' : '收起'}</button></header>
    {isPlan ? <><p><strong>{trip.title}</strong> · {trip.startDate} ～ {trip.endDate}</p>
      <p className="hint-text">导出整个规划旅程，包含逐日行程与汇总、路线地图、途经点、路线偏好、路段备注和道路统计，便于后续分析。仅使用已保存的规划数据，未计算的项目会标注待补全；预计用时仅为路线用时，不含游览、休息和住宿。</p>
      <p className="hint-text">导出时联网获取底图并嵌入文件，之后可离线查看；底图失败会保留路线示意图并说明原因。</p></>
      : <p className="hint-text">包含封面、逐日行程、按道路类型着色的地图、路段备注、照片备注、游记与统计。导出时联网获取底图并嵌入文件，标注起终点、途经点和方向；底图失败会显示降级说明。精选照片最多 12 张，内嵌缩略图后可离线分享。</p>}
    {loading && <p role="status">正在读取照片索引…</p>}{photoError && <p role="alert">{photoError}</p>}
    {!isPlan && !window.roadtripDesktop?.photoLibrary && <p className="hint-text">当前环境无法读取桌面照片，导出包含文字与路线。</p>}
    {!isPlan && <fieldset disabled={exporting || loading}><legend>精选照片（已选 {ids.length} 张）</legend>
      <div className="roadbook-export-actions"><label><input type="checkbox" checked={includeCover} onChange={event => setIncludeCover(event.target.checked)} />包含封面照片</label>
        <button type="button" className="btn-secondary" onClick={() => setSelectedIds([])}>不选照片</button><button type="button" className="btn-secondary" onClick={() => setSelectedIds(defaults)}>恢复推荐</button></div>
      <div className="roadbook-export-photos">{candidates.map(item => <SegmentPhotoThumbnail key={item.photo.id} photo={item.photo} onOpen={() => {}} selectionMode selected={ids.includes(item.photo.id)} onToggleSelection={toggle} />)}</div>
    </fieldset>}
    <div className="roadbook-export-actions"><button type="button" className="btn-primary" disabled={loading || exporting || !window.roadtripDesktop?.roadbook} onClick={() => void exportBook('pdf')}>导出 PDF</button>
      <button type="button" className="btn-secondary" disabled={loading || exporting} onClick={() => void exportBook('html')}>下载 HTML</button></div>
    {!window.roadtripDesktop?.roadbook && <p className="hint-text">直接导出 PDF 需要桌面版；也可下载 HTML 后通过浏览器打印保存为 PDF。</p>}
    {message && <p role="status">{message}</p>}
  </section>
  return asDialog ? createPortal(<div className="feature-dialog-backdrop">{panel}</div>, document.body) : panel
}

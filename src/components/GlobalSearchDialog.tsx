import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '../types/trip'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { getAllSegmentRouteCacheStrict, subscribeRouteCacheChanges, type RouteCacheRecord } from '../services/routeCacheDb'
import { electronPhotoRepository } from '../services/electronPhotoRepository'
import type { LinkedPhotoRecord } from '../types/photo'
import { buildGlobalSearchIndex, searchGlobalRecords, type SearchTarget } from '../utils/globalSearch'

interface Props { trips: readonly Trip[]; onClose: () => void; onNavigate: (target: SearchTarget) => Promise<boolean> }
const labels = { trip: '旅程', day: '日期', segment: '路段', photo: '照片' }
export default function GlobalSearchDialog({ trips, onClose, onNavigate }: Props) {
  const ref = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [caches, setCaches] = useState<RouteCacheRecord[]>([])
  const [photos, setPhotos] = useState<LinkedPhotoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState('')
  const [revision, setRevision] = useState(0)
  const [navigating, setNavigating] = useState(false)
  const [limit, setLimit] = useState(50)
  useFocusTrap(ref, !navigating)
  useEffect(() => subscribeRouteCacheChanges(() => setRevision(value => value + 1)), [])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.allSettled([
      getAllSegmentRouteCacheStrict(),
      window.roadtripDesktop?.photoLibrary ? electronPhotoRepository.listPhotos() : Promise.resolve([]),
    ]).then(([routes, images]) => {
      if (cancelled) return
      setCaches(routes.status === 'fulfilled' ? routes.value : [])
      setPhotos(images.status === 'fulfilled' ? images.value : [])
      setWarning([routes.status === 'rejected' ? '道路缓存读取失败，道路搜索不完整。' : '',
        images.status === 'rejected' ? '照片索引读取失败，照片搜索不可用。' : '',
        !window.roadtripDesktop?.photoLibrary ? '当前环境没有桌面照片接口，照片搜索不可用。' : ''].filter(Boolean).join(' '))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [revision, trips])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !navigating) { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onClose, navigating])
  const index = useMemo(() => buildGlobalSearchIndex(trips, caches, photos), [trips, caches, photos])
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(() => searchGlobalRecords(index, deferredQuery), [index, deferredQuery])
  const navigate = async (target: SearchTarget) => {
    setNavigating(true)
    try { if (await onNavigate(target)) onClose() }
    finally { setNavigating(false) }
  }
  return <div className="feature-dialog-backdrop" onClick={() => { if (!navigating) onClose() }}>
    <section className="feature-dialog global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title" ref={ref} onClick={event => event.stopPropagation()}>
      <header><h2 id="global-search-title">全局搜索与定位</h2><button type="button" className="btn-secondary" disabled={navigating} onClick={onClose}>关闭</button></header>
      <label className="global-search-input"><span>搜索所有复盘与规划记录</span><input autoFocus type="search" value={query} placeholder="旅程、地点、G318、路段备注、照片备注…" onChange={event => { setQuery(event.target.value); setLimit(50) }} /></label>
      <p className="hint-text">多个关键词用空格分隔；结果需同时匹配全部关键词。</p>
      {warning && <p role="status" className="feature-warning">{warning}</p>}
      <p role="status">{loading ? '正在读取道路与照片索引…' : !query.trim() ? '输入关键词开始搜索。' : `找到 ${results.length} 条匹配记录`}</p>
      <div className="global-search-results">{results.slice(0, limit).map(result => <button className="global-search-result" type="button" key={result.id} disabled={navigating} onClick={() => void navigate(result.target)}>
        <span className="global-search-result-heading"><strong>{result.title}</strong><small>{result.category === 'plan' ? '规划' : '复盘'} · {labels[result.kind]}</small></span>
        <span>{result.context}</span>
        {result.reasons.map(reason => <span className="global-search-reason" key={`${reason.label}:${reason.value}`}><b>{reason.label}：</b>{reason.value}</span>)}
        <small>定位到{labels[result.kind]} ›</small>
      </button>)}</div>
      {results.length > limit && <button type="button" className="btn-secondary" onClick={() => setLimit(value => value + 50)}>显示更多（还有 {results.length - limit} 条）</button>}
      {!loading && query.trim() && !results.length && <p className="hint-text">没有找到匹配记录，可尝试更短的关键词。</p>}
    </section>
  </div>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import EmptyState from '../EmptyState'
import { AppIcon } from '../icons'
import { loadPhotoThumbnail } from '../../services/photoThumbnailLoadQueue'
import type { LinkedPhotoRecord } from '../../types/photo'
import type { ReviewTag, RouteSegment, Trip } from '../../types/trip'
import type { TripBookItem } from '../../hooks/useTripWorkspace'
import { useRoadbookLibraryPhotos } from '../../hooks/useRoadbookPhotos'
import {
  ROADBOOK_EMPTY_FILTER,
  filterRoadbookTrips,
  getTripTags,
  getTripYears,
  summarizeRoadbookStats,
  type RoadbookFilterState,
} from '../../utils/roadbookFilters'
import { getReviewTagLabel, REVIEW_TAG_GROUPS } from '../../utils/reviewTags'
import { formatDistance } from '../../utils/distance'
import RoadbookMap from './RoadbookMap'

/** 封面缩略图：IntersectionObserver 按需加载，不加载原图。 */
function RoadbookCoverImage({ photo }: { photo: LinkedPhotoRecord }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    let cancelled = false
    let objectUrl = ''
    setThumbnailUrl('')
    setLoadFailed(false)

    const loadThumbnail = async () => {
      try {
        const asset = await loadPhotoThumbnail(photo.id)
        if (cancelled) return
        if (!asset) {
          setLoadFailed(true)
          return
        }
        objectUrl = URL.createObjectURL(asset.blob)
        setThumbnailUrl(objectUrl)
      } catch {
        if (!cancelled) setLoadFailed(true)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void loadThumbnail()
    }, { rootMargin: '120px' })
    observer.observe(element)

    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  return (
    <div ref={wrapRef} className="roadbook-cover-image">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" loading="lazy" />
      ) : (
        <span className="roadbook-cover-image-fallback">
          <AppIcon name="image" className="icon-inline" />
          {loadFailed ? '缩略图不可用' : '加载中…'}
        </span>
      )}
    </div>
  )
}

/** 仅使用已有轨迹或端点生成封面轮廓，不请求路线、不连接无关路段。 */
function RoadbookPlaceholderCover({ trip, item }: { trip?: Trip; item: TripBookItem }) {
  const paths = useMemo(() => {
    const tracks = (trip?.days.flatMap(day => day.routeSegments) ?? []).map(segment => {
      const points = segment.points?.length ? segment.points : [segment.startCoord, segment.endCoord].filter(Boolean)
      const stride = Math.max(1, Math.ceil(points.length / 80))
      return points.filter((point, index) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon) && (index % stride === 0 || index === points.length - 1)) as { lat: number; lon: number }[]
    }).filter(points => points.length > 1)
    const points = tracks.flat()
    if (!points.length) return []
    const xs = points.map(p => p.lon), ys = points.map(p => p.lat)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const longitudeScale = Math.max(.1, Math.cos((minY + maxY) * Math.PI / 360))
    const width = (maxX - minX) * longitudeScale, height = maxY - minY
    const scale = Math.min(260 / (width || 1), 110 / (height || 1))
    return tracks.map(track => track.map(p => [150 + ((p.lon - minX) * longitudeScale - width / 2) * scale, 70 - (p.lat - minY - height / 2) * scale].join(',')).join(' '))
  }, [trip])
  return <span className="roadbook-placeholder-art" aria-hidden="true">
    <span className="roadbook-placeholder-date">{item.startDate || '日期待补全'} · {item.dayCount} 天</span>
    {paths.length > 0 && <svg viewBox="0 0 300 140" preserveAspectRatio="xMidYMid meet">{paths.map((points, index) => <polyline key={index} points={points} />)}</svg>}
    <strong>{item.title}</strong>
    <span className="roadbook-placeholder-caption">{paths.length ? '路线轮廓' : '旅程手记'} · {item.segmentCount} 段旅途</span>
  </span>
}

interface RoadbookLibraryViewProps {
  trips: Trip[]
  items: TripBookItem[]
  onOpenTrip: (tripId: string) => void
  isReadonlyMode: boolean
  onSetCoverPhoto: (tripId: string, photoId: string | null) => void
}

function RoadbookLibraryView({ trips, items, onOpenTrip, isReadonlyMode, onSetCoverPhoto }: RoadbookLibraryViewProps) {
  const [filter, setFilter] = useState<RoadbookFilterState>(ROADBOOK_EMPTY_FILTER)
  const { coverByTrip, photosByTrip, desktopAvailable, isLoading, loadError } = useRoadbookLibraryPhotos(trips)
  const [coverTripId, setCoverTripId] = useState<string | null>(null)
  const coverDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (coverTripId) coverDialogRef.current?.showModal()
    else coverDialogRef.current?.close()
  }, [coverTripId])
  const selectCover = (photoId: string | null) => {
    if (!coverTripId || isReadonlyMode) return
    onSetCoverPhoto(coverTripId, photoId)
    setCoverTripId(null)
  }
  const tripById = useMemo(() => new Map(trips.map(trip => [trip.id, trip])), [trips])

  const years = useMemo(() => getTripYears(trips), [trips])
  const availableTags = useMemo(() => getTripTags(trips), [trips])
  const availableTagOrder = useMemo(
    () => REVIEW_TAG_GROUPS.flatMap((group) => group.tags.map((option) => option.code)),
    [],
  )
  const orderedTags = useMemo(
    () => availableTags.sort((a, b) => availableTagOrder.indexOf(a) - availableTagOrder.indexOf(b)),
    [availableTags, availableTagOrder],
  )

  const filteredTrips = useMemo(() => filterRoadbookTrips(trips, filter), [filter, trips])
  const filteredIds = useMemo(() => new Set(filteredTrips.map((trip) => trip.id)), [filteredTrips])
  const filteredItems = useMemo(
    () => [...items].filter((item) => filteredIds.has(item.id))
      .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [filteredIds, items],
  )
  const stats = useMemo(() => summarizeRoadbookStats(filteredTrips), [filteredTrips])
  const mapSegments = useMemo<RouteSegment[]>(
    () => filteredTrips.flatMap((trip) => trip.days.flatMap((day) => day.routeSegments)),
    [filteredTrips],
  )

  return (
    <section className="roadbook-view" aria-label="路书书架">
      <header className="roadbook-view-header">
        <h2>私人自驾书架</h2>
        <p className="hint-text">已完成旅程会以路书形式整理在这里，点击卡片即可翻开回看。</p>
      </header>

      {mapSegments.length > 0 && (
        <details className="roadbook-library-map" open={false}>
          <summary>旅程总览地图（{filteredTrips.length} 个旅程）</summary>
          <div className="roadbook-library-map-body">
            <RoadbookMap segments={mapSegments} />
          </div>
        </details>
      )}

      <div className="roadbook-stats-row roadbook-library-stats" aria-label="历史总览">
        <div className="roadbook-stat"><small>旅程数</small><strong>{stats.tripCount}</strong></div>
        <div className="roadbook-stat"><small>路段数</small><strong>{stats.segmentCount}</strong></div>
        <div className="roadbook-stat"><small>累计里程</small><strong>{formatDistance(stats.distanceMeters, '—')}</strong></div>
        <div className="roadbook-stat"><small>照片数</small><strong>{stats.photoCount}</strong></div>
      </div>

      <div className="roadbook-filter-bar" role="search" aria-label="筛选旅程">
        <label className="roadbook-filter-field">
          <span>年份</span>
          <select
            value={filter.year}
            onChange={(event) => setFilter((current) => ({ ...current, year: event.target.value }))}
          >
            <option value="">全部年份</option>
            {years.map((year) => (
              <option key={year} value={year}>{year} 年</option>
            ))}
          </select>
        </label>
        <label className="roadbook-filter-field roadbook-filter-query">
          <span>搜索</span>
          <input
            type="search"
            placeholder="旅程标题、起点、终点或途经点"
            value={filter.query}
            onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
          />
        </label>
        <label className="roadbook-filter-field">
          <span>标签</span>
          <select
            value={filter.tag}
            onChange={(event) => setFilter((current) => ({ ...current, tag: event.target.value }))}
            disabled={orderedTags.length === 0}
          >
            <option value="">全部标签</option>
            {orderedTags.map((tag: ReviewTag) => (
              <option key={tag} value={tag}>{getReviewTagLabel(tag)}</option>
            ))}
          </select>
        </label>
        {(filter.year || filter.query || filter.tag) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setFilter(ROADBOOK_EMPTY_FILTER)}
          >
            清除筛选
          </button>
        )}
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState
          icon="trip"
          title={trips.length === 0 ? '书架还是空的' : '没有匹配的旅程'}
          description={trips.length === 0
            ? '在「规划」中完成旅程并转入复盘后，这里会自动生成可回看的路书。'
            : '试试调整年份、关键词或标签筛选条件。'}
        />
      ) : (
        <ul className="roadbook-library-grid">
          {filteredItems.map((item) => {
            const coverPhoto = coverByTrip.get(item.id)
            return (
              <li key={item.id} className="roadbook-card">
                <button
                  type="button"
                  className={`roadbook-cover ${coverPhoto ? 'has-photo' : 'is-placeholder'}`}
                  onClick={() => onOpenTrip(item.id)}
                  aria-label={`打开路书：${item.title}`}
                >
                  {coverPhoto ? (
                    <RoadbookCoverImage photo={coverPhoto} />
                  ) : (
                    <RoadbookPlaceholderCover trip={tripById.get(item.id)} item={item} />
                  )}
                </button>
                <div className="roadbook-card-body">
                  <h3 className="roadbook-card-title" title={item.title}>{item.title}</h3>
                  <p className="roadbook-card-dates">
                    {item.startDate} ～ {item.endDate}
                  </p>
                  <p className="roadbook-card-meta">
                    {item.dayCount} 天 · {item.segmentCount} 段 · {item.tripDistanceText}
                    {' · '}预计 {item.tripDurationText}
                    {item.photoCount > 0 ? ` · 照片 ${item.photoCount} 张` : ''}
                  </p>
                  <div className="roadbook-card-actions">
                    {!isReadonlyMode && <button type="button" className="btn-secondary" onClick={() => setCoverTripId(item.id)}>
                      更换封面
                    </button>}
                    <button type="button" className="btn-primary" onClick={() => onOpenTrip(item.id)}>
                      打开路书
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <dialog ref={coverDialogRef} className="roadbook-cover-picker" onCancel={() => setCoverTripId(null)} onClose={() => setCoverTripId(null)} aria-labelledby="roadbook-cover-picker-title">
        <h2 id="roadbook-cover-picker-title">选择封面 · {coverTripId ? tripById.get(coverTripId)?.title : ''}</h2>
        <p className="hint-text">点击该旅程中的照片即可保存为封面，照片将完整显示。</p>
        <div className="roadbook-cover-picker-actions">
          <button type="button" className="btn-secondary" onClick={() => selectCover(null)}>恢复默认封面</button>
          <button type="button" className="btn-secondary" onClick={() => setCoverTripId(null)}>关闭</button>
        </div>
        {!desktopAvailable ? <p>请在桌面版中选择封面照片。</p>
          : isLoading ? <p role="status">正在加载照片…</p>
          : loadError ? <p role="alert">{loadError}</p>
          : <div className="roadbook-cover-picker-grid">
            {(photosByTrip.get(coverTripId ?? '') ?? []).map(photo => <button
              type="button" key={photo.id} className="roadbook-cover-choice"
              aria-pressed={coverByTrip.get(coverTripId ?? '')?.id === photo.id}
              onClick={() => selectCover(photo.id)}
            >
              <span className="roadbook-cover-choice-image"><RoadbookCoverImage photo={photo} /></span>
              <span>{photo.originalFilename}</span>
            </button>)}
            {!photosByTrip.get(coverTripId ?? '')?.length && <p>该旅程暂无照片，请先在相册中关联照片。</p>}
          </div>}
      </dialog>
    </section>
  )
}

export default RoadbookLibraryView

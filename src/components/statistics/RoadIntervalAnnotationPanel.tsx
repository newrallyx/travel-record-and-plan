import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { RouteSegment } from '../../types/trip.ts'
import type { ConcurrentRoad, ManualRoadIntervalAnnotation, RoadClass } from '../../types/roadStatistics.ts'
import ConcurrentRoadEditor from './ConcurrentRoadEditor.tsx'
import { showToast } from '../ToastHost.tsx'
import type { RouteCacheRecord, ManualRoadIntervalAnnotationInput } from '../../services/routeCacheDb.ts'
import { ROAD_CLASS_LABELS } from '../../config/roadStatistics.ts'
import { getRenderableRoadParts, roadTypeColorForClass } from '../map/roadTypeVisualization.ts'
import { isProvinceSensitiveRoadPart, PROVINCE_OPTIONS } from '../../utils/province.ts'
import { saveManualRoadIntervalAnnotation, revokeManualRoadIntervalAnnotation } from '../../services/routeCacheDb.ts'
import { roadEvidenceText } from '../../utils/roadEvidence.ts'
import { getRoadPartDisplayName } from '../../utils/roadNamePresentation.ts'
import { confirmDialog } from '../ConfirmDialog.tsx'

const ROAD_CLASS_OPTIONS = Object.keys(ROAD_CLASS_LABELS) as RoadClass[]
const SELECTION_COLOR = '#ffeb3b'
const SELECTION_OUTLINE = '#111827'
const SELECTION_MARKER_STYLE = { color: SELECTION_OUTLINE, weight: 2, fillColor: SELECTION_COLOR, fillOpacity: 1, opacity: 1 }

interface Props {
  segment: RouteSegment | undefined
  cache: RouteCacheRecord | null
  disabled: boolean
  onCacheChange: () => void
  onReload: () => Promise<void>
  activePartIndex: number | null
  selectedPartIndices: ReadonlySet<number>
  onDirtyChange: (dirty: boolean) => void
}

function FitTrack({ points }: { points: readonly [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(points, { padding: [20, 20], animate: false })
  }, [map, points])
  return null
}

function SelectedTrack({ positions, dashed = false, showEndpoints = false }: {
  positions: [number, number][]
  dashed?: boolean
  showEndpoints?: boolean
}) {
  const dashArray = dashed ? '10 6' : undefined
  return <>
    <Polyline positions={positions} interactive={false} className="road-selection-outline"
      pathOptions={{ color: SELECTION_OUTLINE, weight: 10, opacity: 1, dashArray }} />
    <Polyline positions={positions} interactive={false} className="road-selection-line"
      pathOptions={{ color: SELECTION_COLOR, weight: 6, opacity: 1, dashArray }} />
    {showEndpoints && <>
      <CircleMarker center={positions[0]} radius={7} pathOptions={SELECTION_MARKER_STYLE} interactive={false} />
      <CircleMarker center={positions[positions.length - 1]} radius={7} pathOptions={SELECTION_MARKER_STYLE} interactive={false} />
    </>}
  </>
}

function nearestPointIndex(points: readonly [number, number][], lat: number, lng: number): number {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  points.forEach(([pointLat, pointLng], index) => {
    const distance = Math.hypot(pointLat - lat, pointLng - lng)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}

function intervalLabel(annotation: ManualRoadIntervalAnnotation): string {
  return `${annotation.startPointIndex + 1}–${annotation.endPointIndex + 1} 点 · ${(annotation.distanceMeters / 1000).toFixed(2)} km`
}

export default function RoadIntervalAnnotationPanel({ segment, cache, disabled, onCacheChange, onReload, activePartIndex, selectedPartIndices, onDirtyChange }: Props) {
  const points = cache?.points?.length ? cache.points : segment?.points ?? []
  const line = useMemo(() => points.map((point) => [point.lat, point.lon] as [number, number]), [points])
  const roadParts = useMemo(() => getRenderableRoadParts(cache?.roadParts, {
    isOverviewMode: false,
    maximumPoints: Number.POSITIVE_INFINITY,
  }), [cache?.roadParts])
  const [startPointIndex, setStartPointIndex] = useState<number | null>(null)
  const [endPointIndex, setEndPointIndex] = useState<number | null>(null)
  const [roadClass, setRoadClass] = useState<RoadClass>('PROVINCIAL_ROAD')
  const [manualDirection, setManualDirection] = useState('')
  const [routeRef, setRouteRef] = useState('')
  const [roadName, setRoadName] = useState('')
  const [provinceCode, setProvinceCode] = useState('')
  const [editingId, setEditingId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [concurrentRoads, setConcurrentRoads] = useState<ConcurrentRoad[]>([])
  const savedForm = useRef('')
  const formSignature = JSON.stringify({ startPointIndex, endPointIndex, roadClass, manualDirection, routeRef, roadName, provinceCode, editingId, concurrentRoads })
  if (!savedForm.current) savedForm.current = formSignature
  const dirty = formSignature !== savedForm.current
  useLayoutEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  const activePart = activePartIndex === null ? undefined : cache?.roadParts?.[activePartIndex]
  const highlighted = useMemo(() => roadParts.filter(part => selectedPartIndices.has(part.sourceIndex)
    || part.sourceIndex === activePartIndex), [roadParts, selectedPartIndices, activePartIndex])
  const highlightedPoints = useMemo(() => highlighted.flatMap(part => part.positions), [highlighted])
  const missingSelectedCount = selectedPartIndices.size - roadParts.filter(part => selectedPartIndices.has(part.sourceIndex)).length

  const activeRange = startPointIndex !== null && endPointIndex !== null
    ? [Math.min(startPointIndex, endPointIndex), Math.max(startPointIndex, endPointIndex)] as const
    : null
  const previewLine = activeRange
    ? line.slice(activeRange[0], activeRange[1] + 1)
    : []
  const provinceRequired = isProvinceSensitiveRoadPart({ roadClass, routeRef })

  const resetForm = () => {
    setStartPointIndex(null)
    setEndPointIndex(null)
    setRouteRef('')
    setRoadName('')
    setManualDirection('')
    setProvinceCode('')
    setEditingId(undefined)
    setConcurrentRoads([])
    savedForm.current = JSON.stringify({ startPointIndex: null, endPointIndex: null, roadClass, manualDirection: '', routeRef: '', roadName: '', provinceCode: '', concurrentRoads: [] })
  }

  const selectFromMap = (index: number) => {
    if (disabled || saving) return
    if (startPointIndex === null || endPointIndex !== null) {
      setStartPointIndex(index)
      setEndPointIndex(null)
      return
    }
    if (index === startPointIndex) return
    setEndPointIndex(index)
  }

  const editAnnotation = async (annotation: ManualRoadIntervalAnnotation) => {
    if (dirty && !await confirmDialog({ title: '放弃未保存的区间标注', message: '当前区间标注有未保存的更改，确定放弃并修改另一条标注吗？', confirmText: '放弃更改' })) return
    setEditingId(annotation.id)
    setStartPointIndex(annotation.startPointIndex)
    setEndPointIndex(annotation.endPointIndex)
    setRoadClass(annotation.roadClass)
    setRouteRef(annotation.routeRef ?? '')
    setRoadName(annotation.roadName ?? '')
    setManualDirection(annotation.manualDirection ?? '')
    setProvinceCode(annotation.provinceCode ?? '')
    setConcurrentRoads(annotation.concurrentRoads?.map(road => ({ ...road })) ?? [])
    savedForm.current = JSON.stringify({ startPointIndex: annotation.startPointIndex, endPointIndex: annotation.endPointIndex,
      roadClass: annotation.roadClass, manualDirection: annotation.manualDirection ?? '', routeRef: annotation.routeRef ?? '', roadName: annotation.roadName ?? '',
      provinceCode: annotation.provinceCode ?? '', editingId: annotation.id, concurrentRoads: annotation.concurrentRoads ?? [] })
  }

  const save = async () => {
    if (!segment || activeRange === null || saving || disabled) return
    if (provinceRequired && !provinceCode) return
    setSaving(true)
    const input: ManualRoadIntervalAnnotationInput = {
      segment,
      startPointIndex: activeRange[0],
      endPointIndex: activeRange[1],
      roadClass,
      routeRef,
      roadName,
      manualDirection: manualDirection || undefined,
      provinceCode,
      annotationId: editingId,
      concurrentRoads,
    }
    try {
      await saveManualRoadIntervalAnnotation(input)
      await onReload()
      onCacheChange()
      resetForm()
    } catch (error) {
      showToast((error as Error).message || '道路区间标注保存失败。', 'error')
    } finally {
      setSaving(false)
    }
  }

  const revoke = async (annotationId: string) => {
    if (disabled || saving || !segment) return
    setSaving(true)
    try {
      await revokeManualRoadIntervalAnnotation(segment.id, annotationId)
      await onReload()
      onCacheChange()
      if (editingId === annotationId) resetForm()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="road-interval-annotation" aria-label="轨迹区间道路标注">
      <header>
        <div>
          <h4>轨迹区间道路标注</h4>
          <p>在地图轨迹上依次点击起点和终点；未标注部分保持未知，原始轨迹不变。</p>
        </div>
        <span>{points.length >= 2 ? `${points.length} 个轨迹点` : '暂无可选轨迹'}</span>
      </header>
      {activePart && <p className="statistics-road-note" role="status">
        表格定位：第 {activePartIndex! + 1} 段 · {getRoadPartDisplayName(activePart)} · {roadEvidenceText(activePart)}
        {!highlighted.some(part => part.sourceIndex === activePartIndex) && ' · 该片段缺少有效坐标，无法在地图高亮。'}
      </p>}
      {selectedPartIndices.size > 0 && <p className="statistics-road-note" role="status">
        表格已选 {selectedPartIndices.size} 段，地图同步高亮。
        {missingSelectedCount > 0 && `其中 ${missingSelectedCount} 段缺少有效坐标，无法高亮。`}
      </p>}
      {points.length >= 2 ? (
        <>
          <div className="road-interval-map" data-testid="road-interval-map">
            <MapContainer center={line[0]} zoom={10} zoomSnap={0.25} zoomDelta={0.25} wheelPxPerZoomLevel={160}
              scrollWheelZoom className="road-interval-map-container">
              <TileLayer
                attribution='&copy; <a href="https://www.amap.com/">Amap</a>'
                url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
                subdomains={[1, 2, 3, 4]}
              />
              <FitTrack points={line} />
              {highlightedPoints.length >= 2 && <FitTrack points={highlightedPoints} />}
              <Polyline
                positions={line}
                pathOptions={{ color: roadTypeColorForClass('UNKNOWN'), weight: 5, opacity: 0.65 }}
                eventHandlers={{ click: (event: any) => selectFromMap(nearestPointIndex(line, event.latlng.lat, event.latlng.lng)) }}
              />
              {roadParts.map((part) => <Polyline
                key={part.sourceIndex}
                positions={part.positions}
                pathOptions={{ color: roadTypeColorForClass(part.roadClass), weight: 5, opacity: 0.9 }}
                eventHandlers={{ click: (event: any) => selectFromMap(nearestPointIndex(line, event.latlng.lat, event.latlng.lng)) }}
              />)}
              {highlighted.map(part => <SelectedTrack key={part.sourceIndex} positions={part.positions} showEndpoints={startPointIndex === null} />)}
              {previewLine.length >= 2 && <SelectedTrack positions={previewLine} dashed />}
              {startPointIndex !== null && <CircleMarker center={line[activeRange ? activeRange[0] : startPointIndex]} radius={7} pathOptions={SELECTION_MARKER_STYLE} interactive={false} />}
              {activeRange !== null && <CircleMarker center={line[activeRange[1]]} radius={7} pathOptions={SELECTION_MARKER_STYLE} interactive={false} />}
            </MapContainer>
          </div>
          <div className="road-interval-selection-toolbar">
            <span aria-live="polite">{activeRange ? `已选第 ${activeRange[0] + 1}–${activeRange[1] + 1} 个点` : '请在地图上点击两个点'}</span>
            <div className="road-interval-selection-actions">
              <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={() => { setStartPointIndex(0); setEndPointIndex(points.length - 1) }}>整条路段</button>
              <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={resetForm}>清除选择</button>
            </div>
          </div>
          <div className="road-interval-fields">
            <label><span>道路类型</span><select value={roadClass} disabled={disabled || saving} onChange={(event) => { setRoadClass(event.target.value as RoadClass); setManualDirection('') }}>
              {ROAD_CLASS_OPTIONS.map((value) => <option key={value} value={value}>{ROAD_CLASS_LABELS[value]}</option>)}
            </select></label>
            <label><span>道路编号</span><input value={routeRef} disabled={disabled || saving} placeholder="如 S101" onChange={(event) => { setRouteRef(event.target.value); setManualDirection('') }} /></label>
            <label><span>道路名称（可选）</span><input value={roadName} disabled={disabled || saving} placeholder="留空沿用原名称" onChange={(event) => setRoadName(event.target.value)} /></label>
            <label><span>省份{provinceRequired ? '（必选）' : ''}</span><select value={provinceCode} disabled={disabled || saving || !provinceRequired} onChange={(event) => { setProvinceCode(event.target.value); setManualDirection('') }}>
              <option value="">{provinceRequired ? '请选择' : '不适用'}</option>
              {PROVINCE_OPTIONS.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
            </select></label>
            <button type="button" className="btn-primary" disabled={disabled || saving || !activeRange || (provinceRequired && !provinceCode)} onClick={() => void save()}>
              {saving ? '保存中…' : editingId ? '保存修改' : '保存区间标注'}
            </button>
          </div>
          <p className="statistics-road-note">道路名称作用于整个所选区间，留空沿用各片段原名称。保留主道路编号，可添加多条共线道路；各道路里程含共线区间，总行驶里程只计一次。</p>
          <ConcurrentRoadEditor label="所选区间共线道路" roads={concurrentRoads} onChange={setConcurrentRoads}
            defaultClass={roadClass} provinceCode={provinceCode} disabled={disabled || saving} />
          {(cache?.manualRoadAnnotations?.length ?? 0) > 0 && (
            <div className="road-interval-annotation-list">
              {cache?.manualRoadAnnotations?.map((annotation) => <div key={annotation.id}>
                <span><strong>{ROAD_CLASS_LABELS[annotation.roadClass]}</strong> {annotation.routeRef ?? '无编号'} · {intervalLabel(annotation)}</span>
                {annotation.roadName && <span>{annotation.roadName}</span>}
                {!!annotation.concurrentRoads?.length && <span>共线：{annotation.concurrentRoads.map(road => `${road.provinceCode ?? ''} ${road.routeRef}`).join('、')}</span>}
                <span className="statistics-route-names">{annotation.provinceCode ? `${annotation.provinceCode} · ` : ''}{annotation.distanceSource === 'GEOMETRY_ESTIMATE' ? '几何估算' : '按原里程分配'}</span>
                <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={() => void editAnnotation(annotation)}>修改</button>
                <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={() => void revoke(annotation.id)}>撤销</button>
              </div>)}
            </div>
          )}
        </>
      ) : <p className="road-analysis-empty">当前旅程没有可用于区间标注的原始轨迹。</p>}
    </section>
  )
}

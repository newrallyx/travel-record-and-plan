import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { RouteSegment } from '../../types/trip.ts'
import type { ManualRoadIntervalAnnotation, RoadClass } from '../../types/roadStatistics.ts'
import type { RouteCacheRecord, ManualRoadIntervalAnnotationInput } from '../../services/routeCacheDb.ts'
import { ROAD_CLASS_LABELS } from '../../config/roadStatistics.ts'
import { isProvinceSensitiveRoadPart, PROVINCE_OPTIONS } from '../../utils/province.ts'
import { saveManualRoadIntervalAnnotation, revokeManualRoadIntervalAnnotation } from '../../services/routeCacheDb.ts'

const ROAD_CLASS_OPTIONS = Object.keys(ROAD_CLASS_LABELS) as RoadClass[]

interface Props {
  segment: RouteSegment | undefined
  cache: RouteCacheRecord | null
  disabled: boolean
  onCacheChange: () => void
  onReload: () => Promise<void>
}

function FitTrack({ points }: { points: readonly [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= 2) map.fitBounds(points, { padding: [20, 20] })
  }, [map, points])
  return null
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

export default function RoadIntervalAnnotationPanel({ segment, cache, disabled, onCacheChange, onReload }: Props) {
  const points = cache?.points?.length ? cache.points : segment?.points ?? []
  const line = useMemo(() => points.map((point) => [point.lat, point.lon] as [number, number]), [points])
  const [startPointIndex, setStartPointIndex] = useState<number | null>(null)
  const [endPointIndex, setEndPointIndex] = useState<number | null>(null)
  const [roadClass, setRoadClass] = useState<RoadClass>('PROVINCIAL_ROAD')
  const [routeRef, setRouteRef] = useState('')
  const [provinceCode, setProvinceCode] = useState('')
  const [editingId, setEditingId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

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
    setProvinceCode('')
    setEditingId(undefined)
  }

  const selectFromMap = (index: number) => {
    if (startPointIndex === null || endPointIndex !== null) {
      setStartPointIndex(index)
      setEndPointIndex(null)
      return
    }
    if (index === startPointIndex) return
    setEndPointIndex(index)
  }

  const editAnnotation = (annotation: ManualRoadIntervalAnnotation) => {
    setEditingId(annotation.id)
    setStartPointIndex(annotation.startPointIndex)
    setEndPointIndex(annotation.endPointIndex)
    setRoadClass(annotation.roadClass)
    setRouteRef(annotation.routeRef ?? '')
    setProvinceCode(annotation.provinceCode ?? '')
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
      provinceCode,
      annotationId: editingId,
    }
    try {
      await saveManualRoadIntervalAnnotation(input)
      await onReload()
      onCacheChange()
      resetForm()
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
          <h4>纯轨迹区间标注</h4>
          <p>在地图轨迹上依次点击起点和终点；未标注部分保持未知，原始轨迹不变。</p>
        </div>
        <span>{points.length >= 2 ? `${points.length} 个轨迹点` : '暂无可选轨迹'}</span>
      </header>
      {points.length >= 2 ? (
        <>
          <div className="road-interval-map" data-testid="road-interval-map">
            <MapContainer center={line[0]} zoom={10} scrollWheelZoom className="road-interval-map-container">
              <TileLayer
                attribution='&copy; <a href="https://www.amap.com/">Amap</a>'
                url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
                subdomains={[1, 2, 3, 4]}
              />
              <FitTrack points={line} />
              <Polyline
                positions={line}
                pathOptions={{ color: '#64748b', weight: 5, opacity: 0.65 }}
                eventHandlers={{ click: (event: any) => selectFromMap(nearestPointIndex(line, event.latlng.lat, event.latlng.lng)) }}
              />
              {previewLine.length >= 2 && <Polyline positions={previewLine} pathOptions={{ color: '#e11d48', weight: 8, opacity: 0.9 }} />}
              {startPointIndex !== null && <CircleMarker center={line[startPointIndex]} radius={7} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }} />}
              {endPointIndex !== null && <CircleMarker center={line[endPointIndex]} radius={7} pathOptions={{ color: '#e11d48', fillColor: '#e11d48', fillOpacity: 1 }} />}
            </MapContainer>
          </div>
          <div className="road-interval-selection-toolbar">
            <span aria-live="polite">{activeRange ? `已选第 ${activeRange[0] + 1}–${activeRange[1] + 1} 个点` : '请在地图上点击两个点'}</span>
            <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={() => { setStartPointIndex(0); setEndPointIndex(points.length - 1) }}>整条路段</button>
            <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={resetForm}>清除选择</button>
          </div>
          <div className="road-interval-fields">
            <label><span>道路类型</span><select value={roadClass} disabled={disabled || saving} onChange={(event) => setRoadClass(event.target.value as RoadClass)}>
              {ROAD_CLASS_OPTIONS.map((value) => <option key={value} value={value}>{ROAD_CLASS_LABELS[value]}</option>)}
            </select></label>
            <label><span>道路编号</span><input value={routeRef} disabled={disabled || saving} placeholder="如 S101" onChange={(event) => setRouteRef(event.target.value)} /></label>
            <label><span>省份{provinceRequired ? '（必选）' : ''}</span><select value={provinceCode} disabled={disabled || saving || !provinceRequired} onChange={(event) => setProvinceCode(event.target.value)}>
              <option value="">{provinceRequired ? '请选择' : '不适用'}</option>
              {PROVINCE_OPTIONS.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
            </select></label>
            <button type="button" className="btn-primary" disabled={disabled || saving || !activeRange || (provinceRequired && !provinceCode)} onClick={() => void save()}>
              {saving ? '保存中…' : editingId ? '保存修改' : '保存区间标注'}
            </button>
          </div>
          {(cache?.manualRoadAnnotations?.length ?? 0) > 0 && (
            <div className="road-interval-annotation-list">
              {cache?.manualRoadAnnotations?.map((annotation) => <div key={annotation.id}>
                <span><strong>{ROAD_CLASS_LABELS[annotation.roadClass]}</strong> {annotation.routeRef ?? '无编号'} · {intervalLabel(annotation)}</span>
                <span className="statistics-route-names">{annotation.provinceCode ? `${annotation.provinceCode} · ` : ''}{annotation.distanceSource === 'GEOMETRY_ESTIMATE' ? '几何估算' : '按原里程分配'}</span>
                <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={() => editAnnotation(annotation)}>修改</button>
                <button type="button" className="btn-secondary" disabled={disabled || saving} onClick={() => void revoke(annotation.id)}>撤销</button>
              </div>)}
            </div>
          )}
        </>
      ) : <p className="road-analysis-empty">当前旅程没有可用于区间标注的原始轨迹。</p>}
    </section>
  )
}

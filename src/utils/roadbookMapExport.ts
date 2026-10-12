import type { CoordPoint, RouteSegment, Trip } from '../types/trip.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import { getSavedTravelSegments } from './travelRetrospective.ts'
import { hasCurrentRoadAnalysis } from './routeBuildKey.ts'
import { getRenderableRoadParts, roadTypeColorForClass, ROAD_TYPE_MAP_COLORS, ROAD_TYPE_MAP_LABELS, ROAD_TYPE_VISIBILITY_CATEGORIES } from '../components/map/roadTypeVisualization.ts'
import { escapeReportText } from './annualReviewExport.ts'

export const ROADBOOK_MAP_WIDTH = 1200
export const ROADBOOK_MAP_HEIGHT = 640
export interface ExportMapViewport { zoom: number; left: number; top: number; width: number; height: number }
export interface ExportMapTile { x: number; y: number; z: number; left: number; top: number; size: number }
interface MapLine { points: CoordPoint[]; color: string; segmentId: string }
interface MapMarker { point: CoordPoint; label: string; kind: 'start' | 'end' | 'waypoint' }
export interface RoadbookMapModel {
  viewport: ExportMapViewport | null
  lines: MapLine[]
  directions: CoordPoint[][]
  markers: MapMarker[]
  missingRouteCount: number
  unclassifiedSegmentCount: number
  unpositionedWaypoints: string[]
}
export interface RoadbookMapAsset { dataUrl?: string; failure?: string }
const validPoint = (point: CoordPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 85.05112878 && Math.abs(point.lon) <= 180
const pointsOf = (segment?: RouteSegment) => segment?.points?.filter(validPoint) ?? []
export function projectExportMapPoint(point: CoordPoint, zoom: number): [number, number] {
  const size = 256 * 2 ** zoom
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180
  return [(point.lon + 180) / 360 * size, (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size]
}
function viewportFor(points: CoordPoint[]): ExportMapViewport | null {
  if (!points.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    const [x, y] = projectExportMapPoint(point, 0)
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  // 连续缩放避免整数层级向下取整后路线最多缩小近一半；四周留出标记空间。
  const zoom = Math.max(1, Math.min(16, Math.log2(Math.min((ROADBOOK_MAP_WIDTH - 96) / Math.max(maxX - minX, .001), (ROADBOOK_MAP_HEIGHT - 96) / Math.max(maxY - minY, .001)))))
  const scale = 2 ** zoom
  return { zoom, left: (minX + maxX) / 2 * scale - ROADBOOK_MAP_WIDTH / 2, top: (minY + maxY) / 2 * scale - ROADBOOK_MAP_HEIGHT / 2, width: ROADBOOK_MAP_WIDTH, height: ROADBOOK_MAP_HEIGHT }
}
export function getExportMapTiles(viewport: ExportMapViewport): ExportMapTile[] {
  // 请求更清晰的整数级瓦片，再缩放到与路线相同的连续投影坐标。
  const zoom = Math.ceil(viewport.zoom), size = 256 * 2 ** (viewport.zoom - zoom)
  const tiles: ExportMapTile[] = [], maximum = 2 ** zoom
  for (let y = Math.floor(viewport.top / size); y < Math.ceil((viewport.top + viewport.height) / size); y++) {
    for (let x = Math.floor(viewport.left / size); x < Math.ceil((viewport.left + viewport.width) / size); x++) {
      if (y < 0 || y >= maximum) continue
      tiles.push({ x: ((x % maximum) + maximum) % maximum, y, z: zoom, left: x * size - viewport.left, top: y * size - viewport.top, size })
    }
  }
  return tiles
}
/** 图内坐标与应用地图同用 GCJ02；分类只取有效缓存，未覆盖几何先画为灰色。 */
export function buildRoadbookMapModel(segments: readonly RouteSegment[], caches: readonly RouteCacheRecord[]): RoadbookMapModel {
  const shell: Trip = { id: 'export', title: '', category: 'review', startDate: '', endDate: '', days: [{ id: 'export', date: '', routeSegments: [...segments] }] }
  const saved = getSavedTravelSegments([shell], caches)
  const savedById = new Map(saved.map(segment => [segment.id, segment]))
  const cacheById = new Map(caches.map(cache => [cache.segmentId, cache]))
  const lines: MapLine[] = [], directions: CoordPoint[][] = [], markers: MapMarker[] = [], unpositionedWaypoints: string[] = []
  let unclassifiedSegmentCount = 0
  for (const segment of saved) {
    const points = pointsOf(segment)
    if (points.length < 2) continue
    lines.push({ points, color: ROAD_TYPE_MAP_COLORS.UNKNOWN, segmentId: segment.id })
    directions.push(points)
    const cache = cacheById.get(segment.id)
    const parts = cache && hasCurrentRoadAnalysis(segment, cache) ? getRenderableRoadParts(cache.roadParts, { isOverviewMode: false, maximumPoints: 20000 }) : []
    if (!parts.length || parts.some(part => part.roadClass === 'UNKNOWN') || cache?.roadAnalysis?.status !== 'complete' || parts.length < (cache?.roadParts?.length ?? 0)) unclassifiedSegmentCount++
    for (const part of parts) {
      const partPoints = part.positions.map(([lat, lon]) => ({ lat, lon }))
      if (partPoints.every(validPoint)) lines.push({ points: partPoints, color: roadTypeColorForClass(part.roadClass), segmentId: segment.id })
    }
  }
  const first = segments[0], last = segments[segments.length - 1]
  const start = first?.startCoord && validPoint(first.startCoord) ? first.startCoord : pointsOf(savedById.get(first?.id))[0]
  const endPoints = pointsOf(savedById.get(last?.id))
  const end = last?.endCoord && validPoint(last.endCoord) ? last.endCoord : endPoints[endPoints.length - 1]
  if (start) markers.push({ point: start, label: `起点：${first.startPoint}`, kind: 'start' })
  if (end) markers.push({ point: end, label: `终点：${last.endPoint}`, kind: 'end' })
  for (const [index, segment] of segments.entries()) {
    for (const waypoint of segment.waypoints ?? []) {
      const point = { lat: waypoint.lat ?? NaN, lon: waypoint.lng ?? NaN }
      if (validPoint(point)) markers.push({ point, label: waypoint.name, kind: 'waypoint' })
      else if (waypoint.name.trim()) unpositionedWaypoints.push(waypoint.name)
    }
    if (index < segments.length - 1) {
      const points = pointsOf(savedById.get(segment.id))
      const point = segment.endCoord && validPoint(segment.endCoord) ? segment.endCoord : points[points.length - 1]
      if (point) markers.push({ point, label: segment.endPoint, kind: 'waypoint' })
      else if (segment.endPoint.trim()) unpositionedWaypoints.push(segment.endPoint)
    }
  }
  // 防止同一途经点反复标注；起终点即使重合仍保留两个独立标签。
  const seen = new Set<string>()
  const uniqueMarkers = markers.filter(marker => { const key = `${marker.kind}:${marker.label}:${marker.point.lat}:${marker.point.lon}`; if (seen.has(key)) return false; seen.add(key); return true })
  const geometry = lines.flatMap(line => line.points)
  return { viewport: viewportFor([...geometry, ...uniqueMarkers.map(marker => marker.point)]), lines, directions, markers: uniqueMarkers,
    missingRouteCount: segments.length - directions.length, unclassifiedSegmentCount, unpositionedWaypoints: [...new Set(unpositionedWaypoints)] }
}

export function buildRoadbookMapSvg(model: RoadbookMapModel, asset?: RoadbookMapAsset) {
  const text = escapeReportText, viewport = model.viewport
  if (!viewport) return `<p class="muted">暂无已保存路线或可定位的地点。${model.missingRouteCount ? ` ${model.missingRouteCount} 条路段缺少匹配路线，未补画。` : ''}${model.unpositionedWaypoints.length ? ` 缺少坐标的途经点：${text(model.unpositionedWaypoints.join('、'))}。` : ''}</p>`
  const pixel = (point: CoordPoint) => { const [x, y] = projectExportMapPoint(point, viewport.zoom); return [x - viewport.left, y - viewport.top] }
  const basemap = asset?.dataUrl && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(asset.dataUrl) ? asset.dataUrl : undefined
  const paths = model.lines.map(line => {
    const step = Math.max(1, Math.ceil(line.points.length / 2000))
    const points = line.points.filter((_, i) => i % step === 0 || i === line.points.length - 1).map(point => pixel(point).map(value => value.toFixed(2)).join(',')).join(' ')
    return `<polyline data-segment="${text(line.segmentId)}" fill="none" stroke="${line.color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>`
  }).join('')
  const arrows = model.directions.flatMap(points => {
    const projected = points.map(pixel), lengths = projected.slice(1).map((point, i) => Math.hypot(point[0] - projected[i][0], point[1] - projected[i][1]))
    const total = lengths.reduce((a, b) => a + b, 0)
    return [.3, .7].flatMap(fraction => {
      let remaining = total * fraction
      for (let i = 0; i < lengths.length; i++) {
        if (remaining > lengths[i]) { remaining -= lengths[i]; continue }
        if (lengths[i] < .001 || total < 30) return []
        const a = projected[i], b = projected[i + 1], ratio = remaining / lengths[i]
        const x = a[0] + (b[0] - a[0]) * ratio, y = a[1] + (b[1] - a[1]) * ratio, angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI
        return [`<path class="route-direction" d="M-7,-6 L3,0 L-7,6" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)})" fill="none" stroke="white" stroke-width="3" style="filter:drop-shadow(0 0 2px #334155)"/>`]
      }
      return []
    })
  }).join('')
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = []
  const markers = model.markers.map((marker, index) => {
    const [x, y] = pixel(marker.point), label = marker.label.length > 24 ? marker.label.slice(0, 23) + '…' : marker.label
    const width = Math.min(400, [...label].reduce((total, character) => total + (/[\u0000-\u007f]/.test(character) ? 10 : 18), 16))
    const candidates = [[x + 18, y - 32], [x + 18, y + 8], [x - width - 18, y - 32], [x - width - 18, y + 8], [x + 18, y - 64], [x + 18, y + 40]]
      .map(([left, top]) => ({ x: Math.max(4, Math.min(viewport.width - width - 4, left)), y: Math.max(4, Math.min(viewport.height - 32, top)), width, height: 28 }))
    const box = candidates.find(candidate => boxes.every(other => candidate.x + candidate.width < other.x || other.x + other.width < candidate.x || candidate.y + 28 < other.y || other.y + 28 < candidate.y)) ?? candidates[0]
    boxes.push(box)
    const color = marker.kind === 'start' ? '#059669' : marker.kind === 'end' ? '#e11d48' : '#4f46e5'
    const symbol = marker.kind === 'start' ? 'S' : marker.kind === 'end' ? 'E' : String(index + 1 - (model.markers.filter(item => item.kind !== 'waypoint').length))
    return `<g><title>${text(marker.label)}</title><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="12" fill="${color}" stroke="white" stroke-width="3"/><text x="${x.toFixed(2)}" y="${(y + 6).toFixed(2)}" fill="white" font-size="16" font-weight="bold" text-anchor="middle">${symbol}</text><rect x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" width="${width}" height="28" rx="4" fill="white" fill-opacity=".94" stroke="#94a3b8"/><text x="${(box.x + 8).toFixed(2)}" y="${(box.y + 20).toFixed(2)}" font-size="18" fill="#0f172a">${text(label)}</text></g>`
  }).join('')
  const legend = ROAD_TYPE_VISIBILITY_CATEGORIES.map(category => `<span><i style="background:${ROAD_TYPE_MAP_COLORS[category]}"></i>${ROAD_TYPE_MAP_LABELS[category]}</span>`).join('')
  return `<div class="export-map"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" role="img" aria-label="道路类型路线地图"><rect width="100%" height="100%" fill="#f1f5f9"/>${basemap ? `<image href="${basemap}" width="${viewport.width}" height="${viewport.height}" preserveAspectRatio="none"/>` : ''}${paths}${arrows}${markers}<rect x="1120" y="8" width="72" height="32" rx="4" fill="white" fill-opacity=".9"/><text x="1180" y="32" font-size="20" fill="#334155" text-anchor="end">北 ↑</text>${basemap ? '<rect x="1048" y="610" width="148" height="26" fill="white" fill-opacity=".9"/><text x="1188" y="628" font-size="16" fill="#334155" text-anchor="end">底图 © 高德地图</text>' : ''}</svg><div class="export-map-legend">${legend}<span>白色箭头：行驶方向</span></div><p class="muted">${basemap ? '底图已嵌入，可离线查看。' : `底图获取失败：${text(asset?.failure ?? '未获取底图')}。当前显示无底图路线示意图。`} 已按道路类型着色；灰色表示未分类或分类无效的路线。${model.unclassifiedSegmentCount ? ` ${model.unclassifiedSegmentCount} 条路段的分类不完整或不可用。` : ''}${model.missingRouteCount ? ` ${model.missingRouteCount} 条路段缺少匹配路线，未补画。` : ''}${model.unpositionedWaypoints.length ? ` 缺少坐标的途经点：${text(model.unpositionedWaypoints.join('、'))}。` : ''}</p></div>`
}

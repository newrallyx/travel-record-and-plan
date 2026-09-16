import type { RouteSegment } from '../types/trip'
import type { RoadAnalysisMeta, RouteRoadPart } from '../types/roadStatistics'
import { ROAD_CLASSIFIER_VERSION } from '../config/roadStatistics.ts'

const ROUTE_BUILD_VERSION = 'amap-v3-strategy-v2'

function formatCoord(lat?: number, lon?: number): string {
  if (typeof lat !== 'number' || typeof lon !== 'number') return ','
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

function buildSegmentRouteKeyParts(segment: RouteSegment): string[] {
  const waypointSignature = (segment.waypoints ?? [])
    .map((point) => {
      const lat = typeof point.lat === 'number' ? point.lat.toFixed(6) : ''
      const lng = typeof point.lng === 'number' ? point.lng.toFixed(6) : ''
      return `${point.name}|${lat},${lng}`
    })
    .join('||')

  return [
    segment.startPoint.trim(),
    segment.endPoint.trim(),
    formatCoord(segment.startCoord?.lat, segment.startCoord?.lon),
    formatCoord(segment.endCoord?.lat, segment.endCoord?.lon),
    waypointSignature,
    segment.routeType ?? 'DRIVING',
    segment.preference,
  ]
}

export function buildLegacySegmentRouteKey(segment: RouteSegment): string {
  return buildSegmentRouteKeyParts(segment).join('::')
}

export function buildSegmentRouteKey(segment: RouteSegment): string {
  return [ROUTE_BUILD_VERSION, ...buildSegmentRouteKeyParts(segment)].join('::')
}

/**
 * Legacy route geometry is still safe to display when every route-defining
 * input matches. It must not be treated as a current route for estimates,
 * because the current AMap strategy mapping may produce a different route.
 */
export function canDisplaySegmentRouteCache(segment: RouteSegment, routeBuildKey: string): boolean {
  return routeBuildKey === buildSegmentRouteKey(segment)
    || routeBuildKey === buildLegacySegmentRouteKey(segment)
}

export type RoadAnalysisFreshness = 'current' | 'stale' | 'missing'

/** 只有驾车和骑行有适用的道路 step；未来新增路线类型不能无差别纳入。 */
export function isRoadAnalysisApplicableRouteType(routeType: RouteSegment['routeType']): boolean {
  return routeType === undefined || routeType === 'DRIVING' || routeType === 'CYCLING'
}

export interface CachedRoadAnalysisCandidate {
  routeBuildKey: string
  roadParts?: readonly RouteRoadPart[]
  roadAnalysis?: RoadAnalysisMeta
}

export interface CurrentRoadAnalysisCandidate extends CachedRoadAnalysisCandidate {
  roadParts: readonly RouteRoadPart[]
  roadAnalysis: RoadAnalysisMeta & { routeBuildKey: string }
}

/**
 * 路线几何与道路分析采用不同的有效性边界：旧 key 仍可显示几何，但道路分析
 * 必须由当前完整 routeBuildKey 和当前分类规则生成，且分析元数据中的 key 必须
 * 与缓存记录一致。
 */
export function getRoadAnalysisFreshness(
  segment: RouteSegment,
  cache: CachedRoadAnalysisCandidate,
): RoadAnalysisFreshness {
  if (!Array.isArray(cache.roadParts) || cache.roadParts.length === 0 || !cache.roadAnalysis) {
    return 'missing'
  }

  const currentRouteBuildKey = buildSegmentRouteKey(segment)
  if (
    !isRoadAnalysisApplicableRouteType(segment.routeType)
    || cache.routeBuildKey !== currentRouteBuildKey
    || cache.roadAnalysis.routeBuildKey !== cache.routeBuildKey
    || cache.roadAnalysis.classifierVersion !== ROAD_CLASSIFIER_VERSION
  ) {
    return 'stale'
  }

  return 'current'
}

export function hasCurrentRoadAnalysis(
  segment: RouteSegment,
  cache: CachedRoadAnalysisCandidate,
): cache is CurrentRoadAnalysisCandidate {
  return getRoadAnalysisFreshness(segment, cache) === 'current'
}

/**
 * Whether the segment holds recorded route geometry that still matches its
 * current route-defining inputs (start/end/waypoints/preference/routeType,
 * in either current or legacy build-key format). Recorded geometry is the
 * user's original record and must never be replaced by an automatic re-plan,
 * even when duration/toll estimates are missing — only an explicit user
 * action may rebuild it.
 */
export function canReuseRecordedRoute(segment: RouteSegment): boolean {
  if (!Array.isArray(segment.points) || segment.points.length < 2) return false
  if (typeof segment.routeBuildKey !== 'string' || !segment.routeBuildKey) return false
  return canDisplaySegmentRouteCache(segment, segment.routeBuildKey)
}

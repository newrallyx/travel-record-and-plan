import type { ResolvedRoutePatch } from '../components/map/types.ts'
import type { DrivingRouteResult, PlannedRouteResponse } from './amap/types.ts'
import type { RouteCacheRecord } from './routeCacheDb.ts'
import type { CoordPoint, RouteSegment, Trip } from '../types/trip.ts'
import { buildResolvedRoutePatch } from '../components/map/resolvedRoutePatch.ts'
import { buildSegmentRouteKey, getRoadAnalysisFreshness } from '../utils/routeBuildKey.ts'
import { compareRouteGeometry, type RouteGeometryComparison } from '../utils/routeGeometryComparison.ts'
import { isProvinceSensitiveRoadPart } from '../utils/province.ts'

export const HISTORICAL_ROAD_ANALYSIS_CONCURRENCY = 2
export const HISTORICAL_ROAD_ANALYSIS_MAX_ATTEMPTS = 2

export type HistoricalRoadAnalysisScope = 'current-segment' | 'current-trip' | 'all-review'
export type HistoricalRoadAnalysisItemStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'pending'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export interface HistoricalRoadAnalysisTarget {
  tripId: string
  tripTitle: string
  segment: RouteSegment
}

export interface HistoricalRoadAnalysisItem {
  target: HistoricalRoadAnalysisTarget
  status: HistoricalRoadAnalysisItemStatus
  attempts: number
  message?: string
  comparison?: RouteGeometryComparison
  outcome?: 'analysis-only' | 'replaced'
}

export interface HistoricalRoadAnalysisProgress {
  total: number
  completed: number
  active: number
  success: number
  pending: number
  failed: number
  skipped: number
  cancelled: number
  items: HistoricalRoadAnalysisItem[]
}

export interface HistoricalRouteConflict {
  target: HistoricalRoadAnalysisTarget
  comparison: RouteGeometryComparison
  savedDistanceMeters?: number
  plannedDistanceMeters?: number
}

export type HistoricalRouteConflictDecision = 'keep' | 'replace'

interface HistoricalRoadAnalysisDependencies {
  signal: AbortSignal
  getRouteCache: (segmentId: string) => Promise<RouteCacheRecord | null>
  resolvePlace: (name: string) => Promise<{ lat: number; lng: number } | null>
  planDrivingRoute: (
    points: Array<{ lat: number; lng: number }>,
    preference: RouteSegment['preference'],
    options: { forceRefresh: true },
  ) => Promise<PlannedRouteResponse>
  planCyclingRoute?: (
    points: Array<{ lat: number; lng: number }>,
    options: { forceRefresh: true },
  ) => Promise<PlannedRouteResponse>
  saveAnalysisOnly: (params: {
    segment: RouteSegment
    cache: RouteCacheRecord | null
    routeBuildKey: string
    route: DrivingRouteResult
    savedPoints: CoordPoint[]
  }) => Promise<void>
  saveReplacement: (patch: ResolvedRoutePatch) => Promise<void>
  resolveConflict: (conflict: HistoricalRouteConflict) => Promise<HistoricalRouteConflictDecision>
  onReplacement?: (patch: ResolvedRoutePatch) => void
  onProgress?: (progress: HistoricalRoadAnalysisProgress) => void
  retryDelayMs?: number
}

function cloneProgress(items: readonly HistoricalRoadAnalysisItem[]): HistoricalRoadAnalysisProgress {
  const clonedItems = items.map((item) => ({ ...item }))
  const count = (status: HistoricalRoadAnalysisItemStatus) => clonedItems.filter((item) => item.status === status).length
  return {
    total: clonedItems.length,
    completed: clonedItems.filter((item) => ['success', 'pending', 'failed', 'skipped', 'cancelled'].includes(item.status)).length,
    active: count('running'),
    success: count('success'),
    pending: count('pending'),
    failed: count('failed'),
    skipped: count('skipped'),
    cancelled: count('cancelled'),
    items: clonedItems,
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(finish, ms)
    function finish() {
      signal.removeEventListener('abort', finish)
      globalThis.clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}

async function resolvePlanningPoints(
  segment: RouteSegment,
  resolvePlace: HistoricalRoadAnalysisDependencies['resolvePlace'],
): Promise<Array<{ lat: number; lng: number }> | null> {
  const start = segment.startCoord
    ? { lat: segment.startCoord.lat, lng: segment.startCoord.lon }
    : await resolvePlace(segment.startPoint)
  const end = segment.endCoord
    ? { lat: segment.endCoord.lat, lng: segment.endCoord.lon }
    : await resolvePlace(segment.endPoint)
  if (!start || !end) return null

  const waypoints: Array<{ lat: number; lng: number }> = []
  for (const waypoint of segment.waypoints ?? []) {
    if (typeof waypoint.lat === 'number' && typeof waypoint.lng === 'number') {
      waypoints.push({ lat: waypoint.lat, lng: waypoint.lng })
      continue
    }
    if (!waypoint.name.trim()) continue
    const resolved = await resolvePlace(waypoint.name)
    if (!resolved) return null
    waypoints.push(resolved)
  }
  return [start, ...waypoints, end]
}

function getSavedPoints(segment: RouteSegment, cache: RouteCacheRecord | null): CoordPoint[] {
  const points = cache?.points?.length ? cache.points : segment.points
  return Array.isArray(points) ? points.map((point) => ({ ...point })) : []
}

function getSavedDistance(segment: RouteSegment, cache: RouteCacheRecord | null): number | undefined {
  return typeof cache?.distanceMeters === 'number'
    ? cache.distanceMeters
    : typeof segment.distanceMeters === 'number'
      ? segment.distanceMeters
      : undefined
}

export function collectHistoricalRoadAnalysisTargets(
  trips: readonly Trip[],
  scope: HistoricalRoadAnalysisScope,
  currentTripId?: string,
  currentSegmentId?: string,
): HistoricalRoadAnalysisTarget[] {
  const reviewTrips = trips.filter((trip) => trip.category === 'review')
  const selectedTrips = scope === 'all-review'
    ? reviewTrips
    : reviewTrips.filter((trip) => trip.id === currentTripId)
  const targets: HistoricalRoadAnalysisTarget[] = []
  for (const trip of selectedTrips) {
    for (const day of trip.days) {
      for (const segment of day.routeSegments) {
        if (scope === 'current-segment' && segment.id !== currentSegmentId) continue
        targets.push({ tripId: trip.id, tripTitle: trip.title, segment })
      }
    }
  }
  return targets
}

export async function runHistoricalRoadAnalysisBatch(
  targets: readonly HistoricalRoadAnalysisTarget[],
  dependencies: HistoricalRoadAnalysisDependencies,
): Promise<HistoricalRoadAnalysisProgress> {
  const items: HistoricalRoadAnalysisItem[] = targets.map((target) => ({ target, status: 'queued', attempts: 0 }))
  let nextIndex = 0
  const emit = () => dependencies.onProgress?.(cloneProgress(items))
  emit()

  const processItem = async (item: HistoricalRoadAnalysisItem) => {
    if (dependencies.signal.aborted) {
      item.status = 'cancelled'
      item.message = '批处理已取消。'
      emit()
      return
    }
    const routeType = item.target.segment.routeType ?? 'DRIVING'
    if (routeType !== 'DRIVING' && routeType !== 'CYCLING') {
      item.status = 'skipped'
      item.message = '当前路线类型不支持道路分析。'
      emit()
      return
    }

    item.status = 'running'
    emit()
    const segment = item.target.segment
    try {
      const cache = await dependencies.getRouteCache(segment.id)
      if (cache && getRoadAnalysisFreshness(segment, cache) === 'current') {
        item.status = 'skipped'
        item.message = '已有有效道路分析。'
        emit()
        return
      }
      const planningPoints = await resolvePlanningPoints(segment, dependencies.resolvePlace)
      if (!planningPoints) throw new Error('缺少可用的起点、终点或途经点坐标。')

      let response: PlannedRouteResponse | null = null
      for (let attempt = 1; attempt <= HISTORICAL_ROAD_ANALYSIS_MAX_ATTEMPTS; attempt += 1) {
        if (dependencies.signal.aborted) break
        item.attempts = attempt
        emit()
        response = routeType === 'CYCLING'
          ? dependencies.planCyclingRoute
            ? await dependencies.planCyclingRoute(planningPoints, { forceRefresh: true })
            : { route: null, error: { message: '当前未提供骑行历史分析接口。' } }
          : await dependencies.planDrivingRoute(planningPoints, segment.preference, { forceRefresh: true })
        if (response.route && !response.error) break
        if (attempt < HISTORICAL_ROAD_ANALYSIS_MAX_ATTEMPTS) {
          await wait(dependencies.retryDelayMs ?? 500, dependencies.signal)
        }
      }

      if (dependencies.signal.aborted) {
        item.status = 'cancelled'
        item.message = '批处理已取消，未保存规划结果。'
        emit()
        return
      }
      const route = response?.route
      if (!route || response?.error || !route.roadParts?.length || !route.roadAnalysis) {
        throw new Error(response?.error?.message || '高德未返回可用的道路分析。')
      }

      const routeBuildKey = buildSegmentRouteKey(segment)
      const savedPoints = getSavedPoints(segment, cache)
      if (savedPoints.length >= 2) {
        const savedDistanceMeters = getSavedDistance(segment, cache)
        const comparison = compareRouteGeometry(
          savedPoints,
          route.polyline,
          savedDistanceMeters,
          route.distanceMeters,
        )
        item.comparison = comparison
        emit()
        if (comparison.similar) {
          await dependencies.saveAnalysisOnly({ segment, cache, routeBuildKey, route, savedPoints })
          const provincePending = route.roadParts.some((part) => (
            isProvinceSensitiveRoadPart(part) && part.provinceStatus !== 'confirmed'
          ))
          item.status = provincePending ? 'pending' : 'success'
          item.outcome = 'analysis-only'
          item.message = provincePending
            ? '轨迹相似，已保留原轨迹并补充道路分析；部分省份待确认。'
            : '轨迹相似，已保留原轨迹并补充道路分析。'
          emit()
          return
        }

        const decision = await dependencies.resolveConflict({
          target: item.target,
          comparison,
          savedDistanceMeters,
          plannedDistanceMeters: route.distanceMeters,
        })
        if (dependencies.signal.aborted) {
          item.status = 'cancelled'
          item.message = '批处理已取消，未保存规划结果。'
          emit()
          return
        }
        if (decision === 'keep') {
          item.status = 'skipped'
          item.message = '路线差异较大，已按选择保留原轨迹。'
          emit()
          return
        }
      }

      const patch = buildResolvedRoutePatch({ segmentId: segment.id, routeBuildKey, routeType, route })
      await dependencies.saveReplacement(patch)
      dependencies.onReplacement?.(patch)
      const provincePending = route.roadParts.some((part) => (
        isProvinceSensitiveRoadPart(part) && part.provinceStatus !== 'confirmed'
      ))
      item.status = provincePending ? 'pending' : 'success'
      item.outcome = 'replaced'
      item.message = provincePending
        ? '已保存道路分析，但部分省份待确认。'
        : savedPoints.length >= 2 ? '已按选择明确替换原轨迹。' : '没有已保存轨迹，已保存规划结果。'
      emit()
    } catch (error) {
      if (dependencies.signal.aborted) {
        item.status = 'cancelled'
        item.message = '批处理已取消。'
      } else {
        item.status = 'failed'
        item.message = (error as Error).message || '道路分析失败。'
      }
      emit()
    }
  }

  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await processItem(item)
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(HISTORICAL_ROAD_ANALYSIS_CONCURRENCY, Math.max(1, items.length)) },
    worker,
  ))
  const result = cloneProgress(items)
  dependencies.onProgress?.(result)
  return result
}

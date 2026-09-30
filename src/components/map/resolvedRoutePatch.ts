import type { DrivingRouteResult } from '../../services/amap.ts'
import type { RouteType } from '../../types/trip.ts'
import type { ResolvedRoutePatch } from './types.ts'

interface BuildResolvedRoutePatchParams {
  segmentId: string
  routeBuildKey: string
  routeType: RouteType
  route: DrivingRouteResult
}

/**
 * 将一次规划结果完整封装为下游唯一的数据载体。道路分析只属于驾车路线；
 * 骑行规划会显式省略这些字段，避免复用同路段旧的驾车分析。
 */
export function buildResolvedRoutePatch({
  segmentId,
  routeBuildKey,
  routeType,
  route,
}: BuildResolvedRoutePatchParams): ResolvedRoutePatch {
  return {
    segmentId,
    points: route.polyline.map(([lat, lng]) => ({ lat, lon: lng })),
    distanceMeters: typeof route.distanceMeters === 'number' ? route.distanceMeters : null,
    estimatedDurationSeconds:
      typeof route.durationSeconds === 'number' ? route.durationSeconds : null,
    durationUpdatedAt: route.durationUpdatedAt,
    estimatedTollYuan:
      routeType === 'DRIVING' && typeof route.estimatedTollYuan === 'number'
        ? route.estimatedTollYuan
        : null,
    tollDistanceMeters:
      routeType === 'DRIVING' && typeof route.tollDistanceMeters === 'number'
        ? route.tollDistanceMeters
        : null,
    tollUpdatedAt: routeType === 'DRIVING' ? route.tollUpdatedAt : undefined,
    routeBuildKey,
    // 骑行路线也可以有 AMap steps 道路证据；收费字段仍只对驾车保留。
    roadParts: route.roadParts,
    roadAnalysis: route.roadAnalysis,
  }
}

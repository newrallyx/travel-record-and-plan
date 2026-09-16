import {
  ROAD_CLASSIFIER_VERSION,
  ROAD_DISTANCE_TOLERANCE_MIN_METERS,
  ROAD_DISTANCE_TOLERANCE_RATIO,
} from '../config/roadStatistics.ts'
import {
  ROAD_ANALYSIS_SCHEMA_VERSION,
  type RoadAnalysisMeta,
  type RouteRoadPart,
} from '../types/roadStatistics.ts'
import { mergeAdjacentRoadParts } from './roadClassifier.ts'

export interface RouteRoadAnalysisResult {
  roadParts: RouteRoadPart[]
  meta: RoadAnalysisMeta
}

function isNonNegativeFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 合并并评估一次路线道路分析。所有有效 step 里程都计入 coverage，
 * 包括道路名称缺失或分类为 UNKNOWN 的片段。
 */
export function buildRouteRoadAnalysis(
  unmergedParts: readonly RouteRoadPart[],
  routeDistanceMeters: number | undefined,
  analyzedAt: string,
  routeBuildKey?: string,
): RouteRoadAnalysisResult {
  const roadParts = mergeAdjacentRoadParts(unmergedParts)
  const coverageMeters = roadParts.reduce((sum, part) => (
    isNonNegativeFinite(part.distanceMeters) ? sum + part.distanceMeters : sum
  ), 0)
  const hasRouteDistance = isNonNegativeFinite(routeDistanceMeters)
  const distanceToleranceMeters = hasRouteDistance
    ? Math.max(ROAD_DISTANCE_TOLERANCE_MIN_METERS, routeDistanceMeters * ROAD_DISTANCE_TOLERANCE_RATIO)
    : undefined
  const distanceErrorMeters = hasRouteDistance
    ? Math.abs(coverageMeters - routeDistanceMeters)
    : undefined
  const coverageRatio = hasRouteDistance
    ? routeDistanceMeters === 0
      ? (coverageMeters === 0 ? 1 : 0)
      : Math.min(1, coverageMeters / routeDistanceMeters)
    : undefined
  const status = roadParts.length > 0
    && distanceErrorMeters !== undefined
    && distanceToleranceMeters !== undefined
    && distanceErrorMeters <= distanceToleranceMeters
    ? 'complete'
    : 'partial'

  return {
    roadParts,
    meta: {
      schemaVersion: ROAD_ANALYSIS_SCHEMA_VERSION,
      classifierVersion: ROAD_CLASSIFIER_VERSION,
      analyzedAt,
      ...(routeBuildKey ? { routeBuildKey } : {}),
      coverageMeters,
      ...(hasRouteDistance ? { routeDistanceMeters } : {}),
      ...(coverageRatio !== undefined ? { coverageRatio } : {}),
      ...(distanceErrorMeters !== undefined ? { distanceErrorMeters } : {}),
      ...(distanceToleranceMeters !== undefined ? { distanceToleranceMeters } : {}),
      status,
    },
  }
}

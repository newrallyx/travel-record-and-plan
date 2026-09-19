import type {
  ManualRoadIntervalAnnotation,
  RouteRoadPart,
} from '../types/roadStatistics.ts'
import type { CoordPoint } from '../types/trip.ts'
import { calcPolylineDistanceMeters } from './distance.ts'
import { isProvinceSensitiveRoadPart, provinceNameFromCode } from './province.ts'

export interface ManualRoadAnnotationBuildInput {
  points: readonly CoordPoint[]
  totalDistanceMeters?: number
  baseRoadParts: readonly RouteRoadPart[]
  annotations: readonly ManualRoadIntervalAnnotation[]
}

export interface ManualRoadAnnotationBuildResult {
  roadParts: RouteRoadPart[]
  totalDistanceMeters: number
  distanceSource: 'RECORDED_ALLOCATION' | 'GEOMETRY_ESTIMATE'
}

interface RatioInterval {
  start: number
  end: number
  part?: RouteRoadPart
  annotation?: ManualRoadIntervalAnnotation
}

function clampIndex(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, Math.round(value)))
}

function getGeometryRatios(points: readonly CoordPoint[], startIndex: number, endIndex: number): [number, number] {
  const geometryDistance = calcPolylineDistanceMeters([...points])
  if (!geometryDistance || geometryDistance <= 0) {
    const denominator = Math.max(1, points.length - 1)
    return [clampIndex(startIndex, denominator) / denominator, clampIndex(endIndex, denominator) / denominator]
  }

  const cumulative: number[] = [0]
  // Keep this geometric cumulative distance independent of the recorded route mileage.
  let running = 0
  for (let index = 1; index < points.length; index += 1) {
    running += calcPolylineDistanceMeters([points[index - 1], points[index]]) ?? 0
    cumulative[index] = running
  }
  const start = cumulative[clampIndex(startIndex, points.length - 1)] / geometryDistance
  const end = cumulative[clampIndex(endIndex, points.length - 1)] / geometryDistance
  return [Math.min(start, end), Math.max(start, end)]
}

function slicePolyline(points: readonly CoordPoint[], startRatio: number, endRatio: number): Array<[number, number]> | undefined {
  if (points.length < 2) return undefined
  const cumulative: number[] = [0]
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + (calcPolylineDistanceMeters([points[index - 1], points[index]]) ?? 0))
  }
  const total = cumulative[cumulative.length - 1]
  if (total <= 0) return points.map((point) => [point.lat, point.lon])
  const startDistance = total * Math.max(0, Math.min(1, startRatio))
  const endDistance = total * Math.max(0, Math.min(1, endRatio))
  const pointAt = (target: number): [number, number] => {
    for (let index = 1; index < cumulative.length; index += 1) {
      if (cumulative[index] < target) continue
      const previous = points[index - 1]
      const next = points[index]
      const span = cumulative[index] - cumulative[index - 1]
      const ratio = span > 0 ? (target - cumulative[index - 1]) / span : 0
      return [previous.lat + (next.lat - previous.lat) * ratio, previous.lon + (next.lon - previous.lon) * ratio]
    }
    const last = points[points.length - 1]
    return [last.lat, last.lon]
  }
  const result: Array<[number, number]> = [pointAt(startDistance)]
  for (let index = 1; index < points.length - 1; index += 1) {
    const ratio = cumulative[index] / total
    if (ratio > startRatio && ratio < endRatio) result.push([points[index].lat, points[index].lon])
  }
  result.push(pointAt(endDistance))
  return result.length >= 2 ? result : undefined
}

function buildBaseIntervals(baseRoadParts: readonly RouteRoadPart[]): RatioInterval[] {
  const total = baseRoadParts.reduce((sum, part) => sum + Math.max(0, part.distanceMeters), 0)
  if (total <= 0) return []
  let cursor = 0
  return baseRoadParts.flatMap((part) => {
    const distance = Math.max(0, part.distanceMeters)
    if (distance <= 0) return []
    const start = cursor / total
    cursor += distance
    return [{ start, end: cursor / total, part }]
  })
}

function annotationInterval(
  points: readonly CoordPoint[],
  annotation: ManualRoadIntervalAnnotation,
): RatioInterval {
  const [start, end] = getGeometryRatios(points, annotation.startPointIndex, annotation.endPointIndex)
  return { start, end, annotation }
}

function collectBoundaries(intervals: readonly RatioInterval[]): number[] {
  return [...new Set([0, 1, ...intervals.flatMap((interval) => [interval.start, interval.end])])]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
}

function copyPartForInterval(
  part: RouteRoadPart,
  start: number,
  end: number,
  points: readonly CoordPoint[],
  distanceMeters: number,
  distanceSource: ManualRoadAnnotationBuildResult['distanceSource'],
): RouteRoadPart {
  return {
    ...part,
    distanceMeters,
    distanceSource,
    ...(slicePolyline(points, start, end) ? { polyline: slicePolyline(points, start, end) } : {}),
  }
}

function buildManualPart(
  annotation: ManualRoadIntervalAnnotation,
  start: number,
  end: number,
  points: readonly CoordPoint[],
  distanceMeters: number,
  distanceSource: ManualRoadAnnotationBuildResult['distanceSource'],
): RouteRoadPart {
  const roadClass = annotation.roadClass
  const provinceSensitive = isProvinceSensitiveRoadPart({ roadClass, routeRef: annotation.routeRef })
  return {
    roadClass,
    ...(annotation.routeRef ? { routeRef: annotation.routeRef } : {}),
    confidence: 'HIGH',
    source: 'MANUAL',
    distanceMeters,
    distanceSource: annotation.distanceSource ?? distanceSource,
    ...(provinceSensitive
      ? {
          ...(annotation.provinceCode ? { provinceCode: annotation.provinceCode } : {}),
          ...(annotation.provinceName
            ? { provinceName: annotation.provinceName }
            : annotation.provinceCode ? { provinceName: provinceNameFromCode(annotation.provinceCode) } : {}),
          provinceSource: annotation.provinceSource ?? 'MANUAL',
          provinceStatus: annotation.provinceCode ? 'confirmed' as const : 'pending' as const,
        }
      : {}),
    ...(slicePolyline(points, start, end) ? { polyline: slicePolyline(points, start, end) } : {}),
  }
}

export function findOverlappingManualRoadAnnotations(
  annotations: readonly ManualRoadIntervalAnnotation[],
): ManualRoadIntervalAnnotation[] {
  const ordered = [...annotations].sort((left, right) => left.startPointIndex - right.startPointIndex)
  return ordered.filter((annotation, index) => {
    const previous = ordered[index - 1]
    return Boolean(previous && previous.endPointIndex > annotation.startPointIndex)
  })
}

export function getManualRoadAnnotationDistanceMeters(
  points: readonly CoordPoint[],
  totalDistanceMeters: number,
  annotation: ManualRoadIntervalAnnotation,
): number {
  const [start, end] = getGeometryRatios(points, annotation.startPointIndex, annotation.endPointIndex)
  return Math.max(0, totalDistanceMeters * (end - start))
}

/** 以折线比例切分道路分析，所有输出区间互斥且距离和严格保持总里程。 */
export function buildManualRoadAnnotationParts(input: ManualRoadAnnotationBuildInput): ManualRoadAnnotationBuildResult {
  if (input.points.length < 2) throw new Error('缺少至少两个轨迹点，无法标注道路区间。')
  const annotations = [...input.annotations]
  if (findOverlappingManualRoadAnnotations(annotations).length) throw new Error('道路标注区间不能重叠。')
  const geometryDistance = calcPolylineDistanceMeters([...input.points])
  const totalDistanceMeters = typeof input.totalDistanceMeters === 'number' && Number.isFinite(input.totalDistanceMeters) && input.totalDistanceMeters >= 0
    ? input.totalDistanceMeters
    : geometryDistance ?? 0
  const distanceSource: ManualRoadAnnotationBuildResult['distanceSource'] = input.totalDistanceMeters !== undefined
    ? 'RECORDED_ALLOCATION'
    : 'GEOMETRY_ESTIMATE'
  const annotationIntervals = annotations.map((annotation) => annotationInterval(input.points, annotation))
  const intervals = [...buildBaseIntervals(input.baseRoadParts), ...annotationIntervals]
  const boundaries = collectBoundaries(intervals)
  const parts: RouteRoadPart[] = []
  let usedDistance = 0
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1]
    const end = boundaries[index]
    if (end - start <= 1e-9) continue
    const middle = (start + end) / 2
    const annotation = annotationIntervals.find((candidate) => middle >= candidate.start && middle <= candidate.end)?.annotation
    const base = buildBaseIntervals(input.baseRoadParts).find((candidate) => middle >= candidate.start && middle <= candidate.end)?.part
    const isLast = index === boundaries.length - 1
    const distanceMeters = isLast ? Math.max(0, totalDistanceMeters - usedDistance) : totalDistanceMeters * (end - start)
    usedDistance += distanceMeters
    if (annotation) {
      parts.push(buildManualPart(annotation, start, end, input.points, distanceMeters, distanceSource))
    } else if (base) {
      parts.push(copyPartForInterval(base, start, end, input.points, distanceMeters, distanceSource))
    } else {
      parts.push({
        roadClass: 'UNKNOWN',
        confidence: 'LOW',
        source: 'FALLBACK',
        distanceMeters,
        distanceSource,
        polyline: slicePolyline(input.points, start, end),
      })
    }
  }
  return { roadParts: parts, totalDistanceMeters, distanceSource }
}

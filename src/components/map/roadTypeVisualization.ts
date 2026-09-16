import { ROAD_CLASS_COLORS } from '../../config/roadStatistics.ts'
import type { RoadClass, RouteRoadPart } from '../../types/roadStatistics.ts'
import type { RouteSegment, Trip } from '../../types/trip.ts'
import type { RouteCacheRecord } from '../../services/routeCacheDb.ts'
import { getRoadAnalysisFreshness } from '../../utils/routeBuildKey.ts'
import type { SegmentTrack } from './types.ts'

/** 地图道路类型着色只显示四个稳定的大类；UNKNOWN 单独记为待核实。 */
export const ROAD_TYPE_MAP_CATEGORIES = [
  'EXPRESSWAY',
  'NATIONAL_ROAD',
  'PROVINCIAL_ROAD',
  'OTHER',
] as const

export type RoadTypeMapCategory = (typeof ROAD_TYPE_MAP_CATEGORIES)[number]

export type RoadTypeVisibility = Record<RoadTypeMapCategory, boolean>

export const DEFAULT_ROAD_TYPE_VISIBILITY: RoadTypeVisibility = {
  EXPRESSWAY: true,
  NATIONAL_ROAD: true,
  PROVINCIAL_ROAD: true,
  OTHER: true,
}

export const ROAD_TYPE_MAP_LABELS: Readonly<Record<RoadTypeMapCategory, string>> = {
  EXPRESSWAY: '高速公路',
  NATIONAL_ROAD: '国道',
  PROVINCIAL_ROAD: '省道',
  OTHER: '其他道路',
}

/** 使用配置层的固定颜色，避免同一道路在地图和统计中出现颜色漂移。 */
export const ROAD_TYPE_MAP_COLORS: Readonly<Record<RoadTypeMapCategory, string>> = {
  EXPRESSWAY: ROAD_CLASS_COLORS.EXPRESSWAY,
  NATIONAL_ROAD: ROAD_CLASS_COLORS.NATIONAL_ROAD,
  PROVINCIAL_ROAD: ROAD_CLASS_COLORS.PROVINCIAL_ROAD,
  OTHER: ROAD_CLASS_COLORS.OTHER,
}

export const UNVERIFIED_ROAD_TYPE_COLOR = ROAD_CLASS_COLORS.UNKNOWN

export const OVERVIEW_MAX_ROAD_POLYLINES_PER_SEGMENT = 80

export interface RoadTypeDistanceTotals {
  distances: Record<RoadTypeMapCategory, number>
  unverifiedMeters: number
}

export interface RoadTypeLegendData {
  current: RoadTypeDistanceTotals
  historical: RoadTypeDistanceTotals
  showCurrent: boolean
}

export interface RenderableRoadPart {
  sourceIndex: number
  roadClass: RoadClass
  positions: Array<[number, number]>
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isNonNegativeFiniteNumber(value) && value > 0
}

function isPolyline(point: unknown): point is [number, number] {
  return Array.isArray(point)
    && point.length === 2
    && typeof point[0] === 'number'
    && Number.isFinite(point[0])
    && typeof point[1] === 'number'
    && Number.isFinite(point[1])
}

function createRoadTypeDistanceTotals(): RoadTypeDistanceTotals {
  return {
    distances: {
      EXPRESSWAY: 0,
      NATIONAL_ROAD: 0,
      PROVINCIAL_ROAD: 0,
      OTHER: 0,
    },
    unverifiedMeters: 0,
  }
}

export function getRoadTypeMapCategory(roadClass: RoadClass): RoadTypeMapCategory | null {
  if (roadClass === 'EXPRESSWAY' || roadClass === 'NATIONAL_ROAD' || roadClass === 'PROVINCIAL_ROAD') {
    return roadClass
  }
  if (roadClass === 'UNKNOWN') return null
  return 'OTHER'
}

export function roadTypeColorForClass(roadClass: RoadClass): string {
  const category = getRoadTypeMapCategory(roadClass)
  return category ? ROAD_TYPE_MAP_COLORS[category] : UNVERIFIED_ROAD_TYPE_COLOR
}

function addRoadParts(totals: RoadTypeDistanceTotals, roadParts: readonly RouteRoadPart[]): number {
  let coverageMeters = 0
  for (const part of roadParts) {
    if (!isNonNegativeFiniteNumber(part.distanceMeters)) continue
    coverageMeters += part.distanceMeters
    const category = getRoadTypeMapCategory(part.roadClass)
    if (category) totals.distances[category] += part.distanceMeters
    else totals.unverifiedMeters += part.distanceMeters
  }
  return coverageMeters
}

function addUncoveredDistance(
  totals: RoadTypeDistanceTotals,
  expectedDistanceMeters: number | undefined,
  coverageMeters: number,
): void {
  if (!isPositiveFiniteNumber(expectedDistanceMeters)) return
  const uncoveredMeters = expectedDistanceMeters - coverageMeters
  if (uncoveredMeters > 0) totals.unverifiedMeters += uncoveredMeters
}

function getSegmentDistanceMeters(segment: RouteSegment, fallback?: number): number | undefined {
  if (isPositiveFiniteNumber(fallback)) return fallback
  return isPositiveFiniteNumber(segment.distanceMeters) ? segment.distanceMeters : undefined
}

/** 当前筛选范围：道路片段缺失、过期或未覆盖的里程都明确暴露为待核实。 */
export function summarizeCurrentRoadTypeDistances(
  tracks: readonly SegmentTrack[],
  segments: readonly RouteSegment[],
): RoadTypeDistanceTotals {
  const totals = createRoadTypeDistanceTotals()
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]))

  for (const track of tracks) {
    const segment = segmentMap.get(track.segmentId)
    if (!segment || !['DRIVING', 'CYCLING'].includes(segment.routeType ?? 'DRIVING')) continue

    const expectedDistanceMeters = getSegmentDistanceMeters(segment, track.distanceMeters)
    if (!track.roadParts?.length) {
      if (expectedDistanceMeters) totals.unverifiedMeters += expectedDistanceMeters
      continue
    }

    const coverageMeters = addRoadParts(totals, track.roadParts)
    const analysisDistance = track.roadAnalysis?.routeDistanceMeters
    addUncoveredDistance(totals, getSegmentDistanceMeters(segment, analysisDistance ?? expectedDistanceMeters), coverageMeters)
  }

  return totals
}

/**
  * 历史累计只统计 review 旅程。驾车和骑行道路分类必须对当前路线输入仍有效；否则其整段
 * 里程转入待核实，不把旧路线的分类误计入累计。
 */
export function summarizeHistoricalRoadTypeDistances(
  trips: readonly Trip[],
  routeCaches: readonly RouteCacheRecord[],
): RoadTypeDistanceTotals {
  const totals = createRoadTypeDistanceTotals()
  const cacheMap = new Map(routeCaches.map((cache) => [cache.segmentId, cache]))

  for (const trip of trips) {
    if (trip.category !== 'review') continue
    for (const day of trip.days) {
      for (const segment of day.routeSegments) {
        if (!['DRIVING', 'CYCLING'].includes(segment.routeType ?? 'DRIVING')) continue
        const cache = cacheMap.get(segment.id)
        const fallbackDistanceMeters = getSegmentDistanceMeters(segment, cache?.distanceMeters)
        if (!cache || getRoadAnalysisFreshness(segment, cache) !== 'current' || !cache.roadParts?.length) {
          if (fallbackDistanceMeters) totals.unverifiedMeters += fallbackDistanceMeters
          continue
        }

        const coverageMeters = addRoadParts(totals, cache.roadParts)
        const analysisDistance = cache.roadAnalysis?.routeDistanceMeters
        addUncoveredDistance(
          totals,
          getSegmentDistanceMeters(segment, analysisDistance ?? cache.distanceMeters),
          coverageMeters,
        )
      }
    }
  }

  return totals
}

function downsamplePolyline(points: readonly [number, number][], targetSize: number): Array<[number, number]> {
  if (points.length <= targetSize || targetSize < 2) return points.map((point) => [...point] as [number, number])
  const step = (points.length - 1) / (targetSize - 1)
  const sampled: Array<[number, number]> = []
  for (let index = 0; index < targetSize; index += 1) {
    const sourceIndex = index === targetSize - 1 ? points.length - 1 : Math.round(index * step)
    sampled.push([...points[sourceIndex]] as [number, number])
  }
  return sampled
}

function selectOverviewPartIndices(totalCount: number, maximumPartCount: number): number[] {
  if (totalCount <= maximumPartCount) return Array.from({ length: totalCount }, (_value, index) => index)
  return Array.from({ length: maximumPartCount }, (_value, index) => (
    index === maximumPartCount - 1
      ? totalCount - 1
      : Math.round((index * (totalCount - 1)) / (maximumPartCount - 1))
  ))
}

/**
 * 详细视图逐个保留道路片段；概览视图按原顺序等距选择片段，并把总点数控制在预算内。
 * 选择而非拼接不同片段可避免 Leaflet 在两个不连续道路片段之间错误画出直线。
 */
export function getRenderableRoadParts(
  roadParts: readonly RouteRoadPart[] | undefined,
  options: {
    isOverviewMode: boolean
    maximumPoints: number
    maximumPartCount?: number
  },
): RenderableRoadPart[] {
  if (!roadParts?.length) return []

  const validParts: RenderableRoadPart[] = []
  roadParts.forEach((part, sourceIndex) => {
    // 高德可能返回 0 米、单坐标的导航步骤；只跳过该片段，不能使整条路线失去着色。
    if (!part.polyline || part.polyline.length < 2 || !part.polyline.every(isPolyline)) return null
    validParts.push({
      sourceIndex,
      roadClass: part.roadClass,
      positions: part.polyline.map((point) => [...point] as [number, number]),
    })
  })
  if (!options.isOverviewMode) return validParts

  const maximumPartCount = options.maximumPartCount ?? OVERVIEW_MAX_ROAD_POLYLINES_PER_SEGMENT
  const selectedParts = selectOverviewPartIndices(validParts.length, maximumPartCount).map((index) => validParts[index])
  const originalPointCount = selectedParts.reduce((sum, part) => sum + part.positions.length, 0)
  if (originalPointCount <= options.maximumPoints) return selectedParts

  const minimumPointCount = selectedParts.length * 2
  const availableExtraPoints = Math.max(0, options.maximumPoints - minimumPointCount)
  const originalExtraPoints = selectedParts.reduce((sum, part) => sum + Math.max(0, part.positions.length - 2), 0)
  if (originalExtraPoints === 0) return selectedParts

  const allocations = selectedParts.map((part, index) => {
    const extra = part.positions.length - 2
    const exactExtra = (extra / originalExtraPoints) * availableExtraPoints
    return { index, targetSize: 2 + Math.floor(exactExtra), remainder: exactExtra - Math.floor(exactExtra) }
  })
  let remainingPoints = Math.max(0, options.maximumPoints - allocations.reduce((sum, item) => sum + item.targetSize, 0))
  for (const allocation of [...allocations].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remainingPoints <= 0) break
    if (allocation.targetSize < selectedParts[allocation.index].positions.length) {
      allocation.targetSize += 1
      remainingPoints -= 1
    }
  }

  return selectedParts.map((part, index) => ({
    ...part,
    positions: downsamplePolyline(part.positions, allocations[index].targetSize),
  }))
}

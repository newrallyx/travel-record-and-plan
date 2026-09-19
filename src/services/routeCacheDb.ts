import {
  ROAD_ANALYSIS_SCHEMA_VERSION,
  type ManualRoadIntervalAnnotation,
  type RoadAnalysisMeta,
  type RoadClass,
  type RoadClassificationConfidence,
  type RoadClassificationSource,
  type RoadDistanceSource,
  type RoadProvinceSource,
  type RoadProvinceStatus,
  type RouteRoadPart,
} from '../types/roadStatistics.ts'
import type { CoordPoint } from '../types/trip'
import { ROAD_CLASSIFIER_VERSION } from '../config/roadStatistics.ts'
import {
  extractRouteRef,
  mergeAdjacentRoadParts,
  normalizeRoadText,
  reclassifyRoadParts,
  restoreAutomaticRoadPartClassification,
} from '../utils/roadClassifier.ts'
import { isProvinceSensitiveRoadPart, normalizeProvinceCode, provinceNameFromCode } from '../utils/province.ts'
import { buildRouteRoadAnalysis } from '../utils/roadAnalysis.ts'
import {
  buildManualRoadAnnotationParts,
  findOverlappingManualRoadAnnotations,
  getManualRoadAnnotationDistanceMeters,
} from '../utils/manualRoadAnnotations.ts'
import { buildSegmentRouteKey } from '../utils/routeBuildKey.ts'
import { getTrackDistanceMeters } from '../utils/distance.ts'
import type { DrivingRouteResult } from './amap/types.ts'
import type { RouteSegment } from '../types/trip.ts'
import type { ResolvedRoutePatch } from '../components/map/types.ts'

export const ROUTE_CACHE_DB_NAME = 'trip-route-cache'
export const ROUTE_CACHE_DB_VERSION = 2
export const ROUTE_CACHE_STORE_NAME = 'segmentRoutes'

export interface RouteCacheRecord {
  segmentId: string
  routeBuildKey: string
  points: CoordPoint[]
  updatedAt: number
  distanceMeters?: number
  estimatedDurationSeconds?: number
  durationUpdatedAt?: string
  estimatedTollYuan?: number
  tollDistanceMeters?: number
  tollUpdatedAt?: string
  roadParts?: RouteRoadPart[]
  roadAnalysis?: RoadAnalysisMeta
  manualRoadAnnotations?: ManualRoadIntervalAnnotation[]
  roadAnnotationBaseParts?: RouteRoadPart[]
  roadAnnotationBaseAnalysis?: RoadAnalysisMeta
}

interface SaveSegmentRouteGeometryParams {
  segmentId: string
  routeBuildKey: string
  points: CoordPoint[]
}

interface SavePlannedSegmentRouteCacheParams extends SaveSegmentRouteGeometryParams {
  distanceMeters?: number | null
  estimatedDurationSeconds?: number | null
  durationUpdatedAt?: string
  estimatedTollYuan?: number | null
  tollDistanceMeters?: number | null
  tollUpdatedAt?: string
  roadParts?: RouteRoadPart[]
  roadAnalysis?: RoadAnalysisMeta
}

interface ManualRoadPartCorrection {
  roadClass: RoadClass
  routeRef?: string
  provinceCode?: string
  provinceName?: string
}

export interface ManualRoadIntervalAnnotationInput {
  segment: RouteSegment
  startPointIndex: number
  endPointIndex: number
  roadClass: RoadClass
  routeRef?: string
  provinceCode?: string
  provinceName?: string
  annotationId?: string
}

const ROAD_CLASSES = new Set<RoadClass>([
  'EXPRESSWAY',
  'NATIONAL_ROAD',
  'PROVINCIAL_ROAD',
  'COUNTY_ROAD',
  'TOWNSHIP_ROAD',
  'VILLAGE_ROAD',
  'URBAN_ROAD',
  'OTHER',
  'UNKNOWN',
])
const ROAD_CONFIDENCES = new Set<RoadClassificationConfidence>(['HIGH', 'MEDIUM', 'LOW'])
const ROAD_SOURCES = new Set<RoadClassificationSource>([
  'MANUAL',
  'ROAD_CODE',
  'ROAD_NAME',
  'ROAD_TYPE',
  'MIXED',
  'FALLBACK',
])
const ROAD_DISTANCE_SOURCES = new Set<RoadDistanceSource>([
  'NAVIGATION',
  'RECORDED_ALLOCATION',
  'GEOMETRY_ESTIMATE',
  'MANUAL',
])
const ROAD_PROVINCE_SOURCES = new Set<RoadProvinceSource>([
  'NAVIGATION',
  'POLYLINE_GEOCODE',
  'MANUAL',
  'ESTIMATED_SPLIT',
  'UNKNOWN',
])
const ROAD_PROVINCE_STATUSES = new Set<RoadProvinceStatus>(['confirmed', 'pending'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  const timestamp = normalizeOptionalString(value)
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : undefined
}

function normalizeCoordPoint(value: unknown): CoordPoint | undefined {
  if (!isRecord(value)) return undefined

  const lat = value.lat
  const lon = value.lon
  if (
    typeof lat !== 'number'
    || !Number.isFinite(lat)
    || lat < -90
    || lat > 90
    || typeof lon !== 'number'
    || !Number.isFinite(lon)
    || lon < -180
    || lon > 180
  ) {
    return undefined
  }

  const timestamp = normalizeOptionalString(value.timestamp)
  return {
    lat,
    lon,
    ...(timestamp ? { timestamp } : {}),
  }
}

export function normalizeCoordPointArray(value: unknown): CoordPoint[] | undefined {
  if (!Array.isArray(value)) return undefined

  const points = value
    .map((item) => normalizeCoordPoint(item))
    .filter((point): point is CoordPoint => Boolean(point))
  return points.length ? points : undefined
}

function normalizeRoadPolyline(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined

  const polyline = value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) return undefined
    const [lat, lng] = point
    if (
      typeof lat !== 'number'
      || !Number.isFinite(lat)
      || lat < -90
      || lat > 90
      || typeof lng !== 'number'
      || !Number.isFinite(lng)
      || lng < -180
      || lng > 180
    ) {
      return undefined
    }
    return [lat, lng] as [number, number]
  })

  if (polyline.some((point) => !point)) return undefined
  return polyline as Array<[number, number]>
}

function normalizeProvinceFields(
  value: Record<string, unknown>,
  roadClass: RoadClass,
  routeRef: string | undefined,
): Pick<RouteRoadPart, 'provinceCode' | 'provinceName' | 'provinceSource' | 'provinceStatus' | 'provinceCandidates'> {
  if (!isProvinceSensitiveRoadPart({ roadClass, routeRef })) return {}
  const provinceCode = normalizeProvinceCode(value.provinceCode)
  const provinceCandidates = Array.isArray(value.provinceCandidates)
    ? [...new Set(value.provinceCandidates.map(normalizeProvinceCode).filter(Boolean) as string[])].sort()
    : []
  const provinceStatus = ROAD_PROVINCE_STATUSES.has(value.provinceStatus as RoadProvinceStatus)
    ? value.provinceStatus as RoadProvinceStatus
    : provinceCode
      ? 'confirmed' as const
      : 'pending' as const
  const provinceSource = ROAD_PROVINCE_SOURCES.has(value.provinceSource as RoadProvinceSource)
    ? value.provinceSource as RoadProvinceSource
    : 'UNKNOWN' as const
  return {
    ...(provinceCode ? { provinceCode } : {}),
    ...(provinceCode ? { provinceName: normalizeOptionalString(value.provinceName) ?? provinceNameFromCode(provinceCode) } : {}),
    provinceSource,
    provinceStatus,
    ...(provinceCandidates.length ? { provinceCandidates } : {}),
  }
}

function normalizeRoadPart(value: unknown): RouteRoadPart | undefined {
  if (!isRecord(value)) return undefined
  if (!ROAD_CLASSES.has(value.roadClass as RoadClass)) return undefined
  if (!ROAD_CONFIDENCES.has(value.confidence as RoadClassificationConfidence)) return undefined
  if (!ROAD_SOURCES.has(value.source as RoadClassificationSource)) return undefined

  const distanceMeters = normalizeNonNegativeNumber(value.distanceMeters)
  if (distanceMeters === undefined) return undefined

  const roadName = normalizeRoadText(value.roadName) || undefined
  const routeRef = extractRouteRef(value.routeRef)
  const tollRoad = normalizeRoadText(value.tollRoad) || undefined
  const instruction = normalizeOptionalString(value.instruction)
  const polyline = value.polyline === undefined ? undefined : normalizeRoadPolyline(value.polyline)
  if (value.polyline !== undefined && polyline === undefined) return undefined
  const distanceSource = ROAD_DISTANCE_SOURCES.has(value.distanceSource as RoadDistanceSource)
    ? value.distanceSource as RoadDistanceSource
    : undefined
  const provinceFields = normalizeProvinceFields(value, value.roadClass as RoadClass, routeRef)

  return {
    roadClass: value.roadClass as RoadClass,
    distanceMeters,
    ...(distanceSource ? { distanceSource } : {}),
    confidence: value.confidence as RoadClassificationConfidence,
    source: value.source as RoadClassificationSource,
    ...(roadName ? { roadName } : {}),
    ...(routeRef ? { routeRef } : {}),
    ...(tollRoad ? { tollRoad } : {}),
    ...(instruction ? { instruction } : {}),
    ...(polyline ? { polyline } : {}),
    ...provinceFields,
  }
}

function normalizeRoadPartArray(value: unknown): RouteRoadPart[] | undefined {
  if (!Array.isArray(value)) return undefined
  const roadParts = value.map((item) => normalizeRoadPart(item))
  if (roadParts.some((part) => !part)) return undefined
  return roadParts as RouteRoadPart[]
}

function normalizeManualRoadAnnotation(value: unknown): ManualRoadIntervalAnnotation | undefined {
  if (!isRecord(value)) return undefined
  if (!ROAD_CLASSES.has(value.roadClass as RoadClass)) return undefined
  const startPointIndex = typeof value.startPointIndex === 'number' ? value.startPointIndex : NaN
  const endPointIndex = typeof value.endPointIndex === 'number' ? value.endPointIndex : NaN
  const distanceMeters = normalizeNonNegativeNumber(value.distanceMeters)
  const createdAt = normalizeOptionalTimestamp(value.createdAt)
  const updatedAt = normalizeOptionalTimestamp(value.updatedAt)
  const routeRef = extractRouteRef(value.routeRef)
  const distanceSource = value.distanceSource === 'RECORDED_ALLOCATION' || value.distanceSource === 'GEOMETRY_ESTIMATE'
    ? value.distanceSource
    : undefined
  if (
    !Number.isInteger(startPointIndex)
    || !Number.isInteger(endPointIndex)
    || startPointIndex < 0
    || endPointIndex <= startPointIndex
    || distanceMeters === undefined
    || !createdAt
    || !updatedAt
    || !distanceSource
  ) return undefined
  const provinceFields = normalizeProvinceFields(value, value.roadClass as RoadClass, routeRef)
  return {
    id: normalizeOptionalString(value.id) ?? `annotation-${startPointIndex}-${endPointIndex}`,
    startPointIndex,
    endPointIndex,
    roadClass: value.roadClass as RoadClass,
    ...(routeRef ? { routeRef } : {}),
    ...(provinceFields.provinceCode ? { provinceCode: provinceFields.provinceCode } : {}),
    ...(provinceFields.provinceName ? { provinceName: provinceFields.provinceName } : {}),
    ...(provinceFields.provinceSource === 'MANUAL' || provinceFields.provinceSource === 'ESTIMATED_SPLIT'
      ? { provinceSource: provinceFields.provinceSource } : {}),
    ...(provinceFields.provinceStatus ? { provinceStatus: provinceFields.provinceStatus } : {}),
    distanceMeters,
    distanceSource,
    createdAt,
    updatedAt,
  }
}

function normalizeManualRoadAnnotationArray(value: unknown): ManualRoadIntervalAnnotation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const annotations = value.map(normalizeManualRoadAnnotation)
  if (annotations.some((annotation) => !annotation)) return undefined
  return annotations as ManualRoadIntervalAnnotation[]
}

function normalizeRoadAnalysis(value: unknown): RoadAnalysisMeta | undefined {
  if (!isRecord(value) || value.schemaVersion !== ROAD_ANALYSIS_SCHEMA_VERSION) return undefined

  const classifierVersion = normalizeOptionalString(value.classifierVersion)
  const analyzedAt = normalizeOptionalString(value.analyzedAt)
  const coverageMeters = normalizeNonNegativeNumber(value.coverageMeters)
  const routeDistanceMeters = normalizeNonNegativeNumber(value.routeDistanceMeters)
  const coverageRatio = normalizeNonNegativeNumber(value.coverageRatio)
  const distanceErrorMeters = normalizeNonNegativeNumber(value.distanceErrorMeters)
  const distanceToleranceMeters = normalizeNonNegativeNumber(value.distanceToleranceMeters)
  const routeBuildKey = normalizeOptionalString(value.routeBuildKey)
  const status = value.status === 'complete' || value.status === 'partial' ? value.status : undefined

  if (
    !classifierVersion
    || !analyzedAt
    || Number.isNaN(Date.parse(analyzedAt))
    || coverageMeters === undefined
    || !status
    || (coverageRatio !== undefined && coverageRatio > 1)
  ) {
    return undefined
  }

  return {
    schemaVersion: ROAD_ANALYSIS_SCHEMA_VERSION,
    classifierVersion,
    analyzedAt,
    ...(routeBuildKey ? { routeBuildKey } : {}),
    coverageMeters,
    ...(routeDistanceMeters !== undefined ? { routeDistanceMeters } : {}),
    ...(coverageRatio !== undefined ? { coverageRatio } : {}),
    ...(distanceErrorMeters !== undefined ? { distanceErrorMeters } : {}),
    ...(distanceToleranceMeters !== undefined ? { distanceToleranceMeters } : {}),
    status,
  }
}

/** V1 记录只有几何字段；V2 的道路分析字段非法时只丢弃扩展字段，不影响旧轨迹显示。 */
export function normalizeRouteCacheRecord(value: unknown, fallbackUpdatedAt = 0): RouteCacheRecord | null {
  if (!isRecord(value)) return null

  const segmentId = normalizeOptionalString(value.segmentId)
  const routeBuildKey = normalizeOptionalString(value.routeBuildKey)
  const points = normalizeCoordPointArray(value.points)
  if (!segmentId || !routeBuildKey || !points) return null

  let roadParts = value.roadParts === undefined ? undefined : normalizeRoadPartArray(value.roadParts)
  let roadAnalysis = roadParts === undefined ? undefined : normalizeRoadAnalysis(value.roadAnalysis)
  const manualRoadAnnotations = value.manualRoadAnnotations === undefined
    ? undefined
    : normalizeManualRoadAnnotationArray(value.manualRoadAnnotations)
  const roadAnnotationBaseParts = value.roadAnnotationBaseParts === undefined
    ? undefined
    : normalizeRoadPartArray(value.roadAnnotationBaseParts)
  const roadAnnotationBaseAnalysis = value.roadAnnotationBaseAnalysis === undefined
    ? undefined
    : normalizeRoadAnalysis(value.roadAnnotationBaseAnalysis)
  if (
    roadParts
    && roadAnalysis
    && (roadAnalysis.classifierVersion === 'rules-v1' || roadAnalysis.classifierVersion === 'rules-v2')
  ) {
    roadParts = mergeAdjacentRoadParts(reclassifyRoadParts(roadParts))
    roadAnalysis = { ...roadAnalysis, classifierVersion: ROAD_CLASSIFIER_VERSION }
  }
  const updatedAt = normalizeNonNegativeNumber(value.updatedAt) ?? fallbackUpdatedAt
  const distanceMeters = normalizeNonNegativeNumber(value.distanceMeters)
  const estimatedDurationSeconds = normalizeNonNegativeNumber(value.estimatedDurationSeconds)
  const durationUpdatedAt = estimatedDurationSeconds === undefined
    ? undefined
    : normalizeOptionalTimestamp(value.durationUpdatedAt)
  const estimatedTollYuan = normalizeNonNegativeNumber(value.estimatedTollYuan)
  const tollDistanceMeters = normalizeNonNegativeNumber(value.tollDistanceMeters)
  const tollUpdatedAt = estimatedTollYuan === undefined
    ? undefined
    : normalizeOptionalTimestamp(value.tollUpdatedAt)

  return {
    segmentId,
    routeBuildKey,
    points,
    updatedAt,
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(estimatedDurationSeconds !== undefined ? { estimatedDurationSeconds } : {}),
    ...(durationUpdatedAt ? { durationUpdatedAt } : {}),
    ...(estimatedTollYuan !== undefined ? { estimatedTollYuan } : {}),
    ...(tollDistanceMeters !== undefined ? { tollDistanceMeters } : {}),
    ...(tollUpdatedAt ? { tollUpdatedAt } : {}),
    ...(roadParts !== undefined ? { roadParts } : {}),
    ...(roadAnalysis ? { roadAnalysis } : {}),
    ...(manualRoadAnnotations !== undefined ? { manualRoadAnnotations } : {}),
    ...(roadAnnotationBaseParts !== undefined ? { roadAnnotationBaseParts } : {}),
    ...(roadAnnotationBaseAnalysis ? { roadAnnotationBaseAnalysis } : {}),
  }
}

export function normalizeRouteCacheRecords(value: unknown, fallbackUpdatedAt = 0): RouteCacheRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map((record) => normalizeRouteCacheRecord(record, fallbackUpdatedAt))
    .filter((record): record is RouteCacheRecord => Boolean(record))
}

function openRouteCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ROUTE_CACHE_DB_NAME, ROUTE_CACHE_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ROUTE_CACHE_STORE_NAME)) {
        db.createObjectStore(ROUTE_CACHE_STORE_NAME, { keyPath: 'segmentId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putCompleteRecord(record: RouteCacheRecord): Promise<void> {
  const db = await openRouteCacheDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
      tx.objectStore(ROUTE_CACHE_STORE_NAME).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** 完整规划结果采用替换语义；没有道路分析的骑行结果会清除同记录中的旧道路字段。 */
export async function savePlannedSegmentRouteCache(
  params: SavePlannedSegmentRouteCacheParams,
): Promise<void> {
  try {
    const payload = normalizeRouteCacheRecord({
      ...params,
      ...(params.roadAnalysis
        ? { roadAnalysis: { ...params.roadAnalysis, routeBuildKey: params.routeBuildKey } }
        : {}),
      updatedAt: Date.now(),
    })
    if (!payload) return
    await putCompleteRecord(payload)
  } catch (error) {
    console.error('[routeCacheDb] Failed to save planned segment route cache.', error)
  }
}

/** 手工轨迹只更新几何字段；汇总估算继续保留，但旧道路分类与分析必须清除。 */
export async function saveManualSegmentRouteCache(
  params: SaveSegmentRouteGeometryParams,
): Promise<void> {
  try {
    const geometry = normalizeRouteCacheRecord({ ...params, updatedAt: Date.now() })
    if (!geometry) return

    const db = await openRouteCacheDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
        const store = tx.objectStore(ROUTE_CACHE_STORE_NAME)
        const request = store.get(geometry.segmentId)

        request.onsuccess = () => {
          const existing = normalizeRouteCacheRecord(request.result)
          store.put({
            ...geometry,
            ...(existing?.distanceMeters !== undefined ? { distanceMeters: existing.distanceMeters } : {}),
            ...(existing?.estimatedDurationSeconds !== undefined
              ? { estimatedDurationSeconds: existing.estimatedDurationSeconds }
              : {}),
            ...(existing?.durationUpdatedAt ? { durationUpdatedAt: existing.durationUpdatedAt } : {}),
            ...(existing?.estimatedTollYuan !== undefined
              ? { estimatedTollYuan: existing.estimatedTollYuan }
              : {}),
            ...(existing?.tollDistanceMeters !== undefined
              ? { tollDistanceMeters: existing.tollDistanceMeters }
              : {}),
            ...(existing?.tollUpdatedAt ? { tollUpdatedAt: existing.tollUpdatedAt } : {}),
          } satisfies RouteCacheRecord)
        }
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[routeCacheDb] Failed to save manual segment route cache.', error)
  }
}

async function updateExistingRouteCache(
  segmentId: string,
  update: (record: RouteCacheRecord) => RouteCacheRecord,
): Promise<void> {
  const db = await openRouteCacheDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
      const store = tx.objectStore(ROUTE_CACHE_STORE_NAME)
      const request = store.get(segmentId)
      request.onsuccess = () => {
        const existing = normalizeRouteCacheRecord(request.result)
        if (!existing) {
          tx.abort()
          reject(new Error('未找到可修改的路线缓存。'))
          return
        }
        const next = normalizeRouteCacheRecord(update(existing))
        if (!next) {
          tx.abort()
          reject(new Error('道路分析数据校验失败。'))
          return
        }
        store.put(next)
      }
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('路线缓存事务已取消。'))
    })
  } finally {
    db.close()
  }
}

function partAnchor(part: RouteRoadPart): [number, number] | undefined {
  return part.polyline?.[0]
}

/** 历史自动补全只更新自动字段；已有 MANUAL 结论按路段位置保留。 */
function preserveManualRoadCorrections(
  automaticParts: readonly RouteRoadPart[] | undefined,
  existingParts: readonly RouteRoadPart[] | undefined,
): RouteRoadPart[] | undefined {
  if (!automaticParts) return undefined
  const manualParts = (existingParts ?? []).filter((part) => part.source === 'MANUAL')
  if (!manualParts.length) return [...automaticParts]
  const next = automaticParts.map((part) => ({ ...part }))
  const used = new Set<number>()
  manualParts.forEach((manualPart, manualIndex) => {
    let targetIndex = automaticParts.length === existingParts?.length ? manualIndex : -1
    if (targetIndex < 0 || used.has(targetIndex) || targetIndex >= next.length) {
      const anchor = partAnchor(manualPart)
      targetIndex = next.reduce((bestIndex, candidate, index) => {
        if (used.has(index)) return bestIndex
        if (!anchor) return bestIndex < 0 ? index : bestIndex
        const candidateAnchor = partAnchor(candidate)
        if (!candidateAnchor) return bestIndex
        if (bestIndex < 0) return index
        const bestAnchor = partAnchor(next[bestIndex])
        if (!bestAnchor) return index
        const candidateDistance = Math.hypot(candidateAnchor[0] - anchor[0], candidateAnchor[1] - anchor[1])
        const bestDistance = Math.hypot(bestAnchor[0] - anchor[0], bestAnchor[1] - anchor[1])
        return candidateDistance < bestDistance ? index : bestIndex
      }, -1)
    }
    if (targetIndex < 0 || !next[targetIndex]) return
    used.add(targetIndex)
    const automaticPart = next[targetIndex]
    next[targetIndex] = {
      ...automaticPart,
      roadClass: manualPart.roadClass,
      routeRef: manualPart.routeRef,
      confidence: 'HIGH',
      source: 'MANUAL',
      ...(manualPart.provinceCode ? { provinceCode: manualPart.provinceCode } : {}),
      ...(manualPart.provinceName ? { provinceName: manualPart.provinceName } : {}),
      ...(manualPart.provinceSource ? { provinceSource: manualPart.provinceSource } : {}),
      ...(manualPart.provinceStatus ? { provinceStatus: manualPart.provinceStatus } : {}),
      ...(manualPart.provinceCandidates ? { provinceCandidates: [...manualPart.provinceCandidates] } : {}),
    }
  })
  return next
}

/** 历史回填的相似路线只补道路字段，缓存中的原始 points 与既有估算保持不变。 */
export async function saveHistoricalRoadAnalysisOnly(params: {
  segment: RouteSegment
  cache: RouteCacheRecord | null
  routeBuildKey: string
  route: DrivingRouteResult
  savedPoints: CoordPoint[]
}): Promise<void> {
  if (!params.route.roadParts?.length || !params.route.roadAnalysis) {
    throw new Error('规划结果缺少道路分析。')
  }
  const existing = params.cache
  const roadParts = preserveManualRoadCorrections(params.route.roadParts, existing?.roadParts)
  const base: RouteCacheRecord = existing ?? {
    segmentId: params.segment.id,
    routeBuildKey: params.routeBuildKey,
    points: params.savedPoints,
    updatedAt: Date.now(),
    ...(typeof params.segment.distanceMeters === 'number' ? { distanceMeters: params.segment.distanceMeters } : {}),
    ...(typeof params.segment.estimatedDurationSeconds === 'number'
      ? { estimatedDurationSeconds: params.segment.estimatedDurationSeconds }
      : {}),
    ...(params.segment.durationUpdatedAt ? { durationUpdatedAt: params.segment.durationUpdatedAt } : {}),
    ...(typeof params.segment.estimatedTollYuan === 'number' ? { estimatedTollYuan: params.segment.estimatedTollYuan } : {}),
    ...(typeof params.segment.tollDistanceMeters === 'number' ? { tollDistanceMeters: params.segment.tollDistanceMeters } : {}),
    ...(params.segment.tollUpdatedAt ? { tollUpdatedAt: params.segment.tollUpdatedAt } : {}),
  }
  const payload = normalizeRouteCacheRecord({
    ...base,
    routeBuildKey: params.routeBuildKey,
    points: params.savedPoints,
    updatedAt: Date.now(),
    roadParts,
    roadAnalysis: { ...params.route.roadAnalysis, routeBuildKey: params.routeBuildKey },
  })
  if (!payload) throw new Error('历史道路分析数据校验失败。')
  await putCompleteRecord(payload)
}

/** 历史任务中用户明确选择替换时使用；失败必须向批处理抛出，不能误报成功。 */
export async function saveHistoricalRouteReplacement(patch: ResolvedRoutePatch): Promise<void> {
  const existing = await getSegmentRouteCache(patch.segmentId)
  const roadParts = preserveManualRoadCorrections(patch.roadParts, existing?.roadParts)
  const payload = normalizeRouteCacheRecord({
    segmentId: patch.segmentId,
    routeBuildKey: patch.routeBuildKey,
    points: patch.points,
    updatedAt: Date.now(),
    distanceMeters: patch.distanceMeters,
    estimatedDurationSeconds: patch.estimatedDurationSeconds,
    durationUpdatedAt: patch.durationUpdatedAt,
    estimatedTollYuan: patch.estimatedTollYuan,
    tollDistanceMeters: patch.tollDistanceMeters,
    tollUpdatedAt: patch.tollUpdatedAt,
    roadParts,
    roadAnalysis: patch.roadAnalysis
      ? { ...patch.roadAnalysis, routeBuildKey: patch.routeBuildKey }
      : undefined,
  })
  if (!payload) throw new Error('替换路线数据校验失败。')
  await putCompleteRecord(payload)
}

export async function saveManualRoadPartCorrection(
  segmentId: string,
  partIndex: number,
  correction: ManualRoadPartCorrection,
): Promise<void> {
  const normalizedRef = correction.routeRef?.trim() ? extractRouteRef(correction.routeRef) : undefined
  if (correction.routeRef?.trim() && !normalizedRef) throw new Error('道路编号格式无效，例如应填写 G65、G210 或 S101。')
  const provinceCode = normalizeProvinceCode(correction.provinceCode) ?? normalizeProvinceCode(correction.provinceName)
  await updateExistingRouteCache(segmentId, (record) => {
    if (!record.roadParts?.[partIndex] || !record.roadAnalysis) throw new Error('要修正的道路片段不存在。')
    const roadParts = record.roadParts.map((part, index) => {
      if (index !== partIndex) return part
      const next = {
        ...part,
        roadClass: correction.roadClass,
        routeRef: normalizedRef,
        confidence: 'HIGH' as const,
        source: 'MANUAL' as const,
      }
      if (isProvinceSensitiveRoadPart(next)) {
        return {
          ...next,
          ...(provinceCode ? { provinceCode, provinceName: provinceNameFromCode(provinceCode) } : {}),
          provinceSource: provinceCode ? 'MANUAL' as const : 'UNKNOWN' as const,
          provinceStatus: provinceCode ? 'confirmed' as const : 'pending' as const,
        }
      }
      const cleaned = { ...next }
      delete (cleaned as Partial<RouteRoadPart>).provinceCode
      delete (cleaned as Partial<RouteRoadPart>).provinceName
      delete (cleaned as Partial<RouteRoadPart>).provinceSource
      delete (cleaned as Partial<RouteRoadPart>).provinceStatus
      delete (cleaned as Partial<RouteRoadPart>).provinceCandidates
      return cleaned
    })
    return {
      ...record,
      updatedAt: Date.now(),
      roadParts,
      roadAnalysis: {
        ...record.roadAnalysis,
        classifierVersion: ROAD_CLASSIFIER_VERSION,
        analyzedAt: new Date().toISOString(),
      },
    }
  })
}

function getAnnotationDistanceBase(
  segment: RouteSegment,
  cache: RouteCacheRecord | null,
  points: CoordPoint[],
): { distanceMeters: number; recorded: boolean } {
  const cachedDistance = cache?.distanceMeters
  if (typeof cachedDistance === 'number' && Number.isFinite(cachedDistance) && cachedDistance >= 0) {
    return { distanceMeters: cachedDistance, recorded: true }
  }
  if (typeof segment.distanceMeters === 'number' && Number.isFinite(segment.distanceMeters) && segment.distanceMeters >= 0) {
    return { distanceMeters: segment.distanceMeters, recorded: true }
  }
  return { distanceMeters: getTrackDistanceMeters({ ...segment, points }) ?? 0, recorded: false }
}

/**
 * 为旧纯轨迹增加可撤销的连续区间标注。只写路线缓存，不改旅程中的原始 points、
 * 里程、照片或游记；重复区间在保存前拒绝，未标注部分保持 UNKNOWN。
 */
export async function saveManualRoadIntervalAnnotation(
  input: ManualRoadIntervalAnnotationInput,
): Promise<ManualRoadIntervalAnnotation> {
  if (!Number.isInteger(input.startPointIndex) || !Number.isInteger(input.endPointIndex)
    || input.startPointIndex < 0 || input.endPointIndex <= input.startPointIndex) {
    throw new Error('道路标注需要选择一个连续且至少包含两个点的区间。')
  }
  const cache = await getSegmentRouteCache(input.segment.id)
  const points = cache?.points?.length ? cache.points : input.segment.points ?? []
  if (points.length < 2 || input.endPointIndex >= points.length) throw new Error('所选轨迹区间不存在。')

  const routeRef = input.routeRef?.trim() ? extractRouteRef(input.routeRef) : undefined
  if (input.routeRef?.trim() && !routeRef) throw new Error('道路编号格式无效，例如应填写 G65、G210 或 S101。')
  const provinceCode = normalizeProvinceCode(input.provinceCode) ?? normalizeProvinceCode(input.provinceName)
  const now = new Date().toISOString()
  const { distanceMeters: totalDistanceMeters, recorded } = getAnnotationDistanceBase(input.segment, cache, points)
  const annotations = [...(cache?.manualRoadAnnotations ?? [])].filter((annotation) => annotation.id !== input.annotationId)
  const annotation: ManualRoadIntervalAnnotation = {
    id: input.annotationId ?? `manual-road-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startPointIndex: input.startPointIndex,
    endPointIndex: input.endPointIndex,
    roadClass: input.roadClass,
    ...(routeRef ? { routeRef } : {}),
    ...(provinceCode ? { provinceCode, provinceName: provinceNameFromCode(provinceCode) } : {}),
    ...(isProvinceSensitiveRoadPart({ roadClass: input.roadClass, routeRef })
      ? { provinceSource: 'MANUAL' as const, provinceStatus: provinceCode ? 'confirmed' as const : 'pending' as const }
      : {}),
    distanceMeters: getManualRoadAnnotationDistanceMeters(points, totalDistanceMeters, {
      id: 'pending',
      startPointIndex: input.startPointIndex,
      endPointIndex: input.endPointIndex,
      roadClass: input.roadClass,
      ...(routeRef ? { routeRef } : {}),
      distanceMeters: 0,
      distanceSource: recorded ? 'RECORDED_ALLOCATION' : 'GEOMETRY_ESTIMATE',
      createdAt: now,
      updatedAt: now,
    }),
    distanceSource: recorded ? 'RECORDED_ALLOCATION' : 'GEOMETRY_ESTIMATE',
    createdAt: cache?.manualRoadAnnotations?.find((item) => item.id === input.annotationId)?.createdAt ?? now,
    updatedAt: now,
  }
  annotations.push(annotation)
  if (findOverlappingManualRoadAnnotations(annotations).length) throw new Error('道路标注区间不能重叠。')

  const baseParts = cache?.roadAnnotationBaseParts ?? cache?.roadParts ?? []
  const baseAnalysis = cache?.roadAnnotationBaseAnalysis ?? cache?.roadAnalysis
  const built = buildManualRoadAnnotationParts({
    points,
    ...(recorded ? { totalDistanceMeters } : {}),
    baseRoadParts: baseParts,
    annotations,
  })
  const routeBuildKey = buildSegmentRouteKey(input.segment)
  const analyzedAt = now
  const analysis = buildRouteRoadAnalysis(built.roadParts, built.totalDistanceMeters, analyzedAt, routeBuildKey)
  const base: RouteCacheRecord = cache ?? {
    segmentId: input.segment.id,
    routeBuildKey,
    points,
    updatedAt: Date.now(),
    ...(typeof input.segment.distanceMeters === 'number' ? { distanceMeters: input.segment.distanceMeters } : {}),
    ...(typeof input.segment.estimatedDurationSeconds === 'number'
      ? { estimatedDurationSeconds: input.segment.estimatedDurationSeconds }
      : {}),
    ...(input.segment.durationUpdatedAt ? { durationUpdatedAt: input.segment.durationUpdatedAt } : {}),
    ...(typeof input.segment.estimatedTollYuan === 'number' ? { estimatedTollYuan: input.segment.estimatedTollYuan } : {}),
    ...(typeof input.segment.tollDistanceMeters === 'number' ? { tollDistanceMeters: input.segment.tollDistanceMeters } : {}),
    ...(input.segment.tollUpdatedAt ? { tollUpdatedAt: input.segment.tollUpdatedAt } : {}),
  }
  const payload = normalizeRouteCacheRecord({
    ...base,
    routeBuildKey,
    points,
    updatedAt: Date.now(),
    roadParts: analysis.roadParts,
    roadAnalysis: analysis.meta,
    manualRoadAnnotations: annotations,
    roadAnnotationBaseParts: baseParts,
    ...(baseAnalysis ? { roadAnnotationBaseAnalysis: baseAnalysis } : {}),
  })
  if (!payload) throw new Error('道路区间标注保存失败。')
  await putCompleteRecord(payload)
  return annotation
}

export async function revokeManualRoadIntervalAnnotation(segmentId: string, annotationId: string): Promise<void> {
  await updateExistingRouteCache(segmentId, (record) => {
    const annotations = (record.manualRoadAnnotations ?? []).filter((annotation) => annotation.id !== annotationId)
    if (annotations.length === (record.manualRoadAnnotations ?? []).length) throw new Error('未找到要撤销的道路标注。')
    if (annotations.length === 0) {
      const { manualRoadAnnotations: _annotations, roadAnnotationBaseParts: baseParts, roadAnnotationBaseAnalysis: baseAnalysis, ...rest } = record
      if (baseParts?.length) {
        return {
          ...rest,
          roadParts: baseParts,
          ...(baseAnalysis ? { roadAnalysis: baseAnalysis } : {}),
          updatedAt: Date.now(),
        }
      }
      const { roadParts: _parts, roadAnalysis: _analysis, ...geometryOnly } = rest
      return { ...geometryOnly, updatedAt: Date.now() }
    }

    const baseParts = record.roadAnnotationBaseParts ?? []
    const { distanceMeters, recorded } = getAnnotationDistanceBase(
      { id: record.segmentId, distanceMeters: record.distanceMeters, points: record.points } as RouteSegment,
      record,
      record.points,
    )
    const built = buildManualRoadAnnotationParts({
      points: record.points,
      ...(recorded ? { totalDistanceMeters: distanceMeters } : {}),
      baseRoadParts: baseParts,
      annotations,
    })
    const analysis = buildRouteRoadAnalysis(
      built.roadParts,
      built.totalDistanceMeters,
      new Date().toISOString(),
      record.routeBuildKey,
    )
    return { ...record, updatedAt: Date.now(), roadParts: analysis.roadParts, roadAnalysis: analysis.meta, manualRoadAnnotations: annotations }
  })
}

export async function restoreAutomaticRoadPartCorrection(segmentId: string, partIndex: number): Promise<void> {
  await updateExistingRouteCache(segmentId, (record) => {
    if (!record.roadParts?.[partIndex] || !record.roadAnalysis) throw new Error('要恢复的道路片段不存在。')
    return {
      ...record,
      updatedAt: Date.now(),
      roadParts: restoreAutomaticRoadPartClassification(record.roadParts, partIndex),
      roadAnalysis: {
        ...record.roadAnalysis,
        classifierVersion: ROAD_CLASSIFIER_VERSION,
        analyzedAt: new Date().toISOString(),
      },
    }
  })
}

export async function getSegmentRouteCache(segmentId: string): Promise<RouteCacheRecord | null> {
  try {
    const db = await openRouteCacheDb()
    try {
      return await new Promise<RouteCacheRecord | null>((resolve, reject) => {
        const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readonly')
        const request = tx.objectStore(ROUTE_CACHE_STORE_NAME).get(segmentId)
        request.onsuccess = () => resolve(normalizeRouteCacheRecord(request.result))
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[routeCacheDb] Failed to read segment route cache.', error)
    return null
  }
}

async function readAllSegmentRouteCache(): Promise<RouteCacheRecord[]> {
  const db = await openRouteCacheDb()
  try {
    return await new Promise<RouteCacheRecord[]>((resolve, reject) => {
      const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readonly')
      const request = tx.objectStore(ROUTE_CACHE_STORE_NAME).getAll()
      request.onsuccess = () => resolve(normalizeRouteCacheRecords(request.result))
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function getAllSegmentRouteCacheStrict(): Promise<RouteCacheRecord[]> {
  return readAllSegmentRouteCache()
}

export async function getAllSegmentRouteCache(): Promise<RouteCacheRecord[]> {
  try {
    return await readAllSegmentRouteCache()
  } catch (error) {
    console.error('[routeCacheDb] Failed to read all segment route cache.', error)
    return []
  }
}

export async function deleteSegmentRouteCache(segmentId: string): Promise<void> {
  try {
    const db = await openRouteCacheDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
        tx.objectStore(ROUTE_CACHE_STORE_NAME).delete(segmentId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[routeCacheDb] Failed to delete segment route cache.', error)
  }
}

export async function clearAllRouteCache(): Promise<void> {
  try {
    const db = await openRouteCacheDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
        tx.objectStore(ROUTE_CACHE_STORE_NAME).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch (error) {
    console.error('[routeCacheDb] Failed to clear route cache.', error)
  }
}

export async function replaceAllSegmentRouteCache(records: RouteCacheRecord[]): Promise<number> {
  try {
    const normalizedRecords = normalizeRouteCacheRecords(records, Date.now())
    const db = await openRouteCacheDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
        const store = tx.objectStore(ROUTE_CACHE_STORE_NAME)
        store.clear()
        normalizedRecords.forEach((record) => store.put(record))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
    return normalizedRecords.length
  } catch (error) {
    console.error('[routeCacheDb] Failed to replace segment route cache.', error)
    throw error
  }
}

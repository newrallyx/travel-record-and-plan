import type { TripReview } from '../types/trip'
import {
  getAllSegmentRouteCache,
  normalizeRouteCacheRecords,
  type RouteCacheRecord,
} from './routeCacheDb.ts'
import { toPersistedTripReview } from './tripStorage.ts'

const BACKUP_SCHEMA = 'roadtrip-retrospective-backup'
// 版本 3：旅行数据之外，完整导出 IndexedDB 路线缓存中的道路片段和分析元数据。
// 导入继续兼容原始 TripReview JSON、v1 和 v2。
const BACKUP_VERSION = 3
const BACKUP_SUPPORTED_VERSIONS = [1, 2, 3]

interface TripBackupPayload {
  schema: typeof BACKUP_SCHEMA
  version: typeof BACKUP_VERSION
  exportedAt: string
  sources: {
    tripStorageKey: string
    routeCacheDb: string
    routeCacheStore: string
  }
  summary: {
    tripCount: number
    routeSegmentCount: number
    segmentRouteCacheCount: number
  }
  data: {
    tripReview: TripReview
    segmentRoutes: RouteCacheRecord[]
  }
}

export interface TripBackupExport {
  json: string
  filename: string
  tripCount: number
  routeSegmentCount: number
  routeCacheCount: number
}

export interface TripBackupImport {
  tripReview: TripReview
  segmentRoutes: RouteCacheRecord[]
  tripCount: number
  routeSegmentCount: number
  routeCacheCount: number
}

function countRouteSegments(data: TripReview): number {
  return data.trips.reduce(
    (tripTotal, trip) => tripTotal + trip.days.reduce((dayTotal, day) => dayTotal + day.routeSegments.length, 0),
    0,
  )
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[-:T]/g, '')
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isTripReview(value: unknown): value is TripReview {
  return isRecord(value) && Array.isArray(value.trips)
}

function normalizeImportedSegmentRoutes(value: unknown): RouteCacheRecord[] {
  // 缓存层对 roadParts 采用整组严格校验：任何非法坐标、负里程或无效道路类型
  // 都会丢弃该记录的道路扩展字段，但不会让合法的旧几何轨迹无法显示。
  return normalizeRouteCacheRecords(value, Date.now())
}

function extractEmbeddedSegmentRoutes(data: TripReview): RouteCacheRecord[] {
  const records: RouteCacheRecord[] = []

  data.trips.forEach((trip) => {
    trip.days.forEach((day) => {
      day.routeSegments.forEach((segment) => {
        if (!segment.routeBuildKey || !Array.isArray(segment.points) || segment.points.length === 0) return

        records.push({
          segmentId: segment.id,
          routeBuildKey: segment.routeBuildKey,
          points: segment.points,
          updatedAt: Date.now(),
        })
      })
    })
  })

  return records
}

function mergeSegmentRoutes(primary: RouteCacheRecord[], fallback: RouteCacheRecord[]): RouteCacheRecord[] {
  const bySegmentId = new Map<string, RouteCacheRecord>()
  fallback.forEach((record) => bySegmentId.set(record.segmentId, record))
  primary.forEach((record) => bySegmentId.set(record.segmentId, record))
  return Array.from(bySegmentId.values())
}

export function parseTripBackupJson(json: string): TripBackupImport {
  const parsed = JSON.parse(json) as unknown
  let tripReviewSource: unknown
  let segmentRoutesSource: unknown

  if (isTripReview(parsed)) {
    tripReviewSource = parsed
  } else if (isRecord(parsed)) {
    if (parsed.schema !== BACKUP_SCHEMA || !BACKUP_SUPPORTED_VERSIONS.includes(parsed.version as number)) {
      throw new Error('备份文件格式不匹配。')
    }

    const data = isRecord(parsed.data) ? parsed.data : null
    tripReviewSource = data?.tripReview
    segmentRoutesSource = data?.segmentRoutes
  }

  if (!isTripReview(tripReviewSource)) {
    throw new Error('备份文件缺少 trips 数据。')
  }

  const embeddedSegmentRoutes = extractEmbeddedSegmentRoutes(tripReviewSource)
  const importedSegmentRoutes = normalizeImportedSegmentRoutes(segmentRoutesSource)
  const segmentRoutes = mergeSegmentRoutes(importedSegmentRoutes, embeddedSegmentRoutes)
  const tripReview = toPersistedTripReview(tripReviewSource)
  const routeSegmentCount = countRouteSegments(tripReview)

  return {
    tripReview,
    segmentRoutes,
    tripCount: tripReview.trips.length,
    routeSegmentCount,
    routeCacheCount: segmentRoutes.length,
  }
}

export function buildTripBackupPayload(
  data: TripReview,
  segmentRoutes: RouteCacheRecord[],
  exportedAt: Date,
): TripBackupPayload {
  const tripReview = toPersistedTripReview(data)
  const routeSegmentCount = countRouteSegments(tripReview)

  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    sources: {
      tripStorageKey: 'trip-review-data-v1',
      routeCacheDb: 'trip-route-cache',
      routeCacheStore: 'segmentRoutes',
    },
    summary: {
      tripCount: tripReview.trips.length,
      routeSegmentCount,
      segmentRouteCacheCount: segmentRoutes.length,
    },
    data: {
      tripReview,
      segmentRoutes,
    },
  }
}

export async function createTripBackupExport(data: TripReview): Promise<TripBackupExport> {
  const exportedAt = new Date()
  const segmentRoutes = await getAllSegmentRouteCache()
  const payload = buildTripBackupPayload(data, segmentRoutes, exportedAt)
  const routeSegmentCount = payload.summary.routeSegmentCount

  return {
    json: JSON.stringify(payload, null, 2),
    filename: `trip-review-backup-${formatBackupTimestamp(exportedAt)}.json`,
    tripCount: payload.summary.tripCount,
    routeSegmentCount,
    routeCacheCount: segmentRoutes.length,
  }
}

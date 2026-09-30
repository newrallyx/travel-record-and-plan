import { mockTripReview } from './mockData.ts'
import type {
  ActualDriveResult,
  CoordPoint,
  RouteSegment,
  SegmentReviewFacts,
  TripReview,
  Waypoint,
} from '../types/trip'
import { sortTripDaysByDate } from '../utils/date.ts'
import { normalizeScore, normalizeSegmentNote } from '../utils/segmentScores.ts'
import { normalizeTripOrders } from '../utils/tripOrder.ts'
import { normalizeTollValue } from '../utils/tolls.ts'
import { normalizeDurationSeconds } from '../utils/durations.ts'
import { isReviewTag } from '../utils/reviewTags.ts'

// 本地存储服务：统一处理 TripReview 的读取与保存，避免组件直接操作 localStorage。
export const TRIP_STORAGE_KEY = 'trip-review-data-v1'
export const TRIP_STORAGE_RECOVERY_KEY = 'trip-review-data-v1-recovery-copy'

export type TripStorageIssue =
  | {
      kind: 'corrupt-data'
      message: string
      recoverySaved: boolean
    }
  | {
      kind: 'save-failed'
      message: string
    }

export interface TripReviewLoadResult {
  tripReview: TripReview
  issue: TripStorageIssue | null
  persistenceBlocked: boolean
}

export type TripReviewSaveResult =
  | { ok: true }
  | { ok: false; error: unknown }

function normalizeCoordPoint(value: unknown): CoordPoint | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as Partial<CoordPoint>
  if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') return undefined

  const point: CoordPoint = {
    lat: candidate.lat,
    lon: candidate.lon,
  }

  if (typeof candidate.timestamp === 'string') {
    point.timestamp = candidate.timestamp
  }

  return point
}

function normalizeWaypoint(value: unknown): Waypoint | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as Partial<Waypoint>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return undefined

  const waypoint: Waypoint = {
    id: candidate.id,
    name: candidate.name,
  }

  if (typeof candidate.lat === 'number') waypoint.lat = candidate.lat
  if (typeof candidate.lng === 'number') waypoint.lng = candidate.lng
  if (typeof candidate.amapId === 'string') waypoint.amapId = candidate.amapId
  if (typeof candidate.timestamp === 'string') waypoint.timestamp = candidate.timestamp

  return waypoint
}

function normalizeWaypoints(value: unknown): Waypoint[] | undefined {
  if (!Array.isArray(value)) return undefined

  const waypoints = value
    .map((item) => normalizeWaypoint(item))
    .filter((item): item is Waypoint => Boolean(item))

  return waypoints.length > 0 ? waypoints : undefined
}

export function normalizePhotoIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const photoIds = Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)),
  )

  return photoIds.length > 0 ? photoIds : undefined
}

const ACTUAL_DISTANCE_MAX_METERS = 10_000_000
const ACTUAL_TOLL_MAX_YUAN = 1_000_000

function normalizeActualDriveResult(value: unknown): ActualDriveResult | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as Record<string, unknown>
  const result: ActualDriveResult = {}

  if (typeof candidate.distanceMeters === 'number'
    && Number.isFinite(candidate.distanceMeters)
    && candidate.distanceMeters > 0
    && candidate.distanceMeters <= ACTUAL_DISTANCE_MAX_METERS) {
    result.distanceMeters = Math.round(candidate.distanceMeters)
  }

  const durationSeconds = normalizeDurationSeconds(candidate.durationSeconds)
  if (durationSeconds !== undefined) result.durationSeconds = durationSeconds

  const tollYuan = normalizeTollValue(candidate.tollYuan)
  if (tollYuan !== undefined && tollYuan <= ACTUAL_TOLL_MAX_YUAN) result.tollYuan = tollYuan

  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeReviewFacts(value: unknown): SegmentReviewFacts | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as Record<string, unknown>
  const facts: SegmentReviewFacts = {}

  if (Array.isArray(candidate.tags)) {
    const tags = Array.from(
      new Set(candidate.tags.filter(isReviewTag)),
    )
    if (tags.length > 0) facts.tags = tags
  }

  const actual = normalizeActualDriveResult(candidate.actual)
  if (actual) facts.actual = actual

  return Object.keys(facts).length > 0 ? facts : undefined
}

function normalizeLegacyViaPointsText(viaPointsText: unknown): Waypoint[] | undefined {
  if (typeof viaPointsText !== 'string') return undefined
  const names = viaPointsText
    .split(/[，,;；|]/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (!names.length) return undefined

  return names.map((name, index) => ({
    id: `legacy-wp-${index}-${name}`,
    name,
  }))
}

function normalizeRouteSegment(segment: RouteSegment): RouteSegment {
  const normalizedStartCoord = normalizeCoordPoint(segment.startCoord)
  const normalizedEndCoord = normalizeCoordPoint(segment.endCoord)
  const normalizedWaypoints = normalizeWaypoints(segment.waypoints)

  return {
    ...segment,
    routeType: segment.routeType ?? 'DRIVING',
    preference:
      segment.preference === 'AVOID_TOLL' || segment.preference === 'SPEED_FIRST'
        ? segment.preference
        : 'HIGHWAY_FIRST',
    startCoord: normalizedStartCoord,
    endCoord: normalizedEndCoord,
    // points 已迁移到 IndexedDB，此处兼容旧数据但不再从 localStorage 回填。
    points: undefined,
    waypoints: normalizedWaypoints ?? normalizeLegacyViaPointsText(segment.viaPointsText),
    // 新主流程不再依赖 viaPointsText。
    viaPointsText: undefined,
    scenicScore: normalizeScore(segment.scenicScore),
    difficultyScore: normalizeScore(segment.difficultyScore),
    note: normalizeSegmentNote(segment.note),
    photoIds: normalizePhotoIds(segment.photoIds),
    reviewFacts: normalizeReviewFacts(segment.reviewFacts),
    estimatedDurationSeconds: normalizeDurationSeconds(segment.estimatedDurationSeconds),
    durationUpdatedAt: typeof segment.durationUpdatedAt === 'string' ? segment.durationUpdatedAt : undefined,
    estimatedTollYuan: normalizeTollValue(segment.estimatedTollYuan),
    tollDistanceMeters: normalizeTollValue(segment.tollDistanceMeters),
    tollUpdatedAt: typeof segment.tollUpdatedAt === 'string' ? segment.tollUpdatedAt : undefined,
  }
}

function normalizeCoverPhotoId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeTravelogue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeTripReview(input: TripReview): TripReview {
  return {
    ...input,
    trips: normalizeTripOrders((input.trips ?? []).map((trip) => ({
      ...trip,
      coverPhotoId: normalizeCoverPhotoId(trip.coverPhotoId),
      travelogue: normalizeTravelogue(trip.travelogue),
      category: trip.category === 'plan' ? 'plan' : 'review',
      days: sortTripDaysByDate(
        (trip.days ?? []).map((day) => ({
          ...day,
          routeSegments: (day.routeSegments ?? []).map((segment) => normalizeRouteSegment(segment)),
        })),
      ),
    }))),
  }
}

function toPersistedRouteSegment(segment: RouteSegment): RouteSegment {
  return {
    id: segment.id,
    name: segment.name,
    date: segment.date,
    startPoint: segment.startPoint,
    endPoint: segment.endPoint,
    startCoord: normalizeCoordPoint(segment.startCoord),
    endCoord: normalizeCoordPoint(segment.endCoord),
    waypoints: normalizeWaypoints(segment.waypoints),
    routeType: segment.routeType ?? 'DRIVING',
    preference:
      segment.preference === 'AVOID_TOLL' || segment.preference === 'SPEED_FIRST'
        ? segment.preference
        : 'HIGHWAY_FIRST',
    distanceMeters: segment.distanceMeters,
    estimatedDurationSeconds: normalizeDurationSeconds(segment.estimatedDurationSeconds),
    durationUpdatedAt: typeof segment.durationUpdatedAt === 'string' ? segment.durationUpdatedAt : undefined,
    estimatedTollYuan: normalizeTollValue(segment.estimatedTollYuan),
    tollDistanceMeters: normalizeTollValue(segment.tollDistanceMeters),
    tollUpdatedAt: typeof segment.tollUpdatedAt === 'string' ? segment.tollUpdatedAt : undefined,
    routeBuildKey: segment.routeBuildKey,
    startPlaceId: segment.startPlaceId,
    endPlaceId: segment.endPlaceId,
    order: segment.order,
    scenicScore: normalizeScore(segment.scenicScore),
    difficultyScore: normalizeScore(segment.difficultyScore),
    note: normalizeSegmentNote(segment.note),
    photoIds: normalizePhotoIds(segment.photoIds),
    reviewFacts: normalizeReviewFacts(segment.reviewFacts),
  }
}

export function toPersistedTripReview(data: TripReview): TripReview {
  return {
    trips: normalizeTripOrders(data.trips).map((trip) => ({
      ...trip,
      coverPhotoId: normalizeCoverPhotoId(trip.coverPhotoId),
      travelogue: normalizeTravelogue(trip.travelogue),
      days: sortTripDaysByDate(
        trip.days.map((day) => ({
          ...day,
          routeSegments: day.routeSegments.map((segment) => toPersistedRouteSegment(segment)),
        })),
      ),
    })),
  }
}

function createMockTripReview(): TripReview {
  return normalizeTripReview(toPersistedTripReview(mockTripReview))
}

function createSaveFailureIssue(): TripStorageIssue {
  return {
    kind: 'save-failed',
    message: '未持久化：本次更改未能保存到本地。请检查磁盘空间或存储权限后重试。',
  }
}

function quarantineCorruptTripReview(raw: string): boolean {
  try {
    localStorage.setItem(TRIP_STORAGE_RECOVERY_KEY, raw)
    return true
  } catch (error) {
    console.error('[tripStorage] Failed to preserve a recovery copy of corrupted trip data.', error)
    return false
  }
}

export function loadTripReviewWithStatus(): TripReviewLoadResult {
  const raw = localStorage.getItem(TRIP_STORAGE_KEY)
  if (!raw) {
    const tripReview = createMockTripReview()
    const saveResult = saveTripReview(tripReview)
    return {
      tripReview,
      issue: saveResult.ok ? null : createSaveFailureIssue(),
      persistenceBlocked: false,
    }
  }

  try {
    return {
      tripReview: normalizeTripReview(JSON.parse(raw) as TripReview),
      issue: null,
      persistenceBlocked: false,
    }
  } catch (error) {
    const recoverySaved = quarantineCorruptTripReview(raw)
    console.error('[tripStorage] Failed to parse trip review cache. The original value was not overwritten.', error)
    return {
      tripReview: createMockTripReview(),
      issue: {
        kind: 'corrupt-data',
        recoverySaved,
        message: recoverySaved
          ? '检测到损坏的本地行程数据。原文已隔离保存为恢复副本，当前不会自动覆盖。'
          : '检测到损坏的本地行程数据。恢复副本写入失败，但原文仍保留在原位置，当前不会自动覆盖。',
      },
      persistenceBlocked: true,
    }
  }
}

export function loadTripReview(): TripReview {
  return loadTripReviewWithStatus().tripReview
}

export function saveTripReview(data: TripReview): TripReviewSaveResult {
  try {
    saveTripReviewStrict(data)
    return { ok: true }
  } catch (error) {
    console.error('[tripStorage] Failed to persist trip review into localStorage.', error)
    return { ok: false, error }
  }
}

export function saveTripReviewStrict(data: TripReview): void {
  const persisted = toPersistedTripReview(data)
  localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(persisted))
}

export function replaceCorruptTripReviewWithMockData(): TripReview {
  const tripReview = createMockTripReview()
  saveTripReviewStrict(tripReview)
  return tripReview
}

export function readTripReviewRecoveryCopy(preferQuarantinedCopy = true): string | null {
  return preferQuarantinedCopy
    ? localStorage.getItem(TRIP_STORAGE_RECOVERY_KEY) ?? localStorage.getItem(TRIP_STORAGE_KEY)
    : localStorage.getItem(TRIP_STORAGE_KEY) ?? localStorage.getItem(TRIP_STORAGE_RECOVERY_KEY)
}

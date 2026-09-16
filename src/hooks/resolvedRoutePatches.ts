import type { ResolvedRoutePatch } from '../components/map/types.ts'
import { savePlannedSegmentRouteCache } from '../services/routeCacheDb.ts'
import type { TripReview } from '../types/trip.ts'

function indexPatchesBySegment(patches: readonly ResolvedRoutePatch[]) {
  return new Map(patches.map((patch) => [patch.segmentId, patch]))
}

/** 将已解析路线的轻量汇总字段回写到旅程结构；道路片段保留在 IndexedDB。 */
export function applyResolvedRoutePatches(
  previous: TripReview,
  patches: readonly ResolvedRoutePatch[],
): TripReview {
  if (!patches.length) return previous
  const patchMap = indexPatchesBySegment(patches)
  let changed = false
  const nextTrips = previous.trips.map((trip) => {
    let hasTripChanges = false
    const nextDays = trip.days.map((day) => {
      let dayChanged = false
      const nextSegments = day.routeSegments.map((segment) => {
        const patch = patchMap.get(segment.id)
        if (!patch) return segment

        const sameDistance =
          (typeof segment.distanceMeters === 'number' ? segment.distanceMeters : null) ===
          (typeof patch.distanceMeters === 'number' ? Math.round(patch.distanceMeters) : null)
        const sameRouteKey = segment.routeBuildKey === patch.routeBuildKey
        const sameDuration =
          (typeof segment.estimatedDurationSeconds === 'number' ? segment.estimatedDurationSeconds : null) ===
          (typeof patch.estimatedDurationSeconds === 'number'
            ? Math.round(patch.estimatedDurationSeconds)
            : null)
        const sameDurationUpdatedAt = (segment.durationUpdatedAt ?? null) === (patch.durationUpdatedAt ?? null)
        const sameToll =
          (typeof segment.estimatedTollYuan === 'number' ? segment.estimatedTollYuan : null) ===
          (typeof patch.estimatedTollYuan === 'number' ? patch.estimatedTollYuan : null)
        const sameTollDistance =
          (typeof segment.tollDistanceMeters === 'number' ? segment.tollDistanceMeters : null) ===
          (typeof patch.tollDistanceMeters === 'number' ? Math.round(patch.tollDistanceMeters) : null)
        const sameTollUpdatedAt = (segment.tollUpdatedAt ?? null) === (patch.tollUpdatedAt ?? null)
        const samePoints =
          Array.isArray(segment.points) &&
          segment.points.length === patch.points.length &&
          segment.points.every(
            (point, index) => point.lat === patch.points[index].lat && point.lon === patch.points[index].lon,
          )

        if (
          sameDistance
          && sameRouteKey
          && sameDuration
          && sameDurationUpdatedAt
          && sameToll
          && sameTollDistance
          && sameTollUpdatedAt
          && samePoints
        ) {
          return segment
        }

        changed = true
        dayChanged = true
        hasTripChanges = true
        return {
          ...segment,
          points: patch.points,
          distanceMeters:
            typeof patch.distanceMeters === 'number' ? Math.round(patch.distanceMeters) : segment.distanceMeters,
          estimatedDurationSeconds:
            typeof patch.estimatedDurationSeconds === 'number'
              ? Math.round(patch.estimatedDurationSeconds)
              : undefined,
          durationUpdatedAt:
            typeof patch.estimatedDurationSeconds === 'number' ? patch.durationUpdatedAt : undefined,
          estimatedTollYuan:
            typeof patch.estimatedTollYuan === 'number'
              ? Math.round(patch.estimatedTollYuan * 100) / 100
              : undefined,
          tollDistanceMeters:
            typeof patch.tollDistanceMeters === 'number' ? Math.round(patch.tollDistanceMeters) : undefined,
          tollUpdatedAt: typeof patch.estimatedTollYuan === 'number' ? patch.tollUpdatedAt : undefined,
          routeBuildKey: patch.routeBuildKey,
        }
      })

      return dayChanged ? { ...day, routeSegments: nextSegments } : day
    })

    return hasTripChanges ? { ...trip, days: nextDays } : trip
  })

  return changed ? { ...previous, trips: nextTrips } : previous
}

/**
 * 每个路段只执行一次完整 put，将折线、汇总指标和道路分析写进同一条 IndexedDB 记录。
 */
export async function persistResolvedRoutePatches(
  patches: readonly ResolvedRoutePatch[],
): Promise<void> {
  const uniquePatches = [...indexPatchesBySegment(patches).values()]
  await Promise.all(uniquePatches.map((patch) => savePlannedSegmentRouteCache({
    segmentId: patch.segmentId,
    routeBuildKey: patch.routeBuildKey,
    points: patch.points,
    distanceMeters: patch.distanceMeters,
    estimatedDurationSeconds: patch.estimatedDurationSeconds,
    durationUpdatedAt: patch.durationUpdatedAt,
    estimatedTollYuan: patch.estimatedTollYuan,
    tollDistanceMeters: patch.tollDistanceMeters,
    tollUpdatedAt: patch.tollUpdatedAt,
    roadParts: patch.roadParts,
    roadAnalysis: patch.roadAnalysis,
  })))
}

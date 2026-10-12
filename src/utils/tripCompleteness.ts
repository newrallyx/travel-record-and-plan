import type { Trip } from '../types/trip.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import type { TravelRecordTarget } from './travelRetrospective.ts'
import { getNaturalTripDayCount, parseIsoDateUtc } from './tripStatistics.ts'
import { getSegmentDrivingDurationSeconds } from './durations.ts'
import { getRoadAnalysisFreshness, isRoadAnalysisApplicableRouteType } from './routeBuildKey.ts'

export interface CompletenessItem extends TravelRecordTarget {
  tripTitle: string
  date: string
  segmentName: string
  required: string[]
  optional: string[]
  analysis: string | null
}

const validNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validScore = (value: unknown) => validNumber(value) && (value as number) >= 1 && (value as number) <= 10

/** Shares statistics' missing-value/freshness rules; never modifies records or fills blanks. */
export function buildTripCompletenessItems(trips: readonly Trip[], caches: readonly RouteCacheRecord[], cacheReady: boolean): CompletenessItem[] {
  const byId = new Map(caches.map(cache => [cache.segmentId, cache]))
  const items: CompletenessItem[] = []
  for (const trip of trips) {
    if (trip.category !== 'review') continue
    if (getNaturalTripDayCount(trip) === null) items.push({ tripId: trip.id, dayId: '', segmentId: '',
      tripTitle: trip.title, date: '', segmentName: '旅程日期', required: ['旅程起止日期待核对'], optional: [], analysis: null })
    for (const day of trip.days) for (const segment of day.routeSegments) {
      const required: string[] = [], optional: string[] = []
      if (parseIsoDateUtc(day.date) === null) required.push('当天日期待核对')
      if (!validNumber(segment.distanceMeters)) required.push('规划里程待计算')
      const driving = (segment.routeType ?? 'DRIVING') === 'DRIVING'
      if (driving && getSegmentDrivingDurationSeconds(segment) === null) required.push('预计驾驶时间待计算或已过期')
      if (!validNumber(segment.reviewFacts?.actual?.distanceMeters)) optional.push('实际里程未记录')
      if (driving && !validNumber(segment.reviewFacts?.actual?.durationSeconds)) optional.push('实际驾驶时间未记录')
      if (!validScore(segment.scenicScore)) optional.push('风景未评分')
      if (!validScore(segment.difficultyScore)) optional.push('难度未评分')
      let analysis: string | null = null
      if (cacheReady && isRoadAnalysisApplicableRouteType(segment.routeType)) {
        const cache = byId.get(segment.id)
        const freshness = cache ? getRoadAnalysisFreshness(segment, cache) : 'missing'
        analysis = freshness === 'missing' ? '道路待分析' : freshness === 'stale' ? '道路分析已过期'
          : cache?.roadAnalysis?.status !== 'complete' ? '道路分析部分完整' : null
      }
      if (required.length || optional.length || analysis) items.push({ tripId: trip.id, dayId: day.id, segmentId: segment.id,
        tripTitle: trip.title, date: day.date, segmentName: segment.name || `${segment.startPoint} → ${segment.endPoint}`,
        required, optional, analysis })
    }
  }
  return items
}

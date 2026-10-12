import type { Trip, RouteSegment } from '../types/trip.ts'
import type { LinkedPhotoRecord } from '../types/photo.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import { namedRoadEntries, summarizeRoadStatisticsComparison } from './roadStatisticsComparison.ts'
import { parseIsoDateUtc, summarizeSegmentRoadDistances } from './tripStatistics.ts'
import { canDisplaySegmentRouteCache, canReuseRecordedRoute } from './routeBuildKey.ts'

export interface TravelRecordTarget {
  tripId: string
  dayId: string
  segmentId: string
}

export interface RoadVisit extends TravelRecordTarget {
  tripTitle: string
  date: string
  segment: RouteSegment
  distanceMeters: number
}

/** 每行代表一个路段中的该道路，重复片段累计里程，不冒充经过次数。 */
export function buildRoadArchive(trips: readonly Trip[], caches: readonly RouteCacheRecord[]) {
  const cacheById = new Map(caches.map(cache => [cache.segmentId, cache]))
  const archive = new Map<string, RoadVisit[]>()
  for (const trip of trips) {
    if (trip.category !== 'review') continue
    for (const day of trip.days) for (const segment of day.routeSegments) {
      const entries = namedRoadEntries(summarizeSegmentRoadDistances(segment, cacheById.get(segment.id)))
      // 与命名路线表相同的身份归并规则。
      for (const entry of new Map(entries.map(entry => [entry.key, entry])).values()) {
        const visits = archive.get(entry.key) ?? []
        visits.push({ tripId: trip.id, tripTitle: trip.title, dayId: day.id, segmentId: segment.id,
          date: day.date || segment.date || '', segment, distanceMeters: entry.distanceMeters })
        archive.set(entry.key, visits)
      }
    }
  }
  for (const visits of archive.values()) visits.sort((a, b) => {
    const left = parseIsoDateUtc(a.date), right = parseIsoDateUtc(b.date)
    if (left === null && right !== null) return 1
    if (right === null && left !== null) return -1
    return (left !== null && right !== null ? right - left : 0) || a.segmentId.localeCompare(b.segmentId)
  })
  return archive
}

export function getAnnualReviewYears(trips: readonly Trip[]) {
  return [...new Set(trips.filter(trip => trip.category === 'review' && parseIsoDateUtc(trip.startDate) !== null)
    .map(trip => trip.startDate.slice(0, 4)))].sort().reverse()
}

export function getSavedTravelSegments(trips: readonly Trip[], caches: readonly RouteCacheRecord[]): RouteSegment[] {
  const cacheById = new Map(caches.map(cache => [cache.segmentId, cache]))
  return trips.flatMap(trip => trip.days.flatMap(day => day.routeSegments)).flatMap(segment => {
    if (canReuseRecordedRoute(segment)) return [segment]
    const cache = cacheById.get(segment.id)
    if (cache && cache.points.length >= 2 && canDisplaySegmentRouteCache(segment, cache.routeBuildKey)) {
      return [{ ...segment, points: cache.points, routeBuildKey: cache.routeBuildKey }]
    }
    return []
  })
}

export function buildAnnualReview(trips: readonly Trip[], caches: readonly RouteCacheRecord[], year: string) {
  const annualTrips = trips.filter(trip => trip.category === 'review'
    && parseIsoDateUtc(trip.startDate) !== null && trip.startDate.slice(0, 4) === year)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  const statistics = summarizeRoadStatisticsComparison(annualTrips, annualTrips, caches)
  const summary = statistics.current
  const longest = (field: 'plannedDistanceMeters' | 'actualDistanceMeters') => summary.tripBreakdown
    .filter(row => row[field].completeness.status === 'complete' && row[field].value !== null)
    .sort((a, b) => b[field].value! - a[field].value! || a.startDate.localeCompare(b.startDate))[0] ?? null
  const scenicSegments = annualTrips.flatMap(trip => trip.days.flatMap(day => day.routeSegments
    .filter(segment => typeof segment.scenicScore === 'number' && Number.isFinite(segment.scenicScore)
      && segment.scenicScore >= 7 && segment.scenicScore <= 10)
    .map(segment => ({ tripId: trip.id, tripTitle: trip.title, dayId: day.id, segmentId: segment.id, date: day.date, segment }))))
    .sort((a, b) => b.segment.scenicScore! - a.segment.scenicScore! || a.date.localeCompare(b.date) || a.segmentId.localeCompare(b.segmentId))
    .slice(0, 5)
  const roads = statistics.namedRoads.filter(road => road.currentRoadPartCount > 0)
    .sort((a, b) => (b.historicalTripCount ?? 0) - (a.historicalTripCount ?? 0)
      || (b.currentDistanceMeters ?? 0) - (a.currentDistanceMeters ?? 0) || a.key.localeCompare(b.key)).slice(0, 5)
  const mapSegments = getSavedTravelSegments(annualTrips, caches)
  return { year, trips: annualTrips, summary, longestPlanned: longest('plannedDistanceMeters'),
    longestActual: longest('actualDistanceMeters'), roads, scenicSegments, mapSegments,
    missingMapSegmentCount: summary.segmentCount - mapSegments.length }
}

export type AnnualReview = ReturnType<typeof buildAnnualReview>

export function getAnnualPhotoCandidates(trips: readonly Trip[], photos: readonly LinkedPhotoRecord[]) {
  const records = new Map(photos.map(photo => [photo.id, photo]))
  const result: Array<{ photo: LinkedPhotoRecord; trip: Trip; target: TravelRecordTarget }> = []
  const seen = new Set<string>()
  for (const trip of trips) for (const day of trip.days) for (const segment of day.routeSegments) {
    for (const id of segment.photoIds ?? []) {
      const photo = records.get(id)
      if (!photo || photo.segmentId !== segment.id || seen.has(id)) continue
      result.push({ photo, trip, target: { tripId: trip.id, dayId: day.id, segmentId: segment.id } })
      seen.add(id)
    }
  }
  return result
}

export function selectAnnualPhotoDefaults(candidates: ReturnType<typeof getAnnualPhotoCandidates>, limit = 6) {
  const trips = [...new Set(candidates.map(candidate => candidate.trip))]
  const ids = trips.map(trip => candidates.find(item => item.trip.id === trip.id && item.photo.id === trip.coverPhotoId)
    ?? candidates.find(item => item.trip.id === trip.id)).map(item => item!.photo.id)
  return [...new Set([...ids, ...candidates.map(item => item.photo.id)])].slice(0, limit)
}

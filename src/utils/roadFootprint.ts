import type { Trip } from '../types/trip.ts'
import type { RouteRoadPart } from '../types/roadStatistics.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import type { SegmentTrack } from '../components/map/types.ts'
import { canReuseRecordedRoute, getRoadAnalysisFreshness } from './routeBuildKey.ts'
import { extractRouteRef } from './roadClassifier.ts'
import { roadIdentityKey, roadMembershipParts } from './roadMemberships.ts'
import { parseIsoDateUtc } from './tripStatistics.ts'
import type { TravelRecordTarget } from './travelRetrospective.ts'

export interface RoadFootprintRecord extends TravelRecordTarget {
  sourceId: string
  tripTitle: string
  segmentName: string
  date: string
}

/** Same identity as named-road statistics, including pending/unnumbered groups. */
export function roadFootprintKey(part: RouteRoadPart): string | null {
  return roadIdentityKey(part)
}

export function buildRoadFootprint(trips: readonly Trip[], caches: readonly RouteCacheRecord[], roadKey: string, year = '') {
  const cacheById = new Map(caches.map(cache => [cache.segmentId, cache]))
  const tracks: SegmentTrack[] = []
  const records: RoadFootprintRecord[] = []
  const passageTracks: SegmentTrack[] = []
  const passageRecords: RoadFootprintRecord[] = []
  const years = new Set<string>()
  let missingGeometry = 0
  for (const trip of trips) {
    if (trip.category !== 'review') continue
    for (const day of trip.days) for (const segment of day.routeSegments) {
      const cache = cacheById.get(segment.id)
      if (!cache || getRoadAnalysisFreshness(segment, cache) !== 'current') continue
      const parts = cache.roadParts ?? []
      const selectedPart = (part: RouteRoadPart) => roadMembershipParts(part).find(road => roadFootprintKey(road) === roadKey)
      const selectedRoad = parts.some(part => selectedPart(part))
      const date = day.date || segment.date || ''
      const recordYear = parseIsoDateUtc(date) === null ? '' : date.slice(0, 4)
      if (selectedRoad && recordYear) years.add(recordYear)
      if (year && recordYear !== year) continue
      // Keep representative ordering aligned with the main map's segment IDs,
      // while retaining distinct sources if local IDs repeat across trips/days.
      const sourceId = JSON.stringify([segment.id, trip.id, day.id])
      const record = { sourceId, tripId: trip.id, dayId: day.id, segmentId: segment.id,
        tripTitle: trip.title, segmentName: segment.name, date }
      // Match the main map's original geometry and current analysis before filtering
      // the displayed road. A matching passage may have pending province metadata
      // or an older automatic road label that the shared aggregation resolves.
      const originalLine = canReuseRecordedRoute(segment) ? segment.points! : cache.points
      passageTracks.push({ segmentId: sourceId, segmentName: segment.name, points: [], line: originalLine,
        roadParts: parts.map(part => selectedPart(part) ?? part) })
      passageRecords.push(record)
      if (!selectedRoad) continue
      const line: SegmentTrack['line'] = []
      const selectedParts: RouteRoadPart[] = []
      let continuous = false
      for (const part of parts) {
        const membership = selectedPart(part)
        if (!membership || !Number.isFinite(part.distanceMeters) || part.distanceMeters < 0) {
          continuous = false; continue
        }
        const points = part.polyline ?? []
        const valid = ([lat, lon]: number[]) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) < 85 && Math.abs(lon) <= 180
        if (!points.some((p, i) => i > 0 && valid(p) && valid(points[i - 1]))) {
          missingGeometry++; continuous = false; continue
        }
        selectedParts.push({ ...membership, routeRef: extractRouteRef(membership.routeRef) ?? undefined })
        const previous = line[line.length - 1]
        const joins = continuous && previous && previous.lat === points[0][0] && previous.lon === points[0][1]
        // Invalid separator is intentional: aggregation skips both adjacent edges,
        // so disconnected fragments never gain an invented straight connection.
        if (line.length && !joins) line.push({ lat: 90, lon: 0 })
        line.push(...points.slice(joins ? 1 : 0).map(([lat, lon]) => ({ lat, lon })))
        continuous = true
      }
      if (!selectedParts.length) continue
      tracks.push({ segmentId: sourceId, segmentName: segment.name, points: [], line, roadParts: selectedParts })
      records.push(record)
    }
  }
  records.sort((a, b) => b.date.localeCompare(a.date) || a.sourceId.localeCompare(b.sourceId))
  passageRecords.sort((a, b) => b.date.localeCompare(a.date) || a.sourceId.localeCompare(b.sourceId))
  return { tracks, records, passageTracks, passageRecords, years: [...years].sort().reverse(), missingGeometry }
}

export const FOOTPRINT_COLORS = ['#2563eb', '#0891b2', '#ca8a04', '#ea580c', '#dc2626']
export const FOOTPRINT_LABELS = ['1 次', '2–3 次', '4–7 次', '8–15 次', '16 次以上']
export const footprintColor = (count: number) => FOOTPRINT_COLORS[count >= 16 ? 4 : count >= 8 ? 3 : count >= 4 ? 2 : count >= 2 ? 1 : 0]

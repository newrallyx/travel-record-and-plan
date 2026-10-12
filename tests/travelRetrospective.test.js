import assert from 'node:assert/strict'
import test from 'node:test'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { summarizeRoadStatisticsComparison } from '../src/utils/roadStatisticsComparison.ts'
import { buildRoadArchive, buildAnnualReview, getAnnualReviewYears, getAnnualPhotoCandidates, selectAnnualPhotoDefaults, getSavedTravelSegments } from '../src/utils/travelRetrospective.ts'
import { buildAnnualReviewHtml, buildAnnualRouteSvg } from '../src/utils/annualReviewExport.ts'

function segment(id, extra = {}) {
  const value = { id, name: id, startPoint: '西安', endPoint: '成都', routeType: 'DRIVING', preference: 'HIGHWAY_FIRST', distanceMeters: 1000, ...extra }
  return { ...value, routeBuildKey: buildSegmentRouteKey(value) }
}
function trip(id, segments, extra = {}) {
  return { id, title: id, category: 'review', startDate: '2026-09-01', endDate: '2026-09-01', days: [{ id: `${id}-day`, date: '2026-09-01', routeSegments: segments }], ...extra }
}
const part = (distanceMeters, roadClass = 'NATIONAL_ROAD', routeRef = 'G318', extra = {}) => ({ distanceMeters, roadClass, routeRef, roadName: '道路', source: 'MANUAL', confidence: 'HIGH', ...extra })
function cache(segment, parts) {
  const distance = parts.reduce((sum, part) => sum + part.distanceMeters, 0)
  return { segmentId: segment.id, routeBuildKey: segment.routeBuildKey, updatedAt: 1, points: [{ lat: 30, lon: 104 }, { lat: 34, lon: 108 }], roadParts: parts,
    roadAnalysis: { schemaVersion: 1, classifierVersion: ROAD_CLASSIFIER_VERSION, analyzedAt: '2026-09-30T00:00:00Z', routeBuildKey: segment.routeBuildKey, coverageMeters: distance, routeDistanceMeters: distance, coverageRatio: 1, status: 'complete' } }
}

test('road archive agrees with existing totals, accumulates repeated parts and excludes plans and stale analysis', () => {
  const a = segment('a'), b = segment('b'), stale = segment('stale'), planned = segment('plan')
  const trips = [trip('one', [a, b, stale]), trip('future', [planned], { category: 'plan' })]
  const staleCache = cache(stale, [part(500)])
  staleCache.roadAnalysis.classifierVersion = 'old'
  const caches = [cache(a, [part(100), part(200)]), cache(b, [part(400)]), staleCache, cache(planned, [part(1000)])]
  const archive = buildRoadArchive(trips, caches)
  const visits = archive.get('NATIONAL_ROAD:G318')
  assert.equal(visits.length, 2)
  assert.equal(new Set(visits.map(visit => visit.tripId)).size, 1)
  assert.equal(visits.reduce((sum, visit) => sum + visit.distanceMeters, 0), 700)
  const existing = summarizeRoadStatisticsComparison(trips.filter(trip => trip.category === 'review'), trips, caches).namedRoads[0]
  assert.equal(existing.historicalDistanceMeters, 700)
  assert.equal(existing.historicalTripCount, 1)
})

test('road archive preserves province identity, pending provinces and unnumbered groups', () => {
  const segments = ['s1', 's2', 's3', 's4'].map(id => segment(id))
  const caches = [cache(segments[0], [part(100, 'PROVINCIAL_ROAD', 's-101', { provinceCode: '61', provinceName: '陕西' })]),
    cache(segments[1], [part(200, 'PROVINCIAL_ROAD', 'S101', { provinceCode: '62', provinceName: '甘肃' })]),
    cache(segments[2], [part(300, 'PROVINCIAL_ROAD', 'S101')]), cache(segments[3], [part(100, 'EXPRESSWAY', undefined)])]
  caches[3].roadParts[0].routeRef = undefined
  const archive = buildRoadArchive([trip('t', segments)], caches)
  assert.deepEqual([...archive.keys()].sort(), ['EXPRESSWAY:UNNUMBERED', 'PROVINCIAL_ROAD:61:S101', 'PROVINCIAL_ROAD:62:S101', 'PROVINCIAL_ROAD:PENDING:S101'])
})

test('annual review assigns entire cross-year trips to start year and validates dates', () => {
  const trips = [trip('cross', [segment('cross')], { startDate: '2025-12-31', endDate: '2026-01-02' }),
    trip('current', [segment('current')]), trip('plan', [], { category: 'plan' }),
    trip('bad', [], { startDate: '2027-02-30' })]
  assert.deepEqual(getAnnualReviewYears(trips), ['2026', '2025'])
  assert.deepEqual(buildAnnualReview(trips, [], '2026').trips.map(trip => trip.id), ['current'])
  assert.deepEqual(buildAnnualReview(trips, [], '2025').trips.map(trip => trip.id), ['cross'])
})

test('longest trips keep actual separate and incomplete subtotals out of rankings', () => {
  const trips = [trip('planned-longest', [segment('p', { distanceMeters: 2000 })]),
    trip('actual-longest', [segment('a', { distanceMeters: 1000, reviewFacts: { actual: { distanceMeters: 1500 } } })]),
    trip('partial', [segment('partial-a', { distanceMeters: 99999, reviewFacts: { actual: { distanceMeters: 99999 } } }), segment('partial-b', { distanceMeters: undefined })])]
  const report = buildAnnualReview(trips, [], '2026')
  assert.equal(report.longestPlanned.tripId, 'planned-longest')
  assert.equal(report.longestActual.tripId, 'actual-longest')
  assert.equal(report.summary.actualDistanceMeters.completeness.status, 'partial')
  assert.equal(buildAnnualReview([trips[0]], [], '2026').longestActual, null)
})

test('annual common roads count trips, scenic highlights exclude invalid or missing scores', () => {
  const segments = [segment('a', { scenicScore: 9 }), segment('b', { scenicScore: 7 }), segment('invalid', { scenicScore: 11 }), segment('missing')]
  const trips = [trip('one', [segments[0], segments[2]]), trip('two', [segments[1], segments[3]])]
  const caches = segments.map(item => cache(item, [part(100), part(200)]))
  const report = buildAnnualReview(trips, caches, '2026')
  assert.equal(report.roads[0].historicalTripCount, 2)
  assert.equal(report.roads[0].currentDistanceMeters, 1200)
  assert.deepEqual(report.scenicSegments.map(item => item.segmentId), ['a', 'b'])
})

test('annual map uses matching recorded geometry only, without replanning or mutation', () => {
  const good = segment('good'), invalid = segment('invalid'), recorded = segment('recorded', { points: [{ lat: 30, lon: 104 }, { lat: 30.1, lon: 104.1 }] })
  const caches = [cache(good, []), { ...cache(invalid, []), routeBuildKey: 'old-key' }]
  const original = JSON.stringify({ good, invalid, recorded, caches })
  assert.deepEqual(getSavedTravelSegments([trip('t', [good, invalid, recorded])], caches).map(segment => segment.id), ['good', 'recorded'])
  assert.equal(JSON.stringify({ good, invalid, recorded, caches }), original)
})

test('photo candidates enforce associations and ownership; defaults prioritize covers and trip diversity', () => {
  const a = segment('a', { photoIds: ['a1', 'a2', 'foreign', 'missing'] }), b = segment('b', { photoIds: ['b1'] })
  const trips = [trip('one', [a], { coverPhotoId: 'a2' }), trip('two', [b])]
  const photos = [{ id: 'a1', segmentId: 'a' }, { id: 'a2', segmentId: 'a' }, { id: 'foreign', segmentId: 'b' }, { id: 'b1', segmentId: 'b' }, { id: 'orphan', segmentId: 'a' }]
  const candidates = getAnnualPhotoCandidates(trips, photos)
  assert.deepEqual(candidates.map(item => item.photo.id), ['a1', 'a2', 'b1'])
  assert.deepEqual(selectAnnualPhotoDefaults(candidates, 2), ['a2', 'b1'])
  assert.deepEqual(getAnnualPhotoCandidates([], photos), [])
})

test('offline annual export escapes user text and rejects active image URLs, preserves missing values', () => {
  const report = buildAnnualReview([trip('<script>alert(1)</script>', [segment('route', { scenicScore: 9 })])], [], '2026')
  const html = buildAnnualReviewHtml(report, [{ filename: '<img onerror="alert(1)">', caption: '&照片', dataUrl: 'javascript:alert(1)' }])
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('javascript:'))
  assert.ok(html.includes('实际里程<strong>待补全'))
  assert.ok(html.includes('缩略图不可用'))
  const svg = buildAnnualRouteSvg([segment('a', { points: [{ lat: 30, lon: 104 }, { lat: 31, lon: 105 }] }), segment('b', { points: [{ lat: 40, lon: 110 }, { lat: 41, lon: 111 }] })])
  assert.equal((svg.match(/<polyline /g) ?? []).length, 2)
  assert.ok(!svg.includes('NaN'))
})

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { normalizeConcurrentRoads, roadIdentityKey, roadMembershipParts } from '../src/utils/roadMemberships.ts'
import { preserveConcurrentRoadIntervals } from '../src/utils/concurrentRoadIntervals.ts'
import { buildRoadFootprint } from '../src/utils/roadFootprint.ts'
import { aggregateOverviewTracks, buildRoadFootprintLines } from '../src/components/map/overviewAggregation.ts'
import { summarizeRoadStatisticsComparison } from '../src/utils/roadStatisticsComparison.ts'
import { buildRoadArchive } from '../src/utils/travelRetrospective.ts'
import { getSegmentRouteCache, replaceAllSegmentRouteCache, saveManualRoadPartCorrection, restoreAutomaticRoadPartCorrection,
  saveHistoricalRoadAnalysisOnly, saveManualRoadIntervalAnnotation, revokeManualRoadIntervalAnnotation } from '../src/services/routeCacheDb.ts'
import { buildTripBackupPayload, parseTripBackupJson } from '../src/services/tripBackup.ts'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
const point = (x, y = 0) => [34 + y / 111319.49, 109 + x / (111319.49 * Math.cos(34 * Math.PI / 180))]
const national = ref => ({ roadClass: 'NATIONAL_ROAD', routeRef: ref })
const expressway = ref => ({ roadClass: 'EXPRESSWAY', routeRef: ref })
const provincial = (ref, provinceCode = '610000') => ({ roadClass: 'PROVINCIAL_ROAD', routeRef: ref, provinceCode })
const part = (from, to, extra = {}) => ({ ...national('G210'), roadName: 'G210 国道', distanceMeters: Math.abs(to - from),
  source: 'ROAD_CODE', confidence: 'HIGH', polyline: [point(from), point(to)], ...extra })
function fixture(id, parts, date = '2026-09-01', category = 'review') {
  const points = parts.flatMap(p => p.polyline.map(([lat, lon]) => ({ lat, lon })))
  const distanceMeters = parts.reduce((sum, p) => sum + p.distanceMeters, 0)
  const segment = { id, name: id, startPoint: '起点', endPoint: '终点', routeType: 'DRIVING', preference: 'HIGHWAY_FIRST', distanceMeters }
  const routeBuildKey = buildSegmentRouteKey(segment)
  return { segment, trip: { id, title: id, category, startDate: date, endDate: date, days: [{ id: id + '-day', date, routeSegments: [segment] }] },
    cache: { segmentId: id, routeBuildKey, updatedAt: 1, points, distanceMeters, roadParts: parts,
      roadAnalysis: { schemaVersion: 1, classifierVersion: ROAD_CLASSIFIER_VERSION, routeBuildKey, analyzedAt: date, coverageMeters: distanceMeters, status: 'complete' } } }
}
const footprint = (fixtures, key, year = '') => buildRoadFootprint(fixtures.map(f => f.trip), fixtures.map(f => f.cache), key, year)
const draw = data => buildRoadFootprintLines(aggregateOverviewTracks(data.passageTracks, false), aggregateOverviewTracks(data.tracks, false))

test('three route identities share real geometry and mileage without multiplying passages or records', () => {
  const f = fixture('three', [part(0, 1000, { concurrentRoads: [national('G316'), national('G211'), national('G316'), national('G210')] })])
  const before = structuredClone(f)
  const summary = summarizeRoadStatisticsComparison([f.trip], [f.trip], [f.cache])
  assert.equal(summary.current.roadClassDistance.analyzedDistanceMeters, 1000)
  assert.equal(summary.composition.find(row => row.roadClass === 'NATIONAL_ROAD').currentDistanceMeters, 1000)
  assert.equal(summary.current.plannedDistanceMeters.value, 1000)
  assert.deepEqual(summary.namedRoads.map(row => [row.key, row.currentDistanceMeters, row.historicalTripCount]).sort(),
    ['G210', 'G211', 'G316'].map(ref => [`NATIONAL_ROAD:${ref}`, 1000, 1]))
  const archive = buildRoadArchive([f.trip], [f.cache])
  for (const ref of ['G210', 'G211', 'G316']) {
    const key = `NATIONAL_ROAD:${ref}`, data = footprint([f], key), lines = draw(data)
    assert.equal(data.records.length, 1)
    assert.ok(lines.length && lines.every(line => line.count === 1 && line.sourceIds.length === 1))
    assert.equal(archive.get(key).length, 1)
    assert.equal(archive.get(key)[0].distanceMeters, 1000)
  }
  assert.deepEqual(f, before)
})

test('G316 includes only marked G210 and G211 intervals, with genuine gaps retained', () => {
  const f = fixture('g316', [part(0, 200, { routeRef: 'G316' }), part(200, 600, { concurrentRoads: [national('G316')] }),
    part(600, 800), part(800, 1000, { routeRef: 'G211', concurrentRoads: [national('G316')] })])
  const data = footprint([f], 'NATIONAL_ROAD:G316'), lines = draw(data)
  assert.equal(data.records.length, 1)
  assert.ok(lines.length && lines.every(line => line.count === 1))
  assert.ok(lines.some(line => line.positions.some(p => p[1] > point(300)[1] && p[1] < point(500)[1])))
  assert.ok(lines.every(line => line.positions.every(p => p[1] <= point(600)[1] + 1e-9) || line.positions.every(p => p[1] >= point(800)[1] - 1e-9)))
  const summary = summarizeRoadStatisticsComparison([f.trip], [f.trip], [f.cache])
  assert.equal(summary.namedRoads.find(row => row.routeRef === 'G316').currentDistanceMeters, 800)
  assert.equal(summary.namedRoads.find(row => row.routeRef === 'G210').currentDistanceMeters, 600)
})

test('highways and provincial roads support multiple identities and provinces stay separate', () => {
  const identities = [expressway('G70'), { ...expressway('S12'), provinceCode: '610000' }, provincial('S101'), provincial('S101', '620000')]
  const f = fixture('mixed', [part(0, 1000, { ...expressway('G22'), concurrentRoads: identities })])
  const summary = summarizeRoadStatisticsComparison([f.trip], [f.trip], [f.cache])
  assert.equal(summary.composition.find(row => row.roadClass === 'EXPRESSWAY').currentDistanceMeters, 1000)
  assert.equal(summary.composition.find(row => row.roadClass === 'PROVINCIAL_ROAD').currentDistanceMeters, 0)
  for (const road of [expressway('G22'), ...identities]) {
    const key = roadIdentityKey(road)
    assert.equal(summary.namedRoads.find(row => row.key === key).currentDistanceMeters, 1000)
    assert.ok(draw(footprint([f], key)).every(line => line.count === 1))
  }
  assert.equal(footprint([f], 'PROVINCIAL_ROAD:110000:S101').tracks.length, 0)
  assert.equal(roadMembershipParts(f.cache.roadParts[0])[1].roadName, undefined)
})

test('partial overlap, opposite carriageways, years and true returns keep physical passage counts', () => {
  const a = fixture('a', [part(0, 1000, { concurrentRoads: [national('G316'), national('G211')] })])
  const b = fixture('b', [part(800, 200, { routeRef: 'G316', polyline: [point(800, 35), point(200, 35)] })], '2025-09-01')
  const lines = draw(footprint([a, b], 'NATIONAL_ROAD:G316'))
  assert.deepEqual([...new Set(lines.map(line => line.count))].sort(), [1, 2])
  assert.ok(lines.some(line => line.count === 2 && line.sourceIds.length === 2))
  assert.ok(draw(footprint([a, b], 'NATIONAL_ROAD:G316', '2026')).every(line => line.count === 1))
  const returnTrip = fixture('return', [part(0, 1000, { concurrentRoads: [national('G316')] }), part(1000, 0, { concurrentRoads: [national('G316')] })])
  assert.ok(draw(footprint([returnTrip], 'NATIONAL_ROAD:G316')).every(line => line.count === 2 && line.sourceIds.length === 1))
  const stale = structuredClone(a); stale.cache.roadAnalysis.classifierVersion = 'old'
  const plan = fixture('plan', a.cache.roadParts, '2026-09-01', 'plan')
  assert.equal(footprint([stale, plan], 'NATIONAL_ROAD:G316').tracks.length, 0)
})

test('strict saves reject malformed identifiers and missing provinces, while deduplicating memberships', () => {
  const primary = national('G210')
  assert.deepEqual(normalizeConcurrentRoads([national('g-316'), national('G316'), national('G210')], primary, true), [national('G316')])
  for (const road of [national('G316/G211'), national('G70'), expressway('G316'), provincial('S101', ''), { ...expressway('S12') }]) {
    assert.throws(() => normalizeConcurrentRoads([road], primary, true), /类型匹配/)
  }
})

test('cache save, backup restore, removing one alias and restoring automatic classification are reversible', async () => {
  const f = fixture('save', [part(0, 1000)])
  await replaceAllSegmentRouteCache([f.cache])
  await saveManualRoadPartCorrection(f.segment.id, 0, { ...national('G210'), concurrentRoads: [national('G316'), provincial('S101')] })
  let saved = await getSegmentRouteCache(f.segment.id)
  assert.deepEqual(saved.roadParts[0].concurrentRoads, [national('G316'), provincial('S101')])
  assert.deepEqual(saved.points, f.cache.points)
  const payload = buildTripBackupPayload({ trips: [f.trip] }, [saved], new Date('2026-10-07T00:00:00.000Z'))
  const imported = parseTripBackupJson(JSON.stringify(payload))
  await replaceAllSegmentRouteCache(imported.segmentRoutes)
  saved = await getSegmentRouteCache(f.segment.id)
  assert.deepEqual(saved.roadParts[0].concurrentRoads, [national('G316'), provincial('S101')])
  await saveManualRoadPartCorrection(f.segment.id, 0, { ...national('G210'), concurrentRoads: [provincial('S101')] })
  assert.deepEqual((await getSegmentRouteCache(f.segment.id)).roadParts[0].concurrentRoads, [provincial('S101')])
  await restoreAutomaticRoadPartCorrection(f.segment.id, 0)
  saved = await getSegmentRouteCache(f.segment.id)
  assert.equal(saved.roadParts[0].routeRef, 'G210')
  assert.equal(saved.roadParts[0].concurrentRoads, undefined)
  await assert.rejects(saveManualRoadPartCorrection(f.segment.id, 0, { ...national('G210'), concurrentRoads: [provincial('S101', '')] }), /选择省份/)
})

test('manual interval supports three roads only inside selected bounds and revocation restores base', async () => {
  const f = fixture('interval', [part(0, 250), part(250, 750), part(750, 1000)])
  await replaceAllSegmentRouteCache([f.cache])
  const annotation = await saveManualRoadIntervalAnnotation({ segment: f.segment, startPointIndex: 1, endPointIndex: 3,
    ...national('G210'), concurrentRoads: [national('G316'), provincial('S101')] })
  f.cache = await getSegmentRouteCache(f.segment.id)
  assert.equal(f.cache.roadParts.reduce((sum, p) => sum + p.distanceMeters, 0), 1000)
  assert.equal(f.cache.manualRoadAnnotations[0].concurrentRoads.length, 2)
  const ownedIndex = f.cache.roadParts.findIndex(p => p.manualAnnotationId === annotation.id)
  await assert.rejects(saveManualRoadPartCorrection(f.segment.id, ownedIndex, { ...national('G210'), concurrentRoads: [national('G211')] }), /区间标注列表/)
  await assert.rejects(restoreAutomaticRoadPartCorrection(f.segment.id, ownedIndex), /区间标注列表/)
  const lines = draw(footprint([f], 'NATIONAL_ROAD:G316'))
  assert.ok(lines.length && lines.every(line => line.positions.every(p => p[1] >= point(250)[1] - 1e-9 && p[1] <= point(750)[1] + 1e-9)))
  await revokeManualRoadIntervalAnnotation(f.segment.id, annotation.id)
  f.cache = await getSegmentRouteCache(f.segment.id)
  assert.equal(footprint([f], 'NATIONAL_ROAD:G316').tracks.length, 0)
  assert.deepEqual(f.cache.roadParts, [part(0, 250), part(250, 750), part(750, 1000)])
})

test('automatic reanalysis with different step boundaries preserves only the original concurrent corridor', async () => {
  const f = fixture('reanalyze', [part(0, 250), part(250, 750, { source: 'MANUAL', concurrentRoads: [national('G316'), national('G211')] }), part(750, 1000)])
  await replaceAllSegmentRouteCache([f.cache])
  const automatic = [part(0, 1000)]
  const before = structuredClone(automatic)
  const rebuilt = preserveConcurrentRoadIntervals(automatic, [f.cache.roadParts[1]])
  assert.deepEqual(rebuilt.map(p => [Math.round(p.distanceMeters), p.concurrentRoads?.length ?? 0]), [[250, 0], [500, 2], [250, 0]])
  assert.equal(rebuilt.reduce((sum, p) => sum + p.distanceMeters, 0), 1000)
  assert.deepEqual(automatic, before)
  assert.equal(preserveConcurrentRoadIntervals([part(0, 1000, { polyline: [point(0, 100), point(1000, 100)] })], [f.cache.roadParts[1]])[0].concurrentRoads, undefined)
  await saveHistoricalRoadAnalysisOnly({ segment: f.segment, cache: f.cache, routeBuildKey: f.cache.routeBuildKey, savedPoints: f.cache.points,
    route: { roadParts: automatic, roadAnalysis: f.cache.roadAnalysis } })
  f.cache = await getSegmentRouteCache(f.segment.id)
  const summary = summarizeRoadStatisticsComparison([f.trip], [f.trip], [f.cache])
  assert.equal(summary.namedRoads.find(row => row.routeRef === 'G316').currentDistanceMeters, 500)
  assert.equal(summary.current.roadClassDistance.analyzedDistanceMeters, 1000)
  assert.equal(f.cache.points.length, 6)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { buildRoadFootprint, roadFootprintKey, footprintColor } from '../src/utils/roadFootprint.ts'
import { aggregateOverviewTracks, buildRoadFootprintLines, createOverviewPassageIndex } from '../src/components/map/overviewAggregation.ts'
import { buildRoadArchive } from '../src/utils/travelRetrospective.ts'

const point = (x, y = 0) => [34 + y / 111319.49, 109 + x / (111319.49 * Math.cos(34 * Math.PI / 180))]
const part = (points, extra = {}) => ({ roadClass: 'EXPRESSWAY', routeRef: 'G30', source: 'ROAD_CODE', confidence: 'HIGH', distanceMeters: 1000, polyline: points.map(p => point(...p)), ...extra })
function fixture(id, parts, date = '2026-09-01', category = 'review') {
  const segment = { id, name: id, startPoint: '起点', endPoint: '终点', routeType: 'DRIVING', preference: 'HIGHWAY_FIRST', distanceMeters: 1000 }
  const routeBuildKey = buildSegmentRouteKey(segment)
  return {
    trip: { id, title: id, category, startDate: date, endDate: date, days: [{ id: `${id}-day`, date, routeSegments: [segment] }] },
    cache: { segmentId: id, routeBuildKey, updatedAt: 1, points: [], roadParts: parts,
      roadAnalysis: { schemaVersion: 1, classifierVersion: ROAD_CLASSIFIER_VERSION, routeBuildKey, analyzedAt: date, coverageMeters: 1000, status: 'complete' } },
  }
}
const extract = (fixtures, key = 'EXPRESSWAY:G30', year = '') => buildRoadFootprint(fixtures.map(f => f.trip), fixtures.map(f => f.cache), key, year)
const render = data => buildRoadFootprintLines(aggregateOverviewTracks(data.tracks, false))
const renderWithPassages = data => buildRoadFootprintLines(
  aggregateOverviewTracks(data.passageTracks, false), aggregateOverviewTracks(data.tracks, false),
)
function withOriginalGeometry(f) {
  f.cache.points = f.cache.roadParts.flatMap(p => p.polyline.map(([lat, lon]) => ({ lat, lon })))
  return f
}

test('only selected-road geometry is drawn and disconnected fragments never bridge', () => {
  const f = fixture('a', [part([[0, 0], [100, 0]]), part([[100, 0], [500, 0]], { routeRef: 'G5' }), part([[500, 0], [600, 0]])])
  const original = structuredClone(f)
  const data = extract([f])
  const lines = render(data)
  assert.equal(data.records.length, 1)
  assert.equal(lines.length, 2)
  for (const line of lines) assert.ok(line.positions.every(p => p[1] <= point(101)[1]) || line.positions.every(p => p[1] >= point(499)[1]))
  assert.deepEqual(f, original)
})

test('identity matches statistics for normalized refs, province, pending and unnumbered roads', () => {
  for (const extra of [{ routeRef: 'g-30' }, { routeRef: 'S12', provinceCode: '61' }, { routeRef: 'S12' },
    { roadClass: 'PROVINCIAL_ROAD', routeRef: 'S101', provinceCode: '62' }, { roadClass: 'PROVINCIAL_ROAD', routeRef: undefined }, { routeRef: undefined }]) {
    const p = part([[0, 0], [100, 0]], extra), f = fixture('a', [p])
    assert.deepEqual([...buildRoadArchive([f.trip], [f.cache]).keys()], [roadFootprintKey(p)])
    assert.equal(extract([f], roadFootprintKey(p)).tracks.length, 1)
  }
  const a = fixture('a', [part([[0, 0], [100, 0]], { routeRef: 'S12', provinceCode: '61' })])
  const b = fixture('b', [part([[0, 0], [100, 0]], { routeRef: 'S12', provinceCode: '62' })])
  assert.equal(extract([a, b], 'EXPRESSWAY:61:S12').tracks.length, 1)
})

test('year uses record date; plans, stale analysis and missing geometry are excluded', () => {
  const a = fixture('a', [part([[0, 0], [100, 0]])], '2025-12-31')
  const b = fixture('b', [part([[0, 0], [100, 0]])], '2026-01-01')
  b.trip.startDate = '2025-12-31'
  const stale = fixture('stale', [part([[0, 0], [100, 0]])]); stale.cache.roadAnalysis.classifierVersion = 'old'
  const plan = fixture('plan', [part([[0, 0], [100, 0]])], '2026-01-01', 'plan')
  const missing = fixture('missing', [part([])])
  const data = extract([a, b, stale, plan, missing], 'EXPRESSWAY:G30', '2026')
  assert.deepEqual(data.records.map(r => r.tripId), ['b'])
  assert.deepEqual(data.years, ['2026', '2025'])
  assert.equal(data.missingGeometry, 1)
  assert.equal(extract([a], 'EXPRESSWAY:G30', '2027').tracks.length, 0)
})

test('adjacent analysis pieces count once but an outbound and return record counts twice', () => {
  const a = fixture('a', [part([[0, 0], [500, 0]]), part([[500, 0], [1000, 0]])])
  assert.ok(render(extract([a])).every(line => line.count === 1))
  a.cache.roadParts.push(part([[1000, 0], [0, 0]]))
  const lines = render(extract([a]))
  assert.ok(lines.length > 0 && lines.every(line => line.count === 2))
  assert.ok(lines.every(line => line.sourceIds.length === 1))
})

test('partial overlap splits frequency and linked sources at the actual boundary', () => {
  const a = fixture('a', [part([[0, 0], [1000, 0]])])
  const b = fixture('b', [part([[500, 0], [1000, 0]])])
  const data = extract([a, b]), lines = render(data)
  assert.deepEqual([...new Set(lines.map(line => line.count))].sort(), [1, 2])
  for (const line of lines) {
    const midpoint = (line.positions[0][1] + line.positions.at(-1)[1]) / 2
    assert.equal(line.count, midpoint < point(500)[1] ? 1 : 2)
    assert.equal(line.sourceIds.length, line.count)
  }
})

test('separated opposite carriageway shares count and sources only where covered', () => {
  const a = fixture('a', [part([[0, 0], [1000, 0]])])
  const b = fixture('b', [part([[800, 35], [200, 35]])])
  const data = extract([a, b]), overview = aggregateOverviewTracks(data.tracks, false)
  const details = createOverviewPassageIndex(overview)
  const lines = buildRoadFootprintLines(overview)
  assert.ok(lines.some(line => line.count === 2))
  assert.ok(lines.some(line => line.count === 1))
  for (const line of lines) {
    assert.equal(line.sourceIds.length, line.count)
    assert.equal(footprintColor(line.count), line.count === 1 ? '#2563eb' : '#0891b2')
  }
  const first = overview.find(line => line.sourceIds.includes(data.records[0].sourceId))
  assert.equal(details(first, point(500)).count, 2)
})

test('invalid coordinates do not create connections and duplicate local IDs retain distinct trip sources', () => {
  const a = fixture('a', [part([[0, 0], [100, 0]])]), b = structuredClone(a)
  b.trip.id = 'other-trip'
  const data = extract([a, b])
  assert.equal(new Set(data.tracks.map(track => track.segmentId)).size, 2)
  assert.ok(render(data).every(line => line.count === 2))
  a.cache.roadParts[0].polyline = [point(0), point(100), [NaN, NaN], point(500), point(600)]
  assert.equal(render(extract([a])).length, 2)
})

test('selected provincial footprint includes pending-province and differently labelled overlapping passages', () => {
  const selected = withOriginalGeometry(fixture('a', [part([[0, 0], [1000, 0]], {
    roadClass: 'PROVINCIAL_ROAD', routeRef: 'S201', provinceCode: '610000', source: 'MANUAL',
  })]))
  const pending = withOriginalGeometry(fixture('b', [part([[0, 0], [1000, 0]], {
    roadClass: 'PROVINCIAL_ROAD', routeRef: 'S201',
  })]))
  const automatic = withOriginalGeometry(fixture('c', [part([[0, 0], [1000, 0]], {
    roadClass: 'NATIONAL_ROAD', routeRef: 'G309',
  })]))
  const before = structuredClone([selected, pending, automatic])
  const data = extract([selected, pending, automatic], 'PROVINCIAL_ROAD:610000:S201')
  assert.equal(data.records.length, 1)
  const lines = renderWithPassages(data)
  assert.ok(lines.length > 0 && lines.every(line => line.count === 3))
  assert.ok(lines.every(line => line.sourceIds.length === 3 && footprintColor(line.count) === '#0891b2'))
  assert.deepEqual(new Set(lines.flatMap(line => line.sourceIds)), new Set(data.passageRecords.map(r => r.sourceId)))
  assert.deepEqual([selected, pending, automatic], before)
})

test('full-route counts split at overlap endpoints without drawing other roads or counting stale and planned records', () => {
  const selected = withOriginalGeometry(fixture('a', [part([[0, 0], [1000, 0]], {
    roadClass: 'PROVINCIAL_ROAD', routeRef: 'S201', provinceCode: '610000', source: 'MANUAL',
  }), part([[1000, 0], [1500, 0]], { routeRef: 'G5' })]))
  const pending = withOriginalGeometry(fixture('b', [part([[500, 0], [1000, 0]], {
    roadClass: 'PROVINCIAL_ROAD', routeRef: 'S201',
  })], '2025-09-01'))
  const elsewhere = withOriginalGeometry(fixture('elsewhere', [part([[0, 1000], [1000, 1000]], {
    roadClass: 'PROVINCIAL_ROAD', routeRef: 'S201', provinceCode: '620000',
  })]))
  const stale = withOriginalGeometry(fixture('stale', pending.cache.roadParts)); stale.cache.roadAnalysis.classifierVersion = 'old'
  const plan = withOriginalGeometry(fixture('plan', [part([[0, 0], [1000, 0]])], '2026-09-01', 'plan'))
  const data = extract([selected, pending, elsewhere, stale, plan], 'PROVINCIAL_ROAD:610000:S201')
  const lines = renderWithPassages(data)
  assert.deepEqual([...new Set(lines.map(line => line.count))].sort(), [1, 2])
  for (const line of lines) {
    const midpoint = (line.positions[0][1] + line.positions.at(-1)[1]) / 2
    assert.equal(line.count, midpoint < point(500)[1] ? 1 : 2)
    assert.ok(line.positions.every(p => p[1] <= point(1000)[1] + 1e-9 && Math.abs(p[0] - 34) < 1e-9))
    assert.equal(line.sourceIds.length, line.count)
  }
  assert.ok(renderWithPassages(extract([selected, pending], 'PROVINCIAL_ROAD:610000:S201', '2026')).every(line => line.count === 1))
})

test('footprint passage geometry follows current recorded points in preference to cache geometry', () => {
  const a = withOriginalGeometry(fixture('a', [part([[0, 0], [1000, 0]])]))
  const s = a.trip.days[0].routeSegments[0]
  s.routeBuildKey = a.cache.routeBuildKey
  s.points = [point(0), point(500)].map(([lat, lon]) => ({ lat, lon }))
  const data = extract([a])
  assert.deepEqual(data.passageTracks[0].line, s.points)
})

test('full-route footprint retains two passages from one outbound and return record', () => {
  const a = withOriginalGeometry(fixture('a', [part([[0, 0], [1000, 0]]), part([[1000, 0], [0, 0]])]))
  const lines = renderWithPassages(extract([a]))
  assert.ok(lines.length > 0 && lines.every(line => line.count === 2 && line.sourceIds.length === 1))
})

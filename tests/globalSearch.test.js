import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGlobalSearchIndex, searchGlobalRecords } from '../src/utils/globalSearch.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'

const segment = { id: 's1', name: '翻越垭口', startPoint: '成都', endPoint: '康定', preference: 'HIGHWAY_FIRST',
  note: '雨后慢行', waypoints: [{ id: 'w1', name: '折多山', lat: 30, lng: 102 }], photoIds: ['p1', 'wrong'] }
const trip = { id: 't1', title: '川西秋游', category: 'review', startDate: '2026-10-01', endDate: '2026-10-02', travelogue: '看见雪山',
  days: [{ id: 'd1', date: '2026-10-01', routeSegments: [segment] }] }
const cache = { segmentId: segment.id, routeBuildKey: buildSegmentRouteKey(segment),
  roadAnalysis: { classifierVersion: ROAD_CLASSIFIER_VERSION, routeBuildKey: buildSegmentRouteKey(segment) },
  roadParts: [{ routeRef: 'G318', roadName: '沪聂线', manualDirection: '康定方向' }] }
const photos = [{ id: 'p1', segmentId: 's1', originalFilename: 'IMG_001.jpg', note: '雪山日出' },
  { id: 'wrong', segmentId: 'other', originalFilename: 'private.jpg', note: '不该出现' },
  { id: 'orphan', segmentId: 's1', originalFilename: 'orphan.jpg', note: '未关联' }]
const index = buildGlobalSearchIndex([trip], [cache], photos)
test('global search covers titles, places, waypoints, notes, dates and travelogues with exact targets and reasons', () => {
  for (const query of ['川西秋游', '成都', '雨后慢行', '2026-10-01', '看见雪山']) assert.ok(searchGlobalRecords(index, query).length)
  const result = searchGlobalRecords(index, '折多山')[0]
  assert.equal(result.reasons[0].label, '途经点')
  assert.deepEqual(result.target, { tripId: 't1', dayId: 'd1', segmentId: 's1', waypointId: 'w1' })
  assert.equal(searchGlobalRecords(index, '雪山日出')[0].target.photoId, 'p1')
})
test('road search normalizes case, fullwidth and hyphens and ignores stale route and classifier caches', () => {
  for (const query of ['g318', 'Ｇ３１８', 'G-318', '沪聂', '康定方向']) assert.equal(searchGlobalRecords(index, query)[0].kind, 'segment')
  for (const badCache of [{ ...cache, routeBuildKey: 'old' }, { ...cache, roadAnalysis: { ...cache.roadAnalysis, classifierVersion: 'old' } }]) {
    assert.equal(searchGlobalRecords(buildGlobalSearchIndex([trip], [badCache], []), 'G318').length, 0)
  }
})
test('all keywords must match, empty input has no results, unrelated and orphan photos stay out', () => {
  assert.equal(searchGlobalRecords(index, '川西 成都 雨后').length, 1)
  for (const query of ['', '  ', '成都 不存在', '不该出现', '未关联']) assert.equal(searchGlobalRecords(index, query).length, 0)
})
test('search includes plans, legacy via points, and does not mutate source objects', () => {
  const source = structuredClone({ ...trip, category: 'plan', days: [{ id: 'd2', date: '', routeSegments: [{ ...segment, waypoints: [], viaPointsText: '理塘,巴塘' }] }] })
  const before = JSON.stringify(source)
  const result = searchGlobalRecords(buildGlobalSearchIndex([source], [], []), '巴塘')[0]
  assert.equal(result.category, 'plan')
  assert.equal(result.target.dayId, 'd2')
  assert.equal(JSON.stringify(source), before)
})
test('long note match reasons show the matching passage', () => {
  const longTrip = { ...trip, travelogue: '前文'.repeat(250) + '罕见云海' + '后文'.repeat(250) }
  const result = searchGlobalRecords(buildGlobalSearchIndex([longTrip], [], []), '罕见云海')[0]
  assert.match(result.reasons[0].value, /罕见云海/)
  assert.ok(result.reasons[0].value.length < 200)
})

test('search finds every valid concurrent identity once and preserves the source cache', () => {
  const concurrentCache = { ...cache, roadParts: [{ ...cache.roadParts[0], roadClass: 'NATIONAL_ROAD', routeRef: 'G316', concurrentRoads: [
    { roadClass: 'NATIONAL_ROAD', routeRef: 'G210' },
    { roadClass: 'NATIONAL_ROAD', routeRef: 'G211' },
    { roadClass: 'EXPRESSWAY', routeRef: 'G70' },
    { roadClass: 'PROVINCIAL_ROAD', routeRef: 'S101', provinceCode: '610000' },
    { roadClass: 'NATIONAL_ROAD', routeRef: 'G210' },
    { roadClass: 'NATIONAL_ROAD', routeRef: 'G316' },
    { roadClass: 'PROVINCIAL_ROAD', routeRef: 'S102' },
    { roadClass: 'NATIONAL_ROAD', routeRef: 'bad' },
  ] }] }
  const before = structuredClone(concurrentCache)
  const searchIndex = buildGlobalSearchIndex([trip], [concurrentCache], [])
  for (const query of ['G316', 'G210', 'g-211', 'Ｇ７０', 'S101']) {
    const results = searchGlobalRecords(searchIndex, query)
    assert.equal(results.length, 1, query)
    assert.equal(results[0].target.segmentId, segment.id)
    assert.equal(results[0].reasons.filter(reason => reason.label === '道路编号').length, 1)
  }
  for (const query of ['S102', 'bad']) assert.equal(searchGlobalRecords(searchIndex, query).length, 0)
  assert.deepEqual(concurrentCache, before)
})

test('concurrent identities in stale geometry or classifier caches stay out of search', () => {
  const concurrentCache = { ...cache, roadParts: [{ roadClass: 'NATIONAL_ROAD', routeRef: 'G316',
    concurrentRoads: [{ roadClass: 'NATIONAL_ROAD', routeRef: 'G210' }] }] }
  for (const stale of [
    { ...concurrentCache, routeBuildKey: 'old' },
    { ...concurrentCache, roadAnalysis: { ...cache.roadAnalysis, classifierVersion: 'old' } },
  ]) assert.equal(searchGlobalRecords(buildGlobalSearchIndex([trip], [stale], []), 'G210').length, 0)
})

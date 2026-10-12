import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTripCompletenessItems } from '../src/utils/tripCompleteness.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { roadEvidenceText } from '../src/utils/roadEvidence.ts'

const segment = { id: 's', name: '测试路段', startPoint: '甲', endPoint: '乙', preference: 'HIGHWAY_FIRST' }
const fixture = (s = segment, extra = {}) => ({ id: 't', title: '测试旅程', category: 'review', startDate: '2026-10-01',
  endDate: '2026-10-01', days: [{ id: 'd', date: '2026-10-01', routeSegments: [s] }], ...extra })
const cacheFor = (s, status = 'complete') => ({ segmentId: s.id, routeBuildKey: buildSegmentRouteKey(s),
  roadParts: [{ roadClass: 'NATIONAL_ROAD', routeRef: 'G210' }],
  roadAnalysis: { routeBuildKey: buildSegmentRouteKey(s), classifierVersion: ROAD_CLASSIFIER_VERSION, status } })

test('completeness items identify exact records and keep missing actuals and scores optional without mutation', () => {
  const trip = fixture(), before = structuredClone(trip)
  const items = buildTripCompletenessItems([trip, fixture(segment, { id: 'plan', category: 'plan' })], [], true)
  assert.equal(items.length, 1)
  assert.equal(items[0].tripId, 't'); assert.equal(items[0].dayId, 'd'); assert.equal(items[0].segmentId, 's')
  assert.equal(items[0].date, '2026-10-01')
  assert.deepEqual(items[0].required, ['规划里程待计算', '预计驾驶时间待计算或已过期'])
  assert.equal(items[0].analysis, '道路待分析')
  assert.deepEqual(items[0].optional, ['实际里程未记录', '实际驾驶时间未记录', '风景未评分', '难度未评分'])
  assert.deepEqual(trip, before)
})

test('valid zero metrics are preserved and complete records produce no pending items', () => {
  const s = { ...segment, distanceMeters: 0, estimatedDurationSeconds: 0, scenicScore: 1, difficultyScore: 10,
    reviewFacts: { actual: { distanceMeters: 0, durationSeconds: 0 } } }
  s.routeBuildKey = buildSegmentRouteKey(s)
  assert.deepEqual(buildTripCompletenessItems([fixture(s)], [cacheFor(s)], true), [])
  const staleDuration = { ...s, routeBuildKey: 'old' }
  assert.deepEqual(buildTripCompletenessItems([fixture(staleDuration)], [cacheFor(s)], true)[0].required, ['预计驾驶时间待计算或已过期'])
})

test('analysis entries distinguish missing, stale and partial while unavailable caches do not imply missing analysis', () => {
  const trip = fixture()
  assert.equal(buildTripCompletenessItems([trip], [cacheFor(segment, 'partial')], true)[0].analysis, '道路分析部分完整')
  const stale = { ...cacheFor(segment), routeBuildKey: 'old' }
  assert.equal(buildTripCompletenessItems([trip], [stale], true)[0].analysis, '道路分析已过期')
  assert.equal(buildTripCompletenessItems([trip], [], false)[0].analysis, null)
})

test('invalid dates get targeted entries and cycling does not require driving time', () => {
  const s = { ...segment, routeType: 'CYCLING' }
  const trip = fixture(s, { startDate: '2026-02-30' })
  trip.days[0].date = 'invalid'
  const items = buildTripCompletenessItems([trip], [], true)
  assert.equal(items[0].segmentId, '')
  assert.equal(items[0].required[0], '旅程起止日期待核对')
  assert.deepEqual(items[1].required, ['当天日期待核对', '规划里程待计算'])
  assert.ok(!items[1].optional.includes('实际驾驶时间未记录'))
})

test('road evidence labels show stored provenance and never invent a missing distance source', () => {
  assert.match(roadEvidenceText({ source: 'ROAD_CODE', confidence: 'HIGH', distanceSource: 'NAVIGATION' }), /道路编号.*高.*导航里程/)
  assert.match(roadEvidenceText({ source: 'MANUAL', confidence: 'LOW', distanceSource: 'GEOMETRY_ESTIMATE' }), /人工修正.*低.*几何估算/)
  assert.match(roadEvidenceText({ source: 'FALLBACK', confidence: 'MEDIUM' }), /兜底分类.*中.*里程来源：未记录/)
})

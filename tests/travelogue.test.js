import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTripTravelogue, createTravelogueFilename } from '../src/utils/travelogue.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { toPersistedTripReview } from '../src/services/tripStorage.ts'

function createSegment(id, overrides = {}) {
  const segment = {
    id,
    name: `路段-${id}`,
    startPoint: '成都',
    endPoint: '雅安',
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    distanceMeters: 143200,
    estimatedDurationSeconds: 7800,
    estimatedTollYuan: 57,
    waypoints: [{ id: `w-${id}-1`, name: '都江堰' }, { id: `w-${id}-2`, name: '映秀' }],
    scenicScore: 8.5,
    difficultyScore: 3,
    note: '雅西高速车少，风景很好。',
    photoIds: ['p1', 'p2'],
    reviewFacts: { tags: ['SUNNY', 'SMOOTH', 'RELAXED'] },
    ...overrides,
  }
  segment.routeBuildKey = buildSegmentRouteKey(segment)
  return segment
}

function createTrip(overrides = {}) {
  const segment1 = createSegment('s1')
  const segment2 = createSegment('s2', {
    name: '雅安到泸定',
    startPoint: '雅安',
    endPoint: '泸定',
    routeType: 'CYCLING',
    distanceMeters: undefined,
    estimatedDurationSeconds: undefined,
    estimatedTollYuan: undefined,
    scenicScore: null,
    difficultyScore: null,
    note: '',
    photoIds: [],
    reviewFacts: undefined,
  })
  return {
    id: 't1',
    title: '川西环线',
    category: 'review',
    startDate: '2026-05-01',
    endDate: '2026-05-03',
    days: [
      { id: 'd1', date: '2026-05-01', routeSegments: [segment1] },
      { id: 'd2', date: '2026-05-02', routeSegments: [segment2] },
    ],
    ...overrides,
  }
}

test('buildTripTravelogue assembles title, days, route narrative and stats', () => {
  const markdown = buildTripTravelogue(createTrip())
  assert.ok(markdown.includes('# 川西环线'))
  assert.ok(markdown.includes('## 第 1 天 · 2026-05-01'))
  assert.ok(markdown.includes('## 第 2 天 · 2026-05-02'))
  assert.ok(markdown.includes('### 路段-s1'))
  assert.ok(markdown.includes('从成都出发，前往雅安，途经都江堰、映秀。'))
  assert.ok(markdown.includes('全程 143.2 公里'))
  assert.ok(markdown.includes('预计行驶 2小时10分钟'))
  assert.ok(markdown.includes('过路费约 ¥57'))
  assert.ok(markdown.includes('天气晴朗，路况顺畅，整体轻松。'))
  assert.ok(markdown.includes('风景评分 8.5 分（风景较好）'))
  assert.ok(markdown.includes('难度评分 3.0 分（难度较低）'))
  assert.ok(markdown.includes('雅西高速车少，风景很好。'))
  assert.ok(markdown.includes('沿途留影 2 张。'))
  assert.ok(markdown.includes('## 行程小结'))
})

test('cycling segments omit toll estimates', () => {
  const markdown = buildTripTravelogue(createTrip())
  const cyclingSection = markdown.split('## 第 2 天')[1].split('## 行程小结')[0]
  assert.ok(!cyclingSection.includes('过路费'))
  assert.ok(!cyclingSection.includes('预计行驶'))
})

test('missing optional fields never produce undefined/null/NaN text', () => {
  const trip = createTrip({
    days: [{ id: 'd1', date: '2026-05-01', routeSegments: [createSegment('bare', {
      name: '',
      startPoint: '',
      endPoint: '',
      waypoints: undefined,
      distanceMeters: undefined,
      estimatedDurationSeconds: undefined,
      estimatedTollYuan: undefined,
      scenicScore: undefined,
      difficultyScore: undefined,
      note: '',
      photoIds: [],
      reviewFacts: undefined,
    })] }],
  })
  const markdown = buildTripTravelogue(trip)
  assert.ok(!markdown.includes('undefined'))
  assert.ok(!markdown.includes('null'))
  assert.ok(!markdown.includes('NaN'))
})

test('user text with HTML is escaped for markdown rendering', () => {
  const trip = createTrip({
    title: '<script>alert(1)</script>',
    days: [{
      id: 'd1',
      date: '2026-05-01',
      routeSegments: [createSegment('x', { note: '<img src=x onerror=alert(1)>' })],
    }],
  })
  const markdown = buildTripTravelogue(trip)
  assert.ok(!markdown.includes('<script>'))
  assert.ok(markdown.includes('&lt;script&gt;'))
  assert.ok(!markdown.includes('<img'))
  assert.ok(markdown.includes('&lt;img'))
})

test('trip without segments returns a gentle placeholder', () => {
  const markdown = buildTripTravelogue(createTrip({ days: [] }))
  assert.ok(markdown.includes('# 川西环线'))
  assert.ok(markdown.includes('还没有记录路段'))
  assert.ok(!markdown.includes('undefined'))
})

test('generation is deterministic', () => {
  const trip = createTrip()
  assert.equal(buildTripTravelogue(trip), buildTripTravelogue(trip))
})

test('travelogue field survives trip persistence round-trip', () => {
  const travelogue = '# 测试游记'
  const persisted = toPersistedTripReview({ trips: [{ ...createTrip(), travelogue }] })
  assert.equal(persisted.trips[0].travelogue, travelogue)
  assert.equal(toPersistedTripReview({ trips: [{ ...createTrip(), travelogue: '   ' }] }).trips[0].travelogue, undefined)
})

test('createTravelogueFilename sanitizes illegal characters', () => {
  assert.equal(createTravelogueFilename('川西/环线'), '川西-环线-游记.md')
  assert.equal(createTravelogueFilename('   '), '未命名旅程-游记.md')
})

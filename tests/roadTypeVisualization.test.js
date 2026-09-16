import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { parseDrivingPath } from '../src/services/amap/routeApi.ts'
import {
  DEFAULT_ROAD_TYPE_VISIBILITY,
  getRenderableRoadParts,
  getRoadTypeMapCategory,
  ROAD_TYPE_MAP_COLORS,
  roadTypeColorForClass,
  summarizeCurrentRoadTypeDistances,
  summarizeHistoricalRoadTypeDistances,
} from '../src/components/map/roadTypeVisualization.ts'

function createSegment(id, overrides = {}) {
  const segment = {
    id,
    name: id,
    startPoint: `${id}-start`,
    endPoint: `${id}-end`,
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    ...overrides,
  }
  return { ...segment, routeBuildKey: buildSegmentRouteKey(segment) }
}

function createRoadPart(roadClass, distanceMeters, polyline = [[30, 104], [30.01, 104.01]]) {
  return {
    roadClass,
    distanceMeters,
    confidence: 'HIGH',
    source: 'ROAD_NAME',
    polyline,
  }
}

function createCache(segment, roadParts, overrides = {}) {
  const coverageMeters = roadParts.reduce((sum, part) => sum + part.distanceMeters, 0)
  return {
    segmentId: segment.id,
    routeBuildKey: segment.routeBuildKey,
    points: [{ lat: 30, lon: 104 }, { lat: 30.01, lon: 104.01 }],
    updatedAt: 1,
    distanceMeters: segment.distanceMeters,
    roadParts,
    roadAnalysis: {
      schemaVersion: 1,
      classifierVersion: ROAD_CLASSIFIER_VERSION,
      analyzedAt: '2026-09-02T00:00:00.000Z',
      routeBuildKey: segment.routeBuildKey,
      coverageMeters,
      routeDistanceMeters: segment.distanceMeters,
      coverageRatio: coverageMeters / segment.distanceMeters,
      distanceErrorMeters: Math.abs(segment.distanceMeters - coverageMeters),
      distanceToleranceMeters: 100,
      status: 'partial',
    },
    ...overrides,
  }
}

test('a zero-distance single-point AMap step does not disable coloring of valid roads or manual corrections', () => {
  const route = parseDrivingPath({
    distance: '21840',
    steps: [
      { distance: '0', polyline: '110.098646,34.581727;110.098646,34.581727' },
      { road: '沿黄观光路', distance: '21840', polyline: '110.098646,34.581727;110.365405,35.242503' },
    ],
  })
  assert.equal(route.roadParts[0].polyline.length, 1)
  const options = { isOverviewMode: false, maximumPoints: 220 }
  const rendered = getRenderableRoadParts(route.roadParts, options)
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].sourceIndex, 1)
  assert.equal(roadTypeColorForClass(rendered[0].roadClass), ROAD_TYPE_MAP_COLORS.OTHER)
  for (const roadClass of ['PROVINCIAL_ROAD', 'NATIONAL_ROAD']) {
    const corrected = route.roadParts.map((part, index) => index === 1
      ? { ...part, roadClass, source: 'MANUAL' }
      : part)
    const result = getRenderableRoadParts(corrected, options)
    assert.equal(result.length, 1)
    assert.equal(roadTypeColorForClass(result[0].roadClass), ROAD_TYPE_MAP_COLORS[roadClass])
    assert.deepEqual(result[0].positions, route.roadParts[1].polyline)
  }
})

test('invalid geometries are isolated without joining across gaps, in detail and overview', () => {
  const parts = [
    createRoadPart('UNKNOWN', 0, []),
    createRoadPart('NATIONAL_ROAD', 100, [[30, 104], [31, 105]]),
    createRoadPart('UNKNOWN', 100, [[31, 105], [NaN, 106]]),
    createRoadPart('PROVINCIAL_ROAD', 100, [[33, 107], [34, 108]]),
    { ...createRoadPart('UNKNOWN', 100), polyline: undefined },
  ]
  for (const isOverviewMode of [false, true]) {
    const options = { isOverviewMode, maximumPoints: 220 }
    const rendered = getRenderableRoadParts(parts, options)
    assert.deepEqual(rendered.map((part) => part.sourceIndex), [1, 3])
    assert.deepEqual(rendered.map((part) => part.positions), [parts[1].polyline, parts[3].polyline])
    assert.deepEqual(getRenderableRoadParts([parts[0], parts[2], parts[4]], options), [])
  }
})

test('MapCanvas road-type helper keeps category colors and routes unknown parts to verification', () => {
  assert.deepEqual(DEFAULT_ROAD_TYPE_VISIBILITY, {
    EXPRESSWAY: true,
    NATIONAL_ROAD: true,
    PROVINCIAL_ROAD: true,
    OTHER: true,
  })
  assert.equal(getRoadTypeMapCategory('COUNTY_ROAD'), 'OTHER')
  assert.equal(getRoadTypeMapCategory('UNKNOWN'), null)
  assert.equal(roadTypeColorForClass('NATIONAL_ROAD'), ROAD_TYPE_MAP_COLORS.NATIONAL_ROAD)

  const s1 = createSegment('current-1', { distanceMeters: 1_000 })
  const s2 = createSegment('current-2', { distanceMeters: 500 })
  const totals = summarizeCurrentRoadTypeDistances([
    {
      segmentId: s1.id,
      segmentName: s1.name,
      points: [],
      line: [{ lat: 30, lon: 104 }, { lat: 30.1, lon: 104.1 }],
      distanceMeters: 1_000,
      roadParts: [
        createRoadPart('EXPRESSWAY', 400),
        createRoadPart('NATIONAL_ROAD', 300),
        createRoadPart('UNKNOWN', 100),
      ],
      roadAnalysis: { routeDistanceMeters: 1_000 },
    },
    {
      segmentId: s2.id,
      segmentName: s2.name,
      points: [],
      line: [{ lat: 31, lon: 105 }, { lat: 31.1, lon: 105.1 }],
      distanceMeters: 500,
    },
  ], [s1, s2])

  assert.deepEqual(totals, {
    distances: {
      EXPRESSWAY: 400,
      NATIONAL_ROAD: 300,
      PROVINCIAL_ROAD: 0,
      OTHER: 0,
    },
    // 100 m UNKNOWN + 200 m analysis gap + 500 m without roadParts
    unverifiedMeters: 800,
  })
})

test('historical road-type totals include review history only and mark stale routes unverified', () => {
  const current = createSegment('review-current', { distanceMeters: 1_000 })
  const stale = createSegment('review-stale', { distanceMeters: 600 })
  const planned = createSegment('planned', { distanceMeters: 900 })
  const trips = [
    {
      id: 'review',
      title: 'review',
      category: 'review',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      days: [{ id: 'review-day', date: '2026-01-01', routeSegments: [current, stale] }],
    },
    {
      id: 'plan',
      title: 'plan',
      category: 'plan',
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      days: [{ id: 'plan-day', date: '2026-01-02', routeSegments: [planned] }],
    },
  ]
  const totals = summarizeHistoricalRoadTypeDistances(trips, [
    createCache(current, [
      createRoadPart('PROVINCIAL_ROAD', 700),
      createRoadPart('OTHER', 200),
    ]),
    createCache(stale, [createRoadPart('EXPRESSWAY', 600)], {
      routeBuildKey: 'old-route-input',
      roadAnalysis: {
        schemaVersion: 1,
        classifierVersion: 'rules-v1',
        analyzedAt: '2026-09-02T00:00:00.000Z',
        routeBuildKey: 'old-route-input',
        coverageMeters: 600,
        routeDistanceMeters: 600,
        coverageRatio: 1,
        distanceErrorMeters: 0,
        distanceToleranceMeters: 100,
        status: 'complete',
      },
    }),
    createCache(planned, [createRoadPart('NATIONAL_ROAD', 900)]),
  ])

  assert.deepEqual(totals, {
    distances: {
      EXPRESSWAY: 0,
      NATIONAL_ROAD: 0,
      PROVINCIAL_ROAD: 700,
      OTHER: 200,
    },
    // current analysis gap 100 m + stale review route 600 m; plan does not enter historical total
    unverifiedMeters: 700,
  })
})

test('overview rendering preserves road-part order while bounding polyline and point counts', () => {
  const roadParts = Array.from({ length: 120 }, (_value, index) => createRoadPart(
    index % 2 === 0 ? 'EXPRESSWAY' : 'NATIONAL_ROAD',
    100,
    Array.from({ length: 12 }, (_point, pointIndex) => [30 + index / 1000, 104 + pointIndex / 10000]),
  ))
  const detailed = getRenderableRoadParts(roadParts, { isOverviewMode: false, maximumPoints: 220 })
  const overview = getRenderableRoadParts(roadParts, {
    isOverviewMode: true,
    maximumPoints: 220,
    maximumPartCount: 80,
  })

  assert.equal(detailed.length, 120)
  assert.equal(overview.length, 80)
  assert.equal(overview[0].sourceIndex, 0)
  assert.equal(overview.at(-1)?.sourceIndex, 119)
  assert.deepEqual([...overview.map((part) => part.sourceIndex)].sort((left, right) => left - right), overview.map((part) => part.sourceIndex))
  assert.ok(overview.reduce((sum, part) => sum + part.positions.length, 0) <= 220)
})

import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'

import { parseCyclingPath, parseDrivingPath } from '../src/services/amap/routeApi.ts'
import { buildDrivingRouteResult } from '../src/services/amap/routePlanner.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { classifyRoad } from '../src/utils/roadClassifier.ts'
import { summarizeReviewTripStatistics } from '../src/utils/tripStatistics.ts'
import { buildResolvedRoutePatch } from '../src/components/map/resolvedRoutePatch.ts'
import { persistResolvedRoutePatches } from '../src/hooks/resolvedRoutePatches.ts'
import { getSegmentRouteCache } from '../src/services/routeCacheDb.ts'
import { getRoadAnalysisFreshness } from '../src/utils/routeBuildKey.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function segment(id, overrides = {}) {
  const value = {
    id,
    name: id,
    startPoint: '起点',
    endPoint: '终点',
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    distanceMeters: 100,
    ...overrides,
  }
  return { ...value, routeBuildKey: buildSegmentRouteKey(value) }
}

function trip(id, segments) {
  return {
    id,
    title: id,
    category: 'review',
    startDate: '2026-01-01',
    endDate: '2026-01-01',
    days: [{ id: `${id}-day`, date: '2026-01-01', routeSegments: segments }],
  }
}

function cacheFor(routeSegment, roadParts) {
  const coverageMeters = roadParts.reduce((sum, part) => sum + part.distanceMeters, 0)
  return {
    segmentId: routeSegment.id,
    routeBuildKey: routeSegment.routeBuildKey,
    points: [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }],
    updatedAt: 1,
    distanceMeters: coverageMeters,
    roadParts,
    roadAnalysis: {
      schemaVersion: 1,
      classifierVersion: ROAD_CLASSIFIER_VERSION,
      analyzedAt: '2026-09-08T00:00:00.000Z',
      routeBuildKey: routeSegment.routeBuildKey,
      coverageMeters,
      routeDistanceMeters: coverageMeters,
      coverageRatio: 1,
      distanceErrorMeters: 0,
      distanceToleranceMeters: 100,
      status: 'complete',
    },
  }
}

function part(roadClass, distanceMeters, routeRef, provinceCode, roadName = routeRef) {
  return {
    roadClass,
    distanceMeters,
    routeRef,
    roadName,
    confidence: 'HIGH',
    source: 'ROAD_NAME',
    ...(provinceCode ? {
      provinceCode,
      provinceName: provinceCode === '610000' ? '陕西' : '甘肃',
      provinceSource: 'NAVIGATION',
      provinceStatus: 'confirmed',
    } : roadClass === 'PROVINCIAL_ROAD' ? {
      provinceSource: 'UNKNOWN',
      provinceStatus: 'pending',
    } : {}),
  }
}

test('AMap navigation province evidence distinguishes same-number provincial roads and S expressways', () => {
  const result = parseDrivingPath({
    distance: '400',
    duration: '40',
    steps: [
      { road: 'S101 省道', distance: '100', adcode: '610116', cities: [{ name: '西安', adcode: '610100' }], polyline: '108,34;108.01,34.01' },
      { road: 'S101 省道', distance: '100', adcode: '620100', districts: [{ name: '兰州', adcode: '620102' }], polyline: '108.01,34.01;108.02,34.02' },
      { road: 'S12 某高速', distance: '100', adcode: '610100', polyline: '108.02,34.02;108.03,34.03' },
      { road: 'G210 国道', distance: '100', adcode: '620100', polyline: '108.03,34.03;108.04,34.04' },
    ],
  })

  assert.deepEqual(result.roadParts.map((item) => [item.roadClass, item.routeRef, item.provinceCode, item.provinceStatus]), [
    ['PROVINCIAL_ROAD', 'S101', '610000', 'confirmed'],
    ['PROVINCIAL_ROAD', 'S101', '620000', 'confirmed'],
    ['EXPRESSWAY', 'S12', '610000', 'confirmed'],
    ['NATIONAL_ROAD', 'G210', undefined, undefined],
  ])
  assert.equal(classifyRoad('S12 某高速').roadClass, 'EXPRESSWAY')
})

test('multiple navigation provinces remain pending instead of taking the first one', () => {
  const result = parseDrivingPath({
    distance: '100',
    steps: [{
      road: 'S101 省道',
      distance: '100',
      cities: [{ adcode: '610100', name: '陕西' }, { adcode: '620100', name: '甘肃' }],
      polyline: '108,34;108.01,34.01',
    }],
  })
  assert.equal(result.roadParts[0].provinceCode, undefined)
  assert.equal(result.roadParts[0].provinceStatus, 'pending')
  assert.deepEqual(result.roadParts[0].provinceCandidates, ['610000', '620000'])
})

test('provincial and cycling road evidence enters statistics while unknown province stays separate', () => {
  const shaanxi = segment('shanxi-s101')
  const gansu = segment('gansu-s101')
  const unknown = segment('unknown-s101')
  const cycling = segment('cycling-s101', { routeType: 'CYCLING' })
  const national = segment('g210')
  const caches = [
    cacheFor(shaanxi, [part('PROVINCIAL_ROAD', 100, 'S101', '610000')]),
    cacheFor(gansu, [part('PROVINCIAL_ROAD', 200, 'S101', '620000')]),
    cacheFor(unknown, [part('PROVINCIAL_ROAD', 50, 'S101')]),
    cacheFor(cycling, [part('PROVINCIAL_ROAD', 30, 'S101', '610000')]),
    cacheFor(national, [part('NATIONAL_ROAD', 400, 'G210', undefined)]),
  ]
  const summary = summarizeReviewTripStatistics({ trips: [trip('all', [shaanxi, gansu, unknown, cycling, national])] }, caches)
  const provincial = summary.roadClassDistance.entries.find((entry) => entry.roadClass === 'PROVINCIAL_ROAD')
  assert.equal(provincial.distanceMeters, 380)
  assert.equal(summary.roadClassDistance.entries.find((entry) => entry.roadClass === 'NATIONAL_ROAD').distanceMeters, 400)
  assert.deepEqual(summary.numberedRoadDistance.entries
    .filter((entry) => entry.routeRef === 'S101')
    .map((entry) => [entry.provinceCode, entry.provinceStatus, entry.distanceMeters])
    .sort((left, right) => String(left[0] ?? 'ZZZ').localeCompare(String(right[0] ?? 'ZZZ'))), [
      ['610000', 'confirmed', 130],
      ['620000', 'confirmed', 200],
      [undefined, 'pending', 50],
    ])
  assert.equal(summary.estimatedDrivingTimeSeconds.completeness.notApplicableItemCount, 1)
})

test('cycling parser preserves road steps without borrowing instruction-only road names', () => {
  const result = parseCyclingPath({
    distance: 300,
    duration: 60,
    steps: [
      { road: 'S101 省道', distance: 200, instruction: '转入G65包茂高速', polyline: '108,34;108.01,34.01' },
      { road: '', distance: 100, instruction: '沿G210国道直行', polyline: '108.01,34.01;108.02,34.02' },
    ],
  })
  assert.deepEqual(result.roadParts.map((item) => [item.roadClass, item.routeRef]), [
    ['PROVINCIAL_ROAD', 'S101'],
    ['UNKNOWN', undefined],
  ])
  const route = buildDrivingRouteResult(result, 'cycling-test-key', '2026-09-08T00:00:00.000Z')
  assert.equal(route.roadAnalysis.status, 'complete')
  assert.equal(route.roadAnalysis.coverageMeters, 300)
})

test('cycling road analysis propagates through the cache and is current for cycling segments', async () => {
  const segment = segmentFactory('cycling-cache', { routeType: 'CYCLING', points: undefined, distanceMeters: undefined })
  const route = buildDrivingRouteResult(parseCyclingPath({
    distance: 300,
    duration: 60,
    steps: [{ road: 'S101 省道', distance: 300, adcode: '610100', polyline: '108,34;108.01,34.01' }],
  }), segment.routeBuildKey, '2026-09-08T00:00:00.000Z')
  const patch = buildResolvedRoutePatch({ segmentId: segment.id, routeBuildKey: segment.routeBuildKey, routeType: 'CYCLING', route })
  await persistResolvedRoutePatches([patch])
  const cached = await getSegmentRouteCache(segment.id)
  assert.equal(cached.roadParts[0].roadClass, 'PROVINCIAL_ROAD')
  assert.equal(getRoadAnalysisFreshness(segment, cached), 'current')
})

function segmentFactory(id, overrides = {}) {
  const value = segment(id, overrides)
  return value
}

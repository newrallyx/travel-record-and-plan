import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLegacySegmentRouteKey,
  buildSegmentRouteKey,
  canDisplaySegmentRouteCache,
  canReuseRecordedRoute,
  getRoadAnalysisFreshness,
  hasCurrentRoadAnalysis,
} from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'

function createSegment(overrides = {}) {
  return {
    id: 'segment-1',
    name: '西安到宝鸡',
    startPoint: '西安',
    endPoint: '宝鸡',
    startCoord: { lat: 34.3416, lon: 108.9398 },
    endCoord: { lat: 34.3619, lon: 107.2379 },
    waypoints: [{ id: 'via-1', name: '咸阳', lat: 34.3296, lng: 108.7088 }],
    routeType: 'DRIVING',
    preference: 'HIGHWAY_FIRST',
    ...overrides,
  }
}

function createRoadAnalysisCache(segment = createSegment(), overrides = {}) {
  const routeBuildKey = buildSegmentRouteKey(segment)
  return {
    routeBuildKey,
    roadParts: [{
      roadClass: 'EXPRESSWAY',
      roadName: 'G65 包茂高速',
      routeRef: 'G65',
      distanceMeters: 1200,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
    }],
    roadAnalysis: {
      schemaVersion: 1,
      classifierVersion: ROAD_CLASSIFIER_VERSION,
      analyzedAt: '2026-09-01T08:00:00.000Z',
      routeBuildKey,
      coverageMeters: 1200,
      routeDistanceMeters: 1200,
      coverageRatio: 1,
      distanceErrorMeters: 0,
      distanceToleranceMeters: 100,
      status: 'complete',
    },
    ...overrides,
  }
}

test('legacy route geometry remains displayable after the route build version changes', () => {
  const segment = createSegment()
  const legacyKey = buildLegacySegmentRouteKey(segment)
  const currentKey = buildSegmentRouteKey(segment)

  assert.notEqual(currentKey, legacyKey)
  assert.equal(canDisplaySegmentRouteCache(segment, legacyKey), true)
  assert.equal(canDisplaySegmentRouteCache(segment, currentKey), true)
  assert.equal(
    getRoadAnalysisFreshness(segment, createRoadAnalysisCache(segment, {
      routeBuildKey: legacyKey,
      roadAnalysis: {
        ...createRoadAnalysisCache(segment).roadAnalysis,
        routeBuildKey: legacyKey,
      },
    })),
    'stale',
  )
})

test('road analysis becomes stale after every route-defining input change', () => {
  const segment = createSegment()
  const cache = createRoadAnalysisCache(segment)

  assert.equal(hasCurrentRoadAnalysis(segment, cache), true)

  const changedSegments = [
    { ...segment, startPoint: '咸阳' },
    { ...segment, endPoint: '天水' },
    { ...segment, startCoord: { lat: 34.4, lon: 108.9398 } },
    { ...segment, endCoord: { lat: 34.4, lon: 107.2379 } },
    { ...segment, waypoints: [{ ...segment.waypoints[0], lat: 34.4 }] },
    { ...segment, preference: 'AVOID_TOLL' },
    { ...segment, routeType: 'CYCLING' },
  ]

  changedSegments.forEach((changedSegment) => {
    assert.equal(getRoadAnalysisFreshness(changedSegment, cache), 'stale')
    assert.equal(hasCurrentRoadAnalysis(changedSegment, cache), false)
  })
})

test('missing or mismatched road analysis is never current', () => {
  const segment = createSegment()
  const cache = createRoadAnalysisCache(segment)

  assert.equal(getRoadAnalysisFreshness(segment, { ...cache, roadAnalysis: undefined }), 'missing')
  assert.equal(getRoadAnalysisFreshness(segment, { ...cache, roadParts: undefined }), 'missing')
  assert.equal(getRoadAnalysisFreshness(segment, {
    ...cache,
    roadAnalysis: { ...cache.roadAnalysis, routeBuildKey: 'different-key' },
  }), 'stale')
  assert.equal(getRoadAnalysisFreshness(segment, {
    ...cache,
    roadAnalysis: { ...cache.roadAnalysis, classifierVersion: 'rules-v3' },
  }), 'stale')
})

test('legacy cache is rejected when a route-defining input changes', () => {
  const segment = createSegment()
  const legacyKey = buildLegacySegmentRouteKey(segment)

  assert.equal(canDisplaySegmentRouteCache({ ...segment, endPoint: '天水' }, legacyKey), false)
  assert.equal(canDisplaySegmentRouteCache({ ...segment, preference: 'AVOID_TOLL' }, legacyKey), false)
  assert.equal(
    canDisplaySegmentRouteCache(
      { ...segment, waypoints: [{ ...segment.waypoints[0], lat: 34.4 }] },
      legacyKey,
    ),
    false,
  )
})

test('recorded route is reusable with a matching current or legacy key', () => {
  const base = createSegment({ points: [{ lat: 34.34, lon: 108.93 }, { lat: 34.35, lon: 107.2 }] })

  assert.equal(canReuseRecordedRoute({ ...base, routeBuildKey: buildSegmentRouteKey(base) }), true)
  assert.equal(canReuseRecordedRoute({ ...base, routeBuildKey: buildLegacySegmentRouteKey(base) }), true)
})

test('recorded route stays reusable when duration/toll estimates are missing', () => {
  const base = createSegment({
    points: [{ lat: 34.34, lon: 108.93 }, { lat: 34.35, lon: 107.2 }],
    routeBuildKey: buildLegacySegmentRouteKey(createSegment()),
    estimatedDurationSeconds: undefined,
    estimatedTollYuan: undefined,
  })

  assert.equal(canReuseRecordedRoute(base), true)
})

test('recorded route is not reusable without geometry or a stored key', () => {
  const withKey = createSegment({ routeBuildKey: buildSegmentRouteKey(createSegment()) })

  assert.equal(canReuseRecordedRoute(withKey), false)
  assert.equal(
    canReuseRecordedRoute({ ...withKey, points: [{ lat: 34.34, lon: 108.93 }, { lat: 34.35, lon: 107.2 }] }),
    true,
  )
  assert.equal(
    canReuseRecordedRoute({ ...createSegment(), points: [{ lat: 34.34, lon: 108.93 }, { lat: 34.35, lon: 107.2 }] }),
    false,
  )
})

test('recorded route is not reusable after a route-defining input changes', () => {
  const segment = createSegment({
    points: [{ lat: 34.34, lon: 108.93 }, { lat: 34.35, lon: 107.2 }],
    routeBuildKey: buildLegacySegmentRouteKey(createSegment()),
  })

  assert.equal(canReuseRecordedRoute({ ...segment, endPoint: '天水' }), false)
})

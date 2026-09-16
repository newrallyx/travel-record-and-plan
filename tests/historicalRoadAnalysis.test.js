import assert from 'node:assert/strict'
import test from 'node:test'

import { IDBFactory } from 'fake-indexeddb'

import {
  collectHistoricalRoadAnalysisTargets,
  runHistoricalRoadAnalysisBatch,
} from '../src/services/historicalRoadAnalysis.ts'
import {
  getSegmentRouteCache,
  restoreAutomaticRoadPartCorrection,
  saveHistoricalRoadAnalysisOnly,
  saveManualRoadPartCorrection,
  savePlannedSegmentRouteCache,
} from '../src/services/routeCacheDb.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { compareRouteGeometry } from '../src/utils/routeGeometryComparison.ts'

function createSegment(id, overrides = {}) {
  return {
    id,
    name: `路段 ${id}`,
    startPoint: '起点',
    endPoint: '终点',
    startCoord: { lat: 34, lon: 108 },
    endCoord: { lat: 34.1, lon: 108.1 },
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    ...overrides,
  }
}

function createTrip(segments, overrides = {}) {
  return {
    id: 'trip-1',
    title: '历史旅程',
    category: 'review',
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    days: [{ id: 'day-1', date: '2026-01-01', routeSegments: segments }],
    ...overrides,
  }
}

function createRoute(segment, overrides = {}) {
  const routeKey = buildSegmentRouteKey(segment)
  return {
    polyline: [[34, 108], [34.1, 108.1]],
    distanceText: '15000 米',
    durationText: '1000 秒',
    distanceMeters: 15_000,
    durationSeconds: 1_000,
    durationUpdatedAt: '2026-09-03T01:00:00.000Z',
    routeKey,
    roadParts: [{
      roadClass: 'EXPRESSWAY',
      roadName: 'G65 包茂高速',
      routeRef: 'G65',
      distanceMeters: 15_000,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
      polyline: [[34, 108], [34.1, 108.1]],
    }],
    roadAnalysis: {
      schemaVersion: 1,
      classifierVersion: ROAD_CLASSIFIER_VERSION,
      analyzedAt: '2026-09-03T01:00:00.000Z',
      routeBuildKey: routeKey,
      coverageMeters: 15_000,
      routeDistanceMeters: 15_000,
      coverageRatio: 1,
      distanceErrorMeters: 0,
      distanceToleranceMeters: 150,
      status: 'complete',
    },
    ...overrides,
  }
}

function createDependencies(overrides = {}) {
  const controller = overrides.controller ?? new AbortController()
  return {
    signal: controller.signal,
    getRouteCache: async () => null,
    resolvePlace: async () => null,
    planDrivingRoute: async (_points, _preference, _options) => ({ route: null, error: { message: 'not mocked' } }),
    saveAnalysisOnly: async () => {},
    saveReplacement: async () => {},
    resolveConflict: async () => 'keep',
    retryDelayMs: 0,
    ...overrides,
    controller,
  }
}

test('scope selection returns current segment, current trip, or all review trips only', () => {
  const current = createSegment('current')
  const other = createSegment('other')
  const trips = [
    createTrip([current, other]),
    createTrip([createSegment('review-2')], { id: 'trip-2' }),
    createTrip([createSegment('plan')], { id: 'trip-plan', category: 'plan' }),
  ]
  assert.deepEqual(collectHistoricalRoadAnalysisTargets(trips, 'current-segment', 'trip-1', 'current').map((item) => item.segment.id), ['current'])
  assert.deepEqual(collectHistoricalRoadAnalysisTargets(trips, 'current-trip', 'trip-1').map((item) => item.segment.id), ['current', 'other'])
  assert.deepEqual(collectHistoricalRoadAnalysisTargets(trips, 'all-review').map((item) => item.segment.id), ['current', 'other', 'review-2'])
})

test('geometry comparison requires both mileage and bidirectional geometry similarity', () => {
  const saved = [{ lat: 34, lon: 108 }, { lat: 34.05, lon: 108.05 }, { lat: 34.1, lon: 108.1 }]
  assert.equal(compareRouteGeometry(saved, [[34.0005, 108.0005], [34.0505, 108.0505], [34.1005, 108.1005]], 15_000, 15_300).similar, true)
  const distanceMismatch = compareRouteGeometry(saved, [[34, 108], [34.05, 108.05], [34.1, 108.1]], 15_000, 18_000)
  assert.equal(distanceMismatch.geometrySimilar, true)
  assert.equal(distanceMismatch.similar, false)
  const geometryMismatch = compareRouteGeometry(saved, [[35, 109], [35.1, 109.1]], 15_000, 15_100)
  assert.equal(geometryMismatch.distanceSimilar, true)
  assert.equal(geometryMismatch.similar, false)
  assert.equal(compareRouteGeometry(saved, [[34, 108], [34.05, 108.05], [34.1, 108.1]]).similar, true)
})

test('batch limits work to two concurrent routes and retries one failure', async () => {
  const segments = Array.from({ length: 5 }, (_value, index) => createSegment(`s${index}`))
  const targets = collectHistoricalRoadAnalysisTargets([createTrip(segments)], 'all-review')
  let active = 0
  let maxActive = 0
  const attempts = new Map()
  const saved = []
  const dependencies = createDependencies({
    planDrivingRoute: async (points) => {
      const key = String(points[0].lat)
      const attempt = (attempts.get(key) ?? 0) + 1
      attempts.set(key, attempt)
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      if (key === '34' && attempt === 1) return { route: null, error: { message: 'temporary' } }
      const segment = segments[Math.round((points[0].lat - 34) * 10)]
      return { route: createRoute(segment), error: null }
    },
    saveReplacement: async (patch) => { saved.push(patch.segmentId) },
  })
  segments.forEach((segment, index) => {
    segment.startCoord.lat = Number(`34.${index}`)
  })

  const result = await runHistoricalRoadAnalysisBatch(targets, dependencies)
  assert.equal(maxActive, 2)
  assert.equal(result.success, 5)
  assert.equal(result.failed, 0)
  assert.equal(result.items[0].attempts, 2)
  assert.equal(saved.length, 5)
})

test('similar replan preserves saved geometry and only adds analysis', async () => {
  const savedPoints = [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }]
  const segment = createSegment('similar', { points: savedPoints, distanceMeters: 15_000 })
  let analysisParams = null
  let replacements = 0
  const result = await runHistoricalRoadAnalysisBatch(
    collectHistoricalRoadAnalysisTargets([createTrip([segment])], 'all-review'),
    createDependencies({
      getRouteCache: async () => ({
        segmentId: segment.id,
        routeBuildKey: 'legacy-key',
        points: savedPoints,
        updatedAt: 1,
        distanceMeters: 15_000,
      }),
      planDrivingRoute: async () => ({ route: createRoute(segment, {
        polyline: [[34.0005, 108.0005], [34.1005, 108.1005]],
        distanceMeters: 15_200,
      }), error: null }),
      saveAnalysisOnly: async (params) => { analysisParams = params },
      saveReplacement: async () => { replacements += 1 },
    }),
  )
  assert.equal(result.success, 1)
  assert.equal(result.items[0].outcome, 'analysis-only')
  assert.deepEqual(analysisParams.savedPoints, savedPoints)
  assert.equal(replacements, 0)
})

test('different replan keeps the original unless replacement is explicitly chosen', async () => {
  const keep = createSegment('keep', { points: [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }], distanceMeters: 15_000 })
  const replace = createSegment('replace', { points: [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }], distanceMeters: 15_000 })
  const replaced = []
  const decisions = ['keep', 'replace']
  const result = await runHistoricalRoadAnalysisBatch(
    collectHistoricalRoadAnalysisTargets([createTrip([keep, replace])], 'all-review'),
    createDependencies({
      getRouteCache: async (segmentId) => ({
        segmentId,
        routeBuildKey: 'legacy-key',
        points: [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }],
        updatedAt: 1,
        distanceMeters: 15_000,
      }),
      planDrivingRoute: async () => ({ route: createRoute(keep, {
        polyline: [[35, 109], [35.1, 109.1]],
        distanceMeters: 24_000,
      }), error: null }),
      resolveConflict: async () => decisions.shift(),
      saveReplacement: async (patch) => { replaced.push(patch.segmentId) },
    }),
  )
  assert.equal(result.skipped, 1)
  assert.equal(result.success, 1)
  assert.deepEqual(replaced, ['replace'])
})

test('cancellation prevents in-flight and queued results from being saved', async () => {
  const segments = Array.from({ length: 4 }, (_value, index) => createSegment(`cancel-${index}`))
  const releases = []
  let started = 0
  let saves = 0
  const dependencies = createDependencies({
    planDrivingRoute: async () => {
      started += 1
      await new Promise((resolve) => releases.push(resolve))
      return { route: createRoute(segments[0]), error: null }
    },
    saveReplacement: async () => { saves += 1 },
  })
  const running = runHistoricalRoadAnalysisBatch(
    collectHistoricalRoadAnalysisTargets([createTrip(segments)], 'all-review'),
    dependencies,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(started, 2)
  dependencies.controller.abort()
  releases.forEach((resolve) => resolve())
  const result = await running
  assert.equal(result.cancelled, 4)
  assert.equal(saves, 0)
})

test('analysis-only persistence and manual correction preserve old geometry and restore automatic classification', async () => {
  globalThis.indexedDB = new IDBFactory()
  const segment = createSegment('persisted')
  const oldPoints = [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }]
  await savePlannedSegmentRouteCache({
    segmentId: segment.id,
    routeBuildKey: 'legacy-key',
    points: oldPoints,
    distanceMeters: 15_000,
    estimatedDurationSeconds: 900,
  })
  const oldCache = await getSegmentRouteCache(segment.id)
  await saveHistoricalRoadAnalysisOnly({
    segment,
    cache: oldCache,
    routeBuildKey: buildSegmentRouteKey(segment),
    route: createRoute(segment),
    savedPoints: oldPoints,
  })
  let cache = await getSegmentRouteCache(segment.id)
  assert.deepEqual(cache.points, oldPoints)
  assert.equal(cache.distanceMeters, 15_000)
  assert.equal(cache.estimatedDurationSeconds, 900)

  await saveManualRoadPartCorrection(segment.id, 0, { roadClass: 'PROVINCIAL_ROAD', routeRef: 'S101' })
  cache = await getSegmentRouteCache(segment.id)
  assert.equal(cache.roadParts[0].source, 'MANUAL')
  assert.equal(cache.roadParts[0].roadClass, 'PROVINCIAL_ROAD')
  assert.equal(cache.roadParts[0].routeRef, 'S101')

  await restoreAutomaticRoadPartCorrection(segment.id, 0)
  cache = await getSegmentRouteCache(segment.id)
  assert.notEqual(cache.roadParts[0].source, 'MANUAL')
  assert.equal(cache.roadParts[0].roadClass, 'EXPRESSWAY')
  assert.equal(cache.roadParts[0].routeRef, 'G65')
  assert.deepEqual(cache.points, oldPoints)
})

test('historical automatic analysis preserves an existing manual road conclusion', async () => {
  globalThis.indexedDB = new IDBFactory()
  const segment = createSegment('manual-priority')
  const points = [{ lat: 34, lon: 108 }, { lat: 34.1, lon: 108.1 }]
  await savePlannedSegmentRouteCache({
    segmentId: segment.id,
    routeBuildKey: buildSegmentRouteKey(segment),
    points,
    distanceMeters: 15_000,
    roadParts: createRoute(segment).roadParts,
    roadAnalysis: createRoute(segment).roadAnalysis,
  })
  await saveManualRoadPartCorrection(segment.id, 0, {
    roadClass: 'PROVINCIAL_ROAD',
    routeRef: 'S101',
    provinceCode: '610000',
  })
  const cache = await getSegmentRouteCache(segment.id)
  await saveHistoricalRoadAnalysisOnly({
    segment,
    cache,
    routeBuildKey: buildSegmentRouteKey(segment),
    route: createRoute(segment, {
      roadParts: [{
        roadClass: 'NATIONAL_ROAD',
        routeRef: 'G210',
        distanceMeters: 15_000,
        confidence: 'HIGH',
        source: 'ROAD_NAME',
        roadName: 'G210 国道',
        polyline: [[34, 108], [34.1, 108.1]],
      }],
      roadAnalysis: {
        ...createRoute(segment).roadAnalysis,
        coverageMeters: 15_000,
        routeDistanceMeters: 15_000,
      },
    }),
    savedPoints: points,
  })
  const updated = await getSegmentRouteCache(segment.id)
  assert.equal(updated.roadParts[0].source, 'MANUAL')
  assert.equal(updated.roadParts[0].roadClass, 'PROVINCIAL_ROAD')
  assert.equal(updated.roadParts[0].routeRef, 'S101')
  assert.equal(updated.roadParts[0].provinceCode, '610000')
})

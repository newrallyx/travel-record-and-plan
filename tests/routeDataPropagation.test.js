import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

import { buildResolvedRoutePatch } from '../src/components/map/resolvedRoutePatch.ts'
import {
  applyResolvedRoutePatches,
  persistResolvedRoutePatches,
} from '../src/hooks/resolvedRoutePatches.ts'
import { parseDrivingPath } from '../src/services/amap/routeApi.ts'
import { buildDrivingRouteResult } from '../src/services/amap/routePlanner.ts'
import { getSegmentRouteCache } from '../src/services/routeCacheDb.ts'

const FIXTURE_URL = new URL('./fixtures/amap-driving-path.json', import.meta.url)
const ANALYZED_AT = '2026-09-01T08:00:00.000Z'
const SEGMENT_ID = 'end-to-end-segment'
const ROUTE_BUILD_KEY = 'segment-route-build-key'

function loadDrivingPathFixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, 'utf8'))
}

function createTripReview() {
  return {
    trips: [{
      id: 'trip-1',
      title: '数据传播测试',
      category: 'plan',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      days: [{
        id: 'day-1',
        date: '2026-09-01',
        routeSegments: [{
          id: SEGMENT_ID,
          name: '西安至延安',
          startPoint: '西安',
          endPoint: '延安',
          preference: 'HIGHWAY_FIRST',
          routeType: 'DRIVING',
        }],
      }],
    }],
  }
}

test('AMap driving result propagates through planner and resolved patch into one complete cache record', async () => {
  globalThis.indexedDB = new IDBFactory()
  const parsed = parseDrivingPath(loadDrivingPathFixture())
  const route = buildDrivingRouteResult(parsed, ROUTE_BUILD_KEY, ANALYZED_AT)
  const patch = buildResolvedRoutePatch({
    segmentId: SEGMENT_ID,
    routeBuildKey: ROUTE_BUILD_KEY,
    routeType: 'DRIVING',
    route,
  })

  assert.equal(parsed.roadParts?.length, 4)
  assert.equal(route.roadParts?.length, 3)
  assert.equal(patch.roadAnalysis?.routeBuildKey, ROUTE_BUILD_KEY)
  assert.deepEqual(patch.roadParts, route.roadParts)

  const nextTripReview = applyResolvedRoutePatches(createTripReview(), [patch])
  const resolvedSegment = nextTripReview.trips[0].days[0].routeSegments[0]
  assert.deepEqual(resolvedSegment.points, patch.points)
  assert.equal(resolvedSegment.distanceMeters, 17682)
  assert.equal(resolvedSegment.estimatedDurationSeconds, 1342)
  assert.equal(resolvedSegment.estimatedTollYuan, 8.5)
  assert.equal(resolvedSegment.tollDistanceMeters, 8200)
  assert.equal(resolvedSegment.routeBuildKey, ROUTE_BUILD_KEY)

  let putCount = 0
  const originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function countCompleteRoutePut(...args) {
    putCount += 1
    return originalPut.apply(this, args)
  }
  try {
    await persistResolvedRoutePatches([patch])
  } finally {
    IDBObjectStore.prototype.put = originalPut
  }

  assert.equal(putCount, 1)
  const cached = await getSegmentRouteCache(SEGMENT_ID)
  assert.deepEqual(cached, {
    segmentId: SEGMENT_ID,
    routeBuildKey: ROUTE_BUILD_KEY,
    points: patch.points,
    updatedAt: cached.updatedAt,
    distanceMeters: 17682,
    estimatedDurationSeconds: 1342,
    durationUpdatedAt: ANALYZED_AT,
    estimatedTollYuan: 8.5,
    tollDistanceMeters: 8200,
    tollUpdatedAt: ANALYZED_AT,
    roadParts: route.roadParts,
    roadAnalysis: route.roadAnalysis,
  })
})

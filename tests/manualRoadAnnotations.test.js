import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { IDBFactory } from 'fake-indexeddb'
import {
  getSegmentRouteCache,
  revokeManualRoadIntervalAnnotation,
  saveManualRoadIntervalAnnotation,
  savePlannedSegmentRouteCache,
} from '../src/services/routeCacheDb.ts'
import { buildTripBackupPayload, parseTripBackupJson } from '../src/services/tripBackup.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function createSegment(overrides = {}) {
  const segment = {
    id: 'pure-track',
    name: '纯轨迹路段',
    startPoint: '起点',
    endPoint: '终点',
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    points: [
      { lat: 34, lon: 108 },
      { lat: 34.01, lon: 108.01 },
      { lat: 34.02, lon: 108.02 },
      { lat: 34.03, lon: 108.03 },
      { lat: 34.04, lon: 108.04 },
    ],
    distanceMeters: 1000,
    ...overrides,
  }
  return { ...segment, routeBuildKey: buildSegmentRouteKey(segment) }
}

test('pure track interval annotation preserves geometry, allocates mileage and can be revoked', async () => {
  const segment = createSegment()
  const originalPoints = structuredClone(segment.points)
  const annotation = await saveManualRoadIntervalAnnotation({
    segment,
    startPointIndex: 1,
    endPointIndex: 3,
    roadClass: 'PROVINCIAL_ROAD',
    routeRef: 'S101',
    provinceCode: '610000',
  })
  const cache = await getSegmentRouteCache(segment.id)
  assert.deepEqual(segment.points, originalPoints)
  assert.equal(cache.manualRoadAnnotations.length, 1)
  assert.equal(cache.manualRoadAnnotations[0].provinceCode, '610000')
  assert.equal(cache.manualRoadAnnotations[0].distanceSource, 'RECORDED_ALLOCATION')
  assert.equal(cache.roadParts.reduce((sum, part) => sum + part.distanceMeters, 0), 1000)
  assert.equal(cache.roadParts.some((part) => part.source === 'MANUAL' && part.routeRef === 'S101'), true)
  assert.equal(cache.roadParts.some((part) => part.roadClass === 'UNKNOWN'), true)

  await assert.rejects(
    saveManualRoadIntervalAnnotation({
      segment,
      startPointIndex: 2,
      endPointIndex: 4,
      roadClass: 'NATIONAL_ROAD',
      routeRef: 'G210',
    }),
    /不能重叠/,
  )

  await revokeManualRoadIntervalAnnotation(segment.id, annotation.id)
  const restored = await getSegmentRouteCache(segment.id)
  assert.equal(restored.roadParts, undefined)
  assert.equal(restored.roadAnalysis, undefined)
  assert.equal(restored.manualRoadAnnotations, undefined)
  assert.deepEqual(restored.points, originalPoints)
})

test('interval annotation keeps the automatic base after revoke and does not double count', async () => {
  const segment = createSegment({ id: 'automatic-base' })
  const routeBuildKey = buildSegmentRouteKey(segment)
  await savePlannedSegmentRouteCache({
    segmentId: segment.id,
    routeBuildKey,
    points: segment.points,
    distanceMeters: 1000,
    roadParts: [{
      roadClass: 'NATIONAL_ROAD',
      routeRef: 'G210',
      roadName: 'G210 国道',
      distanceMeters: 1000,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
      polyline: segment.points.map((point) => [point.lat, point.lon]),
    }],
    roadAnalysis: {
      schemaVersion: 1,
      classifierVersion: 'rules-v4',
      analyzedAt: '2026-09-08T00:00:00.000Z',
      routeBuildKey,
      coverageMeters: 1000,
      routeDistanceMeters: 1000,
      coverageRatio: 1,
      distanceErrorMeters: 0,
      distanceToleranceMeters: 100,
      status: 'complete',
    },
  })
  const before = await getSegmentRouteCache(segment.id)
  const annotation = await saveManualRoadIntervalAnnotation({
    segment,
    startPointIndex: 1,
    endPointIndex: 3,
    roadClass: 'PROVINCIAL_ROAD',
    routeRef: 'S101',
    provinceCode: '610000',
  })
  const changed = await getSegmentRouteCache(segment.id)
  assert.equal(changed.roadParts.reduce((sum, part) => sum + part.distanceMeters, 0), 1000)
  assert.equal(changed.roadParts.some((part) => part.routeRef === 'G210'), true)
  assert.equal(changed.roadParts.some((part) => part.routeRef === 'S101'), true)

  await revokeManualRoadIntervalAnnotation(segment.id, annotation.id)
  const restored = await getSegmentRouteCache(segment.id)
  assert.deepEqual(restored.roadParts, before.roadParts)
  assert.deepEqual(restored.roadAnalysis, before.roadAnalysis)
})

test('province and manual annotation fields survive backup round-trip', () => {
  const segment = createSegment({ id: 'backup-segment' })
  const tripReview = {
    trips: [{
      id: 'review-1',
      title: '备份',
      category: 'review',
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      days: [{ id: 'day-1', date: '2026-01-01', routeSegments: [segment] }],
    }],
  }
  const record = {
    segmentId: segment.id,
    routeBuildKey: segment.routeBuildKey,
    points: segment.points,
    updatedAt: 1,
    roadParts: [{
      roadClass: 'PROVINCIAL_ROAD',
      routeRef: 'S101',
      provinceCode: '610000',
      provinceName: '陕西',
      provinceSource: 'MANUAL',
      provinceStatus: 'confirmed',
      distanceMeters: 1000,
      distanceSource: 'RECORDED_ALLOCATION',
      confidence: 'HIGH',
      source: 'MANUAL',
    }],
    manualRoadAnnotations: [{
      id: 'annotation-1',
      startPointIndex: 0,
      endPointIndex: 4,
      roadClass: 'PROVINCIAL_ROAD',
      routeRef: 'S101',
      provinceCode: '610000',
      provinceName: '陕西',
      provinceSource: 'MANUAL',
      provinceStatus: 'confirmed',
      distanceMeters: 1000,
      distanceSource: 'RECORDED_ALLOCATION',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }],
  }
  const payload = buildTripBackupPayload(tripReview, [record], new Date('2026-09-08T00:00:00.000Z'))
  const restored = parseTripBackupJson(JSON.stringify(payload))
  assert.equal(restored.segmentRoutes[0].roadParts[0].provinceCode, '610000')
  assert.equal(restored.segmentRoutes[0].manualRoadAnnotations[0].provinceStatus, 'confirmed')
})

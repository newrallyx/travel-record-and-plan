import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { IDBFactory } from 'fake-indexeddb'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'

import {
  buildTripBackupPayload,
  createTripBackupExport,
  parseTripBackupJson,
} from '../src/services/tripBackup.ts'
import { savePlannedSegmentRouteCache } from '../src/services/routeCacheDb.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

function createTripReviewWithFacts() {
  return {
    trips: [{
      id: 'trip-1',
      title: '旅程',
      category: 'review',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      days: [{
        id: 'day-1',
        date: '2026-08-01',
        routeSegments: [{
          id: 's-1',
          name: '成都到康定',
          startPoint: '成都',
          endPoint: '康定',
          preference: 'HIGHWAY_FIRST',
          routeType: 'DRIVING',
          distanceMeters: 354000,
          reviewFacts: {
            tags: ['SUNNY', 'WORTH_REVISIT'],
            actual: { distanceMeters: 371000, durationSeconds: 25500, tollYuan: 173.5 },
          },
        }],
      }],
    }],
  }
}

function createRoadParts(overrides = {}) {
  return [{
    roadClass: 'NATIONAL_ROAD',
    routeRef: 'G318',
    roadName: 'G318 国道',
    distanceMeters: 1000,
    confidence: 'HIGH',
    source: 'ROAD_NAME',
    polyline: [[30.1, 104.1], [30.2, 104.2]],
    ...overrides,
  }]
}

function createRoadAnalysis(overrides = {}) {
  return {
    schemaVersion: 1,
    classifierVersion: 'rules-v1',
    analyzedAt: '2026-09-01T08:00:00.000Z',
    routeBuildKey: 'segment-key',
    coverageMeters: 1000,
    routeDistanceMeters: 1000,
    coverageRatio: 1,
    distanceErrorMeters: 0,
    distanceToleranceMeters: 100,
    status: 'complete',
    ...overrides,
  }
}

function createRouteRecord(overrides = {}) {
  return {
    segmentId: 's-1',
    routeBuildKey: 'segment-key',
    points: [{ lat: 30.1, lon: 104.1 }, { lat: 30.2, lon: 104.2 }],
    updatedAt: 10,
    roadParts: createRoadParts(),
    roadAnalysis: createRoadAnalysis(),
    ...overrides,
  }
}

function createVersionedPayload(version, tripReview, segmentRoutes) {
  return {
    schema: 'roadtrip-retrospective-backup',
    version,
    exportedAt: '2026-08-01T00:00:00.000Z',
    sources: {},
    summary: {
      tripCount: tripReview.trips.length,
      routeSegmentCount: tripReview.trips.reduce(
        (sum, trip) => sum + trip.days.reduce((daySum, day) => daySum + day.routeSegments.length, 0),
        0,
      ),
      segmentRouteCacheCount: segmentRoutes.length,
    },
    data: { tripReview, segmentRoutes },
  }
}

function roundTripThroughV3(imported) {
  const v3 = buildTripBackupPayload(imported.tripReview, imported.segmentRoutes, new Date('2026-09-01T00:00:00.000Z'))
  return parseTripBackupJson(JSON.stringify(v3))
}

test('V3 export reads roadParts and roadAnalysis from IndexedDB', async () => {
  const routeRecord = createRouteRecord()
  await savePlannedSegmentRouteCache(routeRecord)

  const exported = await createTripBackupExport(createTripReviewWithFacts())
  const payload = JSON.parse(exported.json)

  assert.equal(payload.schema, 'roadtrip-retrospective-backup')
  assert.equal(payload.version, 3)
  assert.equal(exported.routeCacheCount, 1)
  assert.deepEqual(payload.data.segmentRoutes[0].roadParts, routeRecord.roadParts)
  assert.deepEqual(payload.data.segmentRoutes[0].roadAnalysis, {
    ...routeRecord.roadAnalysis,
    classifierVersion: ROAD_CLASSIFIER_VERSION,
  })
})

test('V3 round-trip preserves review facts and normalizes road fields', () => {
  const routeRecord = createRouteRecord({
    roadParts: createRoadParts({
      routeRef: ' ｇ ３１８ ',
      roadName: '  ｇ３１８　国道  ',
      instruction: '  沿G318行驶  ',
    }),
  })
  const payload = buildTripBackupPayload(
    createTripReviewWithFacts(),
    [routeRecord],
    new Date('2026-08-01T00:00:00.000Z'),
  )
  const imported = parseTripBackupJson(JSON.stringify(payload))
  const segment = imported.tripReview.trips[0].days[0].routeSegments[0]
  const part = imported.segmentRoutes[0].roadParts[0]

  assert.equal(payload.version, 3)
  assert.deepEqual(segment.reviewFacts, {
    tags: ['SUNNY', 'WORTH_REVISIT'],
    actual: { distanceMeters: 371000, durationSeconds: 25500, tollYuan: 173.5 },
  })
  assert.equal(part.routeRef, 'G318')
  assert.equal(part.roadName, 'G318 国道')
  assert.equal(part.instruction, '沿G318行驶')
  assert.deepEqual(imported.segmentRoutes[0].roadAnalysis, createRoadAnalysis({
    classifierVersion: ROAD_CLASSIFIER_VERSION,
  }))
})

test('V2 backup imports and round-trips through V3 without road analysis', () => {
  const routeRecord = createRouteRecord({ roadParts: undefined, roadAnalysis: undefined })
  const v2Payload = createVersionedPayload(2, createTripReviewWithFacts(), [routeRecord])
  const imported = parseTripBackupJson(JSON.stringify(v2Payload))
  const restored = roundTripThroughV3(imported)

  assert.equal(imported.routeCacheCount, 1)
  assert.equal(imported.segmentRoutes[0].roadParts, undefined)
  assert.deepEqual(restored.segmentRoutes, imported.segmentRoutes)
  assert.deepEqual(
    restored.tripReview.trips[0].days[0].routeSegments[0].reviewFacts,
    createTripReviewWithFacts().trips[0].days[0].routeSegments[0].reviewFacts,
  )
})

test('V1 backup imports and round-trips through V3 with legacy geometry intact', () => {
  const tripReview = createTripReviewWithFacts()
  tripReview.trips[0].days[0].routeSegments[0].reviewFacts = undefined
  const routeRecord = createRouteRecord({ roadParts: undefined, roadAnalysis: undefined })
  const v1Payload = createVersionedPayload(1, tripReview, [routeRecord])
  const imported = parseTripBackupJson(JSON.stringify(v1Payload))
  const restored = roundTripThroughV3(imported)

  assert.equal(imported.tripReview.trips[0].days[0].routeSegments[0].reviewFacts, undefined)
  assert.deepEqual(restored.segmentRoutes, imported.segmentRoutes)
  assert.deepEqual(restored.segmentRoutes[0].points, routeRecord.points)
})

test('legacy raw TripReview JSON imports and round-trips through V3', () => {
  const raw = createTripReviewWithFacts()
  const segment = raw.trips[0].days[0].routeSegments[0]
  segment.routeBuildKey = 'legacy-key'
  segment.points = [{ lat: 30.1, lon: 104.1 }, { lat: 30.2, lon: 104.2 }]

  const imported = parseTripBackupJson(JSON.stringify(raw))
  const restored = roundTripThroughV3(imported)

  assert.equal(imported.routeCacheCount, 1)
  assert.equal(restored.tripReview.trips[0].id, 'trip-1')
  assert.deepEqual(restored.segmentRoutes[0].points, segment.points)
})

test('V3 import rejects an entire roadParts extension with invalid coordinates, mileage or road class', () => {
  const invalidRecords = [
    createRouteRecord({
      segmentId: 'bad-coordinate',
      roadParts: createRoadParts({ polyline: [[91, 104.1], [30.2, 104.2]] }),
    }),
    createRouteRecord({
      segmentId: 'negative-distance',
      roadParts: createRoadParts({ distanceMeters: -1 }),
    }),
    createRouteRecord({
      segmentId: 'invalid-road-class',
      roadParts: createRoadParts({ roadClass: 'MOTORWAY' }),
    }),
    createRouteRecord({
      segmentId: 'mixed-validity',
      roadParts: [...createRoadParts(), ...createRoadParts({ distanceMeters: -5 })],
    }),
  ]
  const payload = createVersionedPayload(3, createTripReviewWithFacts(), invalidRecords)
  const imported = parseTripBackupJson(JSON.stringify(payload))

  assert.equal(imported.segmentRoutes.length, 4)
  for (const record of imported.segmentRoutes) {
    assert.equal(record.roadParts, undefined)
    assert.equal(record.roadAnalysis, undefined)
    assert.ok(record.points.length > 0)
  }
})

test('unsupported backup versions are rejected', () => {
  const v4Payload = createVersionedPayload(4, { trips: [] }, [])
  assert.throws(() => parseTripBackupJson(JSON.stringify(v4Payload)), /备份文件格式不匹配/)
})

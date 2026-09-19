import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { IDBFactory } from 'fake-indexeddb'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'

import {
  ROUTE_CACHE_DB_NAME,
  ROUTE_CACHE_DB_VERSION,
  ROUTE_CACHE_STORE_NAME,
  getAllSegmentRouteCacheStrict,
  getSegmentRouteCache,
  replaceAllSegmentRouteCache,
  saveManualSegmentRouteCache,
  savePlannedSegmentRouteCache,
} from '../src/services/routeCacheDb.ts'
import {
  buildLegacySegmentRouteKey,
  buildSegmentRouteKey,
  canDisplaySegmentRouteCache,
  getRoadAnalysisFreshness,
} from '../src/utils/routeBuildKey.ts'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const sampleRoadParts = [{
  roadClass: 'EXPRESSWAY',
  routeRef: 'G65',
  roadName: 'G65 包茂高速',
  distanceMeters: 1200,
  confidence: 'HIGH',
  source: 'ROAD_NAME',
  polyline: [[34.2, 108.9], [34.21, 108.91]],
}]

const sampleRoadAnalysis = {
  schemaVersion: 1,
  classifierVersion: 'rules-v1',
  analyzedAt: '2026-09-01T08:00:00.000Z',
  routeBuildKey: 'planner-key',
  coverageMeters: 1200,
  routeDistanceMeters: 1200,
  coverageRatio: 1,
  distanceErrorMeters: 0,
  distanceToleranceMeters: 100,
  status: 'complete',
}

function openRawDb(version, onUpgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ROUTE_CACHE_DB_NAME, version)
    request.onupgradeneeded = () => onUpgrade?.(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putRawRecord(db, record) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
    tx.objectStore(ROUTE_CACHE_STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

test('V1 geometry record upgrades to V2 and remains readable and displayable', async () => {
  const segment = {
    id: 'legacy-segment',
    name: '旧路线',
    startPoint: '西安',
    endPoint: '宝鸡',
    startCoord: { lat: 34.3416, lon: 108.9398 },
    endCoord: { lat: 34.3619, lon: 107.2379 },
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
  }
  const routeBuildKey = buildLegacySegmentRouteKey(segment)
  const v1Db = await openRawDb(1, (db) => {
    db.createObjectStore(ROUTE_CACHE_STORE_NAME, { keyPath: 'segmentId' })
  })
  await putRawRecord(v1Db, {
    segmentId: segment.id,
    routeBuildKey,
    points: [{ lat: 34.3416, lon: 108.9398 }, { lat: 34.3619, lon: 107.2379 }],
    updatedAt: 100,
  })
  v1Db.close()

  const record = await getSegmentRouteCache(segment.id)
  assert.equal(ROUTE_CACHE_DB_VERSION, 2)
  assert.deepEqual(record, {
    segmentId: segment.id,
    routeBuildKey,
    points: [{ lat: 34.3416, lon: 108.9398 }, { lat: 34.3619, lon: 107.2379 }],
    updatedAt: 100,
  })
  assert.equal(canDisplaySegmentRouteCache(segment, record.routeBuildKey), true)
  assert.equal(getRoadAnalysisFreshness(segment, record), 'missing')

  const upgradedDb = await openRawDb(ROUTE_CACHE_DB_VERSION)
  assert.equal(upgradedDb.version, 2)
  upgradedDb.close()
})

test('manual geometry save preserves estimates but clears the previous road classification atomically', async () => {
  await savePlannedSegmentRouteCache({
    segmentId: 'planned-segment',
    routeBuildKey: 'segment-key',
    points: [{ lat: 34.2, lon: 108.9 }, { lat: 34.21, lon: 108.91 }],
    distanceMeters: 1200,
    estimatedDurationSeconds: 180,
    durationUpdatedAt: '2026-09-01T08:00:00.000Z',
    estimatedTollYuan: 3.5,
    tollDistanceMeters: 1000,
    tollUpdatedAt: '2026-09-01T08:00:00.000Z',
    roadParts: sampleRoadParts,
    roadAnalysis: sampleRoadAnalysis,
  })

  const planned = await getSegmentRouteCache('planned-segment')
  assert.equal(planned.distanceMeters, 1200)
  assert.equal(planned.estimatedDurationSeconds, 180)
  assert.equal(planned.durationUpdatedAt, '2026-09-01T08:00:00.000Z')
  assert.equal(planned.estimatedTollYuan, 3.5)
  assert.equal(planned.tollDistanceMeters, 1000)
  assert.equal(planned.tollUpdatedAt, '2026-09-01T08:00:00.000Z')
  assert.deepEqual(planned.roadParts, sampleRoadParts)
  assert.deepEqual(planned.roadAnalysis, {
    ...sampleRoadAnalysis,
    classifierVersion: ROAD_CLASSIFIER_VERSION,
    routeBuildKey: 'segment-key',
  })

  const editedPoints = [{ lat: 34.2, lon: 108.9 }, { lat: 34.215, lon: 108.915 }]
  await saveManualSegmentRouteCache({
    segmentId: 'planned-segment',
    routeBuildKey: 'segment-key',
    points: editedPoints,
  })

  const edited = await getSegmentRouteCache('planned-segment')
  assert.deepEqual(edited.points, editedPoints)
  assert.equal(edited.distanceMeters, 1200)
  assert.equal(edited.estimatedDurationSeconds, 180)
  assert.equal(edited.estimatedTollYuan, 3.5)
  assert.equal(edited.roadParts, undefined)
  assert.equal(edited.roadAnalysis, undefined)

  await savePlannedSegmentRouteCache({
    segmentId: 'planned-segment',
    routeBuildKey: 'cycling-key',
    points: [{ lat: 34.3, lon: 108.8 }, { lat: 34.4, lon: 108.7 }],
  })
  const replaced = await getSegmentRouteCache('planned-segment')
  assert.equal(replaced.distanceMeters, undefined)
  assert.equal(replaced.estimatedDurationSeconds, undefined)
  assert.equal(replaced.estimatedTollYuan, undefined)
  assert.equal(replaced.roadParts, undefined)
  assert.equal(replaced.roadAnalysis, undefined)
})

test('invalid core records are rejected and invalid V2 extensions do not hide valid geometry', async () => {
  const db = await openRawDb(ROUTE_CACHE_DB_VERSION, (upgradeDb) => {
    upgradeDb.createObjectStore(ROUTE_CACHE_STORE_NAME, { keyPath: 'segmentId' })
  })
  await putRawRecord(db, {
    segmentId: 'invalid-core',
    routeBuildKey: 'key',
    points: [{ lat: Number.NaN, lon: 108.9 }],
    updatedAt: 1,
  })
  await putRawRecord(db, {
    segmentId: 'invalid-extension',
    routeBuildKey: 'key',
    points: [{ lat: 34.2, lon: 108.9 }],
    updatedAt: 2,
    roadParts: [{ ...sampleRoadParts[0], distanceMeters: -1 }],
    roadAnalysis: { ...sampleRoadAnalysis, coverageRatio: 2 },
  })
  db.close()

  assert.equal(await getSegmentRouteCache('invalid-core'), null)
  assert.deepEqual(await getSegmentRouteCache('invalid-extension'), {
    segmentId: 'invalid-extension',
    routeBuildKey: 'key',
    points: [{ lat: 34.2, lon: 108.9 }],
    updatedAt: 2,
  })
})

test('replace all clears stale records, keeps V1 records and preserves valid V2 analysis', async () => {
  await savePlannedSegmentRouteCache({
    segmentId: 'stale',
    routeBuildKey: 'stale-key',
    points: [{ lat: 1, lon: 1 }],
  })

  const count = await replaceAllSegmentRouteCache([
    {
      segmentId: 'legacy',
      routeBuildKey: 'legacy-key',
      points: [{ lat: 2, lon: 2 }],
      updatedAt: 10,
    },
    {
      segmentId: 'v2',
      routeBuildKey: 'v2-key',
      points: [{ lat: 3, lon: 3 }],
      updatedAt: 20,
      roadParts: sampleRoadParts,
      roadAnalysis: sampleRoadAnalysis,
    },
    {
      segmentId: '',
      routeBuildKey: 'invalid-key',
      points: [{ lat: 4, lon: 4 }],
      updatedAt: 30,
    },
  ])

  assert.equal(count, 2)
  const records = await getAllSegmentRouteCacheStrict()
  assert.deepEqual(records.map((record) => record.segmentId).sort(), ['legacy', 'v2'])
  assert.equal(records.find((record) => record.segmentId === 'legacy').roadParts, undefined)
  assert.deepEqual(records.find((record) => record.segmentId === 'v2').roadParts, sampleRoadParts)
  assert.deepEqual(records.find((record) => record.segmentId === 'v2').roadAnalysis, {
    ...sampleRoadAnalysis,
    classifierVersion: ROAD_CLASSIFIER_VERSION,
  })
})

test('older classifier caches are reclassified locally without replacing route geometry', async () => {
  const points = [{ lat: 34.2, lon: 108.9 }, { lat: 33.8, lon: 109.04 }]
  await savePlannedSegmentRouteCache({
    segmentId: 'g65-tunnels',
    routeBuildKey: 'g65-key',
    points,
    distanceMeters: 25_000,
    roadParts: [
      { ...sampleRoadParts[0], distanceMeters: 5_000 },
      {
        roadClass: 'URBAN_ROAD',
        roadName: '秦岭终南山公路隧道',
        tollRoad: '秦岭终南山公路隧道',
        instruction: '沿秦岭终南山公路隧道途径G65包茂高速向南行驶',
        distanceMeters: 19_500,
        confidence: 'MEDIUM',
        source: 'ROAD_NAME',
        polyline: [[34.1, 108.95], [33.81, 109.03]],
      },
      {
        roadClass: 'OTHER',
        roadName: '营盘立交',
        instruction: '沿营盘立交到达目的地',
        distanceMeters: 500,
        confidence: 'LOW',
        source: 'FALLBACK',
        polyline: [[33.81, 109.03], [33.8, 109.04]],
      },
    ],
    roadAnalysis: {
      ...sampleRoadAnalysis,
      coverageMeters: 25_000,
      routeDistanceMeters: 25_000,
    },
  })

  const upgraded = await getSegmentRouteCache('g65-tunnels')
  assert.deepEqual(upgraded.points, points)
  assert.equal(upgraded.roadAnalysis.classifierVersion, ROAD_CLASSIFIER_VERSION)
  assert.equal(upgraded.roadParts.length, 1)
  assert.equal(upgraded.roadParts[0].roadClass, 'EXPRESSWAY')
  assert.equal(upgraded.roadParts[0].routeRef, 'G65')
  assert.equal(upgraded.roadParts[0].distanceMeters, 25_000)
})

test('rules-v2 Chinese-number road aliases upgrade to the current corridor classifier', async () => {
  await savePlannedSegmentRouteCache({
    segmentId: 'g345-aliases',
    routeBuildKey: 'g345-key',
    points: [{ lat: 33.42, lon: 109.15 }, { lat: 33.31, lon: 108.53 }],
    distanceMeters: 3_000,
    roadParts: [
      {
        roadClass: 'COUNTY_ROAD',
        roadName: '310县道',
        instruction: '沿310县道途径345国道向西行驶',
        distanceMeters: 1_000,
        confidence: 'HIGH',
        source: 'ROAD_NAME',
      },
      {
        roadClass: 'NATIONAL_ROAD',
        roadName: '345国道',
        instruction: '沿345国道向西行驶',
        distanceMeters: 2_000,
        confidence: 'HIGH',
        source: 'ROAD_NAME',
      },
    ],
    roadAnalysis: {
      ...sampleRoadAnalysis,
      classifierVersion: 'rules-v2',
      coverageMeters: 3_000,
      routeDistanceMeters: 3_000,
    },
  })

  const upgraded = await getSegmentRouteCache('g345-aliases')
  assert.equal(upgraded.roadAnalysis.classifierVersion, ROAD_CLASSIFIER_VERSION)
  assert.equal(upgraded.roadParts.length, 1)
  assert.equal(upgraded.roadParts[0].roadClass, 'NATIONAL_ROAD')
  assert.equal(upgraded.roadParts[0].routeRef, 'G345')
  assert.equal(upgraded.roadParts[0].distanceMeters, 3_000)
})

test('lossy rules-v3 merged corridors remain stale until the route is analyzed again', async () => {
  const segment = {
    id: 'g211-huling',
    name: '镇安-户家塬镇',
    startPoint: '镇安收费站',
    endPoint: '户家塬镇',
    preference: 'SPEED_FIRST',
    routeType: 'DRIVING',
  }
  const routeBuildKey = buildSegmentRouteKey(segment)
  await savePlannedSegmentRouteCache({
    segmentId: segment.id,
    routeBuildKey,
    points: [{ lat: 33.43, lon: 109.17 }, { lat: 33.44, lon: 109.59 }],
    distanceMeters: 113_495,
    roadParts: [{
      roadClass: 'NATIONAL_ROAD',
      routeRef: 'G211',
      roadName: '211国道',
      instruction: '沿211国道向南行驶向左前方行驶',
      distanceMeters: 113_495,
      confidence: 'MEDIUM',
      source: 'MIXED',
    }],
    roadAnalysis: {
      ...sampleRoadAnalysis,
      classifierVersion: 'rules-v3',
      routeBuildKey,
      coverageMeters: 113_495,
      routeDistanceMeters: 113_495,
    },
  })

  const cached = await getSegmentRouteCache(segment.id)
  assert.equal(cached.roadAnalysis.classifierVersion, 'rules-v3')
  assert.equal(cached.roadParts[0].distanceMeters, 113_495)
  assert.equal(getRoadAnalysisFreshness(segment, cached), 'stale')
})

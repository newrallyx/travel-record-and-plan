import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { IDBFactory } from 'fake-indexeddb'
import {
  ROUTE_CACHE_DB_NAME,
  ROUTE_CACHE_DB_VERSION,
  ROUTE_CACHE_STORE_NAME,
  getAllSegmentRouteCacheStrict,
  getSegmentRouteCache,
  normalizeRouteCacheRecord,
  revokeManualRoadIntervalAnnotation,
  saveManualRoadIntervalAnnotation,
  savePlannedSegmentRouteCache,
  saveHistoricalRoadAnalysisOnly,
  replaceAllSegmentRouteCache,
} from '../src/services/routeCacheDb.ts'
import { buildTripBackupPayload, parseTripBackupJson } from '../src/services/tripBackup.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { restoreManualRoadAnnotationNames } from '../src/utils/manualRoadAnnotations.ts'
import { getRoadPartDisplayName } from '../src/utils/roadNamePresentation.ts'
import { roadEvidenceText } from '../src/utils/roadEvidence.ts'

test('custom interval names persist through editing, analysis, backup and clearing without replacing source evidence', async () => {
  const segment = createSegment({ id: 'custom-name' })
  await savePlannedSegmentRouteCache({
    segmentId: segment.id, routeBuildKey: segment.routeBuildKey, points: segment.points, distanceMeters: 1000,
    roadParts: [
      { roadClass: 'PROVINCIAL_ROAD', routeRef: 'S202', roadName: '202省道', provinceCode: '610000',
        distanceMeters: 500, confidence: 'HIGH', source: 'ROAD_NAME', polyline: segment.points.slice(0, 3).map(p => [p.lat, p.lon]) },
      { roadClass: 'EXPRESSWAY', routeRef: 'G30', tollRoad: '连霍高速',
        distanceMeters: 500, confidence: 'HIGH', source: 'ROAD_NAME', polyline: segment.points.slice(2).map(p => [p.lat, p.lon]) },
    ],
  })
  const before = await getSegmentRouteCache(segment.id)
  const input = { segment, startPointIndex: 0, endPointIndex: 4, roadClass: 'NATIONAL_ROAD', routeRef: 'G342', roadName: '  人工确认路  ' }
  const annotation = await saveManualRoadIntervalAnnotation(input)
  let named = await getSegmentRouteCache(segment.id)
  assert.equal(annotation.roadName, '人工确认路')
  assert.equal(named.manualRoadAnnotations[0].roadName, '人工确认路')
  assert.equal(named.roadParts.length, 2)
  assert.ok(named.roadParts.every(part => getRoadPartDisplayName(part) === '人工确认路'))
  assert.deepEqual(named.roadParts.map(part => part.originalRoadName), ['202省道', '连霍高速'])
  assert.match(roadEvidenceText(named.roadParts[0]), /原名称：202省道/)
  assert.deepEqual(named.roadAnnotationBaseParts, before.roadParts)
  const geometry = named.roadParts.map(part => part.polyline)
  const distances = named.roadParts.map(part => part.distanceMeters)
  const tripReview = { trips: [{ id: 'r', title: '备份', category: 'review', startDate: '2026-01-01', endDate: '2026-01-01',
    days: [{ id: 'd', date: '2026-01-01', routeSegments: [segment] }] }] }
  const restored = parseTripBackupJson(JSON.stringify(buildTripBackupPayload(tripReview, [named], new Date())))
  assert.deepEqual(restored.segmentRoutes[0].manualRoadAnnotations, named.manualRoadAnnotations)
  assert.deepEqual(restored.segmentRoutes[0].roadParts, named.roadParts)
  await replaceAllSegmentRouteCache(restored.segmentRoutes)
  assert.deepEqual((await getSegmentRouteCache(segment.id)).roadParts, named.roadParts)

  for (const concurrentRoads of [[], [{ roadClass: 'NATIONAL_ROAD', routeRef: 'G344' }]]) {
    await saveManualRoadIntervalAnnotation({ ...input, annotationId: annotation.id, roadName: '再次确认路', concurrentRoads })
    named = await getSegmentRouteCache(segment.id)
    assert.ok(named.roadParts.every(part => part.roadName === '再次确认路'))
    await saveHistoricalRoadAnalysisOnly({ segment, cache: named, routeBuildKey: segment.routeBuildKey, savedPoints: segment.points,
      route: { roadAnalysis: named.roadAnalysis, roadParts: named.roadParts.map(part => ({ ...part, source: 'ROAD_NAME',
        roadName: '新自动名称', originalRoadName: undefined, manualAnnotationId: undefined, concurrentRoads: undefined })) } })
    const analyzed = await getSegmentRouteCache(segment.id)
    assert.ok(analyzed.roadParts.every(part => part.roadName === '再次确认路'))
    assert.deepEqual(analyzed.roadParts.map(part => part.originalRoadName), ['202省道', '连霍高速'])
    assert.deepEqual(analyzed.manualRoadAnnotations, named.manualRoadAnnotations)
    assert.deepEqual(analyzed.points, named.points)
  }
  await saveManualRoadIntervalAnnotation({ ...input, annotationId: annotation.id, roadName: '   ' })
  const cleared = await getSegmentRouteCache(segment.id)
  assert.equal(cleared.manualRoadAnnotations[0].roadName, undefined)
  assert.deepEqual(cleared.roadParts.map(getRoadPartDisplayName), ['202省道', '连霍高速'])
  assert.ok(cleared.roadParts.every(part => !part.originalRoadName))
  assert.deepEqual(cleared.roadParts.map(part => part.polyline), geometry)
  assert.deepEqual(cleared.roadParts.map(part => part.distanceMeters), distances)
  assert.deepEqual(cleared.points, before.points)
  await revokeManualRoadIntervalAnnotation(segment.id, annotation.id)
  assert.deepEqual((await getSegmentRouteCache(segment.id)).roadParts, before.roadParts)
})

test('custom names on unnamed tracks survive rebuilding other annotations and clearing restores numbered fallback', async () => {
  const segment = createSegment()
  const input = { segment, startPointIndex: 0, endPointIndex: 2, roadClass: 'NATIONAL_ROAD', routeRef: 'G342', roadName: '自定义道路' }
  const first = await saveManualRoadIntervalAnnotation(input)
  const second = await saveManualRoadIntervalAnnotation({ segment, startPointIndex: 2, endPointIndex: 4,
    roadClass: 'NATIONAL_ROAD', routeRef: 'G344' })
  let cache = await getSegmentRouteCache(segment.id)
  assert.equal(cache.roadParts.find(part => part.manualAnnotationId === first.id).roadName, '自定义道路')
  const stale = structuredClone(cache)
  stale.roadParts.find(part => part.manualAnnotationId === first.id).roadName = undefined
  assert.equal(normalizeRouteCacheRecord(stale).roadParts.find(part => part.manualAnnotationId === first.id).roadName, '自定义道路')
  await revokeManualRoadIntervalAnnotation(segment.id, second.id)
  cache = await getSegmentRouteCache(segment.id)
  assert.equal(cache.roadParts.find(part => part.manualAnnotationId === first.id).roadName, '自定义道路')
  await saveManualRoadIntervalAnnotation({ ...input, annotationId: first.id, roadName: '' })
  cache = await getSegmentRouteCache(segment.id)
  assert.equal(getRoadPartDisplayName(cache.roadParts.find(part => part.manualAnnotationId === first.id)), 'G342 国道')
})

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
  assert.ok(changed.roadParts.filter(part => part.manualAnnotationId).every(part => part.roadName === 'G210 国道'))

  await revokeManualRoadIntervalAnnotation(segment.id, annotation.id)
  const restored = await getSegmentRouteCache(segment.id)
  assert.deepEqual(restored.roadParts, before.roadParts)
  assert.deepEqual(restored.roadAnalysis, before.roadAnalysis)
})

test('interval names survive crossing roads, legacy cache reads, editing, backup and revoke', async () => {
  const segment = createSegment({ id: 'named-interval' })
  await savePlannedSegmentRouteCache({
    segmentId: segment.id,
    routeBuildKey: segment.routeBuildKey,
    points: segment.points,
    distanceMeters: 1000,
    roadParts: [
      { roadClass: 'PROVINCIAL_ROAD', routeRef: 'S202', roadName: '202省道', provinceCode: '610000',
        distanceMeters: 500, confidence: 'HIGH', source: 'ROAD_NAME' },
      { roadClass: 'EXPRESSWAY', routeRef: 'G30', tollRoad: '连霍高速',
        distanceMeters: 500, confidence: 'HIGH', source: 'ROAD_NAME' },
    ],
    roadAnalysis: {
      schemaVersion: 1, classifierVersion: 'rules-v4', analyzedAt: '2026-10-09T00:00:00.000Z',
      routeBuildKey: segment.routeBuildKey, coverageMeters: 1000, routeDistanceMeters: 1000,
      coverageRatio: 1, distanceErrorMeters: 0, distanceToleranceMeters: 100, status: 'complete',
    },
  })
  const before = await getSegmentRouteCache(segment.id)
  const input = { segment, startPointIndex: 0, endPointIndex: 4, roadClass: 'NATIONAL_ROAD', routeRef: 'G242',
    concurrentRoads: [{ roadClass: 'NATIONAL_ROAD', routeRef: 'G344' }] }
  const annotation = await saveManualRoadIntervalAnnotation(input)
  const named = await getSegmentRouteCache(segment.id)
  assert.equal(named.roadParts.length, 2)
  assert.equal(named.roadParts[0].roadName, '202省道')
  assert.equal(named.roadParts[1].tollRoad, '连霍高速')
  assert.ok(named.roadParts.every(part => part.manualAnnotationId === annotation.id
    && part.source === 'MANUAL' && part.roadClass === 'NATIONAL_ROAD' && part.routeRef === 'G242'))
  assert.deepEqual(named.roadAnnotationBaseParts, before.roadParts)

  // Simulate a cache written by the old app, without going through new normalization on write.
  const legacy = structuredClone(named)
  legacy.roadParts.forEach(part => { delete part.roadName; delete part.tollRoad })
  const originalLegacy = structuredClone(legacy)
  const normalized = normalizeRouteCacheRecord(legacy)
  assert.deepEqual(normalized, named)
  assert.deepEqual(legacy, originalLegacy)
  assert.deepEqual(normalizeRouteCacheRecord(normalized), normalized)
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(ROUTE_CACHE_DB_NAME, ROUTE_CACHE_DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(ROUTE_CACHE_STORE_NAME, 'readwrite')
      tx.objectStore(ROUTE_CACHE_STORE_NAME).put(legacy)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
  assert.deepEqual(await getSegmentRouteCache(segment.id), named)
  assert.deepEqual((await getAllSegmentRouteCacheStrict())[0], named)
  const tripReview = { trips: [{ id: 'r', title: '备份', category: 'review', startDate: '2026-01-01',
    endDate: '2026-01-01', days: [{ id: 'd', date: '2026-01-01', routeSegments: [segment] }] }] }
  const backup = parseTripBackupJson(JSON.stringify(buildTripBackupPayload(tripReview, [legacy], new Date())))
  assert.equal(backup.segmentRoutes[0].roadParts[0].roadName, '202省道')
  assert.equal(backup.segmentRoutes[0].roadParts[1].tollRoad, '连霍高速')

  await saveManualRoadIntervalAnnotation({ ...input, annotationId: annotation.id, concurrentRoads: [
    ...input.concurrentRoads, { roadClass: 'NATIONAL_ROAD', routeRef: 'G345' },
  ] })
  const edited = await getSegmentRouteCache(segment.id)
  assert.equal(edited.roadParts[0].roadName, '202省道')
  assert.equal(edited.roadParts[1].tollRoad, '连霍高速')
  assert.ok(edited.roadParts.every(part => part.concurrentRoads.length === 2))
  assert.equal(edited.roadParts.reduce((sum, part) => sum + part.distanceMeters, 0), 1000)
  assert.deepEqual(edited.points, named.points)
  assert.deepEqual(edited.roadParts.map(part => part.polyline), named.roadParts.map(part => part.polyline))
  await revokeManualRoadIntervalAnnotation(segment.id, annotation.id)
  const revoked = await getSegmentRouteCache(segment.id)
  assert.deepEqual(revoked.roadParts, before.roadParts)
  assert.deepEqual(revoked.roadAnalysis, before.roadAnalysis)
})

test('legacy name recovery preserves existing names and does not guess across base boundaries', () => {
  const base = [
    { roadClass: 'NATIONAL_ROAD', roadName: '甲路', distanceMeters: 500, source: 'ROAD_NAME', confidence: 'HIGH' },
    { roadClass: 'NATIONAL_ROAD', roadName: '乙路', distanceMeters: 500, source: 'ROAD_NAME', confidence: 'HIGH' },
  ]
  const part = { roadClass: 'NATIONAL_ROAD', routeRef: 'G242', distanceMeters: 1000,
    source: 'MANUAL', confidence: 'HIGH', manualAnnotationId: 'a' }
  assert.deepEqual(restoreManualRoadAnnotationNames([part], base), [part])
  assert.deepEqual(restoreManualRoadAnnotationNames([part], []), [part])
  const named = { ...part, roadName: '已有名称' }
  assert.deepEqual(restoreManualRoadAnnotationNames([named], [{ ...base[0], distanceMeters: 1000 }]), [named])
  const standalone = { ...part, manualAnnotationId: undefined }
  assert.deepEqual(restoreManualRoadAnnotationNames([standalone], [{ ...base[0], distanceMeters: 1000 }]), [standalone])
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


test('manual direction survives cache and backup, rejects wrong endpoints, and returns to automatic', async () => {
  const segment = createSegment()
  const input = {segment, startPointIndex:0, endPointIndex:4, roadClass:'EXPRESSWAY', routeRef:'G22', manualDirection:'兰州'}
  const annotation = await saveManualRoadIntervalAnnotation(input)
  const cache = await getSegmentRouteCache(segment.id)
  assert.equal(cache.manualRoadAnnotations[0].manualDirection, '兰州')
  assert.ok(cache.roadParts.every(p => p.manualDirection === '兰州'))
  assert.deepEqual(cache.points, segment.points)
  assert.equal(cache.roadParts.reduce((n,p) => n + p.distanceMeters, 0), 1000)
  const tripReview = {trips:[{id:'r',title:'备份',category:'review',startDate:'2026-01-01',endDate:'2026-01-01',days:[{id:'d',date:'2026-01-01',routeSegments:[segment]}]}]}
  const restored = parseTripBackupJson(JSON.stringify(buildTripBackupPayload(tripReview, [cache], new Date())))
  assert.equal(restored.segmentRoutes[0].manualRoadAnnotations[0].manualDirection, '兰州')
  assert.equal(restored.segmentRoutes[0].roadParts[0].manualDirection, '兰州')
  await assert.rejects(saveManualRoadIntervalAnnotation({...input, annotationId:annotation.id, manualDirection:'西安'}), /不匹配/)
  await saveManualRoadIntervalAnnotation({...input, annotationId:annotation.id, manualDirection:'pending'})
  assert.equal((await getSegmentRouteCache(segment.id)).roadParts[0].manualDirection, 'pending')
  await saveManualRoadIntervalAnnotation({...input, annotationId:annotation.id, manualDirection:undefined})
  assert.ok((await getSegmentRouteCache(segment.id)).roadParts.every(p => !p.manualDirection))
  await revokeManualRoadIntervalAnnotation(segment.id, annotation.id)
  assert.ok(!(await getSegmentRouteCache(segment.id)).manualRoadAnnotations?.length)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { parseDrivingPathV5, requestDrivingRoute } from '../src/services/amap/routeApi.ts'
import { buildDrivingRouteResult, planCyclingRoute } from '../src/services/amap/routePlanner.ts'
import { buildResolvedRoutePatch } from '../src/components/map/resolvedRoutePatch.ts'
import { applyResolvedRoutePatches, persistResolvedRoutePatches } from '../src/hooks/resolvedRoutePatches.ts'
import { getSegmentRouteCache, saveManualSegmentRouteCache } from '../src/services/routeCacheDb.ts'
import { toPersistedTripReview } from '../src/services/tripStorage.ts'
import { parseTripBackupJson } from '../src/services/tripBackup.ts'
import { buildSegmentRouteKey, canReuseRecordedRoute } from '../src/utils/routeBuildKey.ts'
import { hasCurrentDurationEstimate } from '../src/utils/durations.ts'
import { getCurrentWaypointEstimates, normalizeWaypointEstimates } from '../src/utils/waypointEstimates.ts'

const via = [{ lat: 30.01, lng: 104.01 }, { lat: 30.02, lng: 104.02 }]
const expected = [{ distanceMeters: 1000, durationSeconds: 120 }, { distanceMeters: 3000, durationSeconds: 420 }]
function pathFixture() {
  return {
    distance: '6000', cost: { duration: '900', tolls: '5', toll_distance: '2000' },
    steps: [
      { road_name: 'S105', step_distance: '1000', cost: { duration: '120' },
        cities: [{ city: '成都市', adcode: '510100' }],
        polyline: '104,30;104.01,30.01', navi: { assistant_action: '到达途经地' } },
      { road_name: 'G5 京昆高速', step_distance: '2000',
        cost: { duration: '300', toll_distance: '2000', toll_road: '京昆高速' },
        polyline: '104.01,30.01;104.02,30.02', navi: { assistant_action: '到达途经地' },
        cities: [{ city: '成都市', adcode: '510100' }] },
      { step_distance: '3000', cost: { duration: '480' },
        polyline: '104.02,30.02;104.03,30.03', navi: { assistant_action: '到达目的地' } },
    ],
  }
}
function segmentFixture() {
  const segment = {
    id: 'via-test', name: '途经点测试', startPoint: '起点', endPoint: '终点',
    startCoord: { lat: 30, lon: 104 }, endCoord: { lat: 30.03, lon: 104.03 },
    preference: 'SPEED_FIRST', routeType: 'DRIVING',
    waypoints: via.map((point, index) => ({ ...point, id: `via-${index}`, name: `途经点${index}` })),
  }
  return { ...segment, routeBuildKey: buildSegmentRouteKey(segment) }
}
function reviewFixture(segment = segmentFixture()) {
  return { trips: [{ id: 'trip', title: '测试', category: 'plan', startDate: '2026-10-10', endDate: '2026-10-10',
    days: [{ id: 'day', date: '2026-10-10', routeSegments: [segment] }] }] }
}

test('V5 adapter retains totals, road evidence and two ordered cumulative estimates', () => {
  const result = parseDrivingPathV5(pathFixture(), via)
  assert.deepEqual(result.waypointEstimates, expected)
  assert.equal(result.distanceMeters, 6000)
  assert.equal(result.durationSeconds, 900)
  assert.equal(result.estimatedTollYuan, 5)
  assert.equal(result.tollDistanceMeters, 2000)
  assert.equal(result.roadParts[1].routeRef, 'G5')
  assert.equal(result.roadParts[0].provinceCode, '510000')
  assert.equal(result.roadParts[1].tollRoad, '京昆高速')
  assert.equal(result.polyline.length, 4)
  assert.equal(parseDrivingPathV5(pathFixture()).waypointEstimates, undefined)
  assert.deepEqual(parseDrivingPathV5({ ...pathFixture(), steps: pathFixture().steps.map((step, i) =>
    i === 1 ? { ...step, navi: {} } : step) }, [via[0]]).waypointEstimates, [expected[0]])
})

test('missing step time stays unknown downstream while independent distances survive', () => {
  const path = pathFixture()
  delete path.steps[1].cost.duration
  assert.deepEqual(parseDrivingPathV5(path, via).waypointEstimates, [expected[0], { distanceMeters: 3000 }])
  delete path.steps[0].step_distance
  assert.deepEqual(parseDrivingPathV5(path, via).waypointEstimates, [{ durationSeconds: 120 }, {}])
})

test('missing, extra, reversed or distant waypoint boundaries never produce guessed metrics', () => {
  for (const change of [
    path => { delete path.steps[0].navi },
    path => { path.steps[2].navi.assistant_action = '到达途经地' },
    path => { path.steps[0].polyline = '104,30;105,31' },
    path => { delete path.steps[0].polyline },
  ]) {
    const path = pathFixture(); change(path)
    assert.deepEqual(parseDrivingPathV5(path, via).waypointEstimates, [{}, {}])
    assert.equal(parseDrivingPathV5(path, via).durationSeconds, 900)
  }
  assert.deepEqual(parseDrivingPathV5(pathFixture(), [...via].reverse()).waypointEstimates, [{}, {}])
})

test('loops and repeated waypoints use navigation order instead of nearest geometry index', () => {
  const path = pathFixture()
  path.steps[1].polyline = '104.01,30.01;104.02,30.02;104.01,30.01'
  assert.deepEqual(parseDrivingPathV5(path, [via[0], via[0]]).waypointEstimates, expected)
})

test('zero values are valid; inconsistent full-route totals invalidate only affected metric', () => {
  const path = pathFixture()
  path.steps[0].cost.duration = '0'; path.cost.duration = '780'
  assert.equal(parseDrivingPathV5(path, via).waypointEstimates[0].durationSeconds, 0)
  path.cost.duration = '100'
  assert.deepEqual(parseDrivingPathV5(path, via).waypointEstimates, [{ distanceMeters: 1000 }, { distanceMeters: 3000 }])
  path.distance = '50'
  assert.deepEqual(parseDrivingPathV5(path, via).waypointEstimates, [{}, {}])
})

test('normalization rejects invalid data and never restores a broken cumulative chain as zero', () => {
  assert.equal(normalizeWaypointEstimates([null]), undefined)
  assert.equal(normalizeWaypointEstimates('bad'), undefined)
  assert.deepEqual(normalizeWaypointEstimates([{ distanceMeters: 0, durationSeconds: 0 },
    { distanceMeters: -1, durationSeconds: NaN }, { distanceMeters: 50, durationSeconds: 60 }]),
  [{ distanceMeters: 0, durationSeconds: 0 }, {}, {}])
})

test('route edits invalidate cumulative values and old saved full-route estimates remain available', () => {
  const segment = { ...segmentFixture(), waypointEstimates: expected, estimatedDurationSeconds: 900,
    points: [{ lat: 30, lon: 104 }, { lat: 30.03, lon: 104.03 }] }
  assert.deepEqual(getCurrentWaypointEstimates(segment), expected)
  for (const edit of [
    { waypoints: [...segment.waypoints].reverse() }, { waypoints: segment.waypoints.slice(1) },
    { startPoint: '其他起点' }, { startCoord: { lat: 31, lon: 105 } },
    { preference: 'AVOID_TOLL' }, { routeType: 'CYCLING' },
  ]) assert.equal(getCurrentWaypointEstimates({ ...segment, ...edit }), undefined)
  const old = { ...segment, waypointEstimates: undefined }
  assert.equal(getCurrentWaypointEstimates(old), undefined)
  assert.equal(canReuseRecordedRoute(old), true)
  assert.equal(hasCurrentDurationEstimate(old), true)
})

test('V5 estimates survive planner, state, local persistence, backup and IndexedDB, then clear on replacement', async () => {
  globalThis.indexedDB = new IDBFactory()
  const segment = segmentFixture()
  const route = buildDrivingRouteResult(parseDrivingPathV5(pathFixture(), via), segment.routeBuildKey)
  const patch = buildResolvedRoutePatch({ segmentId: segment.id, routeBuildKey: segment.routeBuildKey,
    routeType: 'DRIVING', route })
  const state = applyResolvedRoutePatches(reviewFixture(), [patch])
  assert.deepEqual(state.trips[0].days[0].routeSegments[0].waypointEstimates, expected)
  assert.equal(applyResolvedRoutePatches(state, [patch]), state)
  const persisted = toPersistedTripReview(state)
  const restored = parseTripBackupJson(JSON.stringify(persisted)).tripReview
  assert.deepEqual(restored.trips[0].days[0].routeSegments[0].waypointEstimates, expected)
  await persistResolvedRoutePatches([patch])
  assert.deepEqual((await getSegmentRouteCache(segment.id)).waypointEstimates, expected)
  await saveManualSegmentRouteCache({ segmentId: segment.id, routeBuildKey: segment.routeBuildKey, points: patch.points })
  assert.equal((await getSegmentRouteCache(segment.id)).waypointEstimates, undefined)
  await persistResolvedRoutePatches([{ ...patch, waypointEstimates: undefined }])
  assert.equal((await getSegmentRouteCache(segment.id)).waypointEstimates, undefined)
  const cleared = applyResolvedRoutePatches(state, [{ ...patch, waypointEstimates: undefined }])
  assert.equal(cleared.trips[0].days[0].routeSegments[0].waypointEstimates, undefined)
})

test('requestDrivingRoute connects actual V5 response shape to waypoint extraction', async t => {
  const originalFetch = globalThis.fetch; const originalWindow = globalThis.window
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { origin: 'http://localhost:3001' } }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, data: {
    status: '1', route: { paths: [pathFixture()] },
  } }) })
  const route = await requestDrivingRoute('104,30', '104.03,30.03', '0', '104.01,30.01|104.02,30.02')
  assert.deepEqual(route.waypointEstimates, expected)
})

test('cycling preserves cumulative legs without adding route requests, including missing time', async t => {
  const originalFetch = globalThis.fetch; const originalWindow = globalThis.window
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow })
  globalThis.window = { location: { origin: 'http://localhost:3001' }, setTimeout }
  let count = 0
  globalThis.fetch = async () => {
    const index = count++
    return { ok: true, json: async () => ({ ok: true, data: { errcode: 0, data: { paths: [{
      distance: 1000, ...(index !== 1 ? { duration: 120 } : {}),
      steps: [{ polyline: '104,30;104.01,30.01', distance: 1000 }],
    }] } } }) }
  }
  const { route, error } = await planCyclingRoute([{ lat: 30, lng: 104 }, ...via, { lat: 30.03, lng: 104.03 }], { forceRefresh: true })
  assert.equal(error, null)
  assert.equal(count, 3)
  assert.deepEqual(route.waypointEstimates, [{ distanceMeters: 1000, durationSeconds: 120 }, { distanceMeters: 2000 }])
  assert.equal(route.distanceMeters, 3000)
  assert.equal(route.durationSeconds, undefined)
})

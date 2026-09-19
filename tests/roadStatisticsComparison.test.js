import assert from 'node:assert/strict'
import test from 'node:test'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'

import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { filterStatisticsTrips } from '../src/utils/statisticsDashboard.ts'
import {
  selectNamedRoadRows,
  summarizeRoadStatisticsComparison,
} from '../src/utils/roadStatisticsComparison.ts'

function segment(id, distanceMeters) {
  const value = { id, name: id, startPoint: '甲', endPoint: '乙', preference: 'HIGHWAY_FIRST', routeType: 'DRIVING', distanceMeters }
  return { ...value, routeBuildKey: buildSegmentRouteKey(value) }
}

function trip(id, category, routeSegment) {
  return { id, title: id, category, startDate: '2026-01-01', endDate: '2026-01-01', days: [{ id: `${id}-day`, date: '2026-01-01', routeSegments: [routeSegment] }] }
}

function part(roadClass, distanceMeters, routeRef, roadName) {
  return { roadClass, distanceMeters, routeRef, roadName, confidence: 'HIGH', source: 'ROAD_NAME' }
}

function cache(routeSegment, roadParts) {
  const coverageMeters = roadParts.reduce((sum, item) => sum + item.distanceMeters, 0)
  return {
    segmentId: routeSegment.id,
    routeBuildKey: routeSegment.routeBuildKey,
    points: [{ lat: 30, lon: 104 }, { lat: 30.1, lon: 104.1 }],
    updatedAt: 1,
    roadParts,
    roadAnalysis: {
      schemaVersion: 1, classifierVersion: ROAD_CLASSIFIER_VERSION, analyzedAt: '2026-09-03T00:00:00.000Z',
      routeBuildKey: routeSegment.routeBuildKey, coverageMeters, routeDistanceMeters: coverageMeters,
      coverageRatio: 1, distanceErrorMeters: 0, distanceToleranceMeters: 100, status: 'complete',
    },
  }
}

function fixture() {
  const currentSegment = segment('current', 1_000)
  const oldSegment = segment('old', 500)
  const planSegment = segment('plan', 10_000)
  const current = trip('current-trip', 'review', currentSegment)
  const old = trip('old-trip', 'review', oldSegment)
  const plan = trip('plan-trip', 'plan', planSegment)
  const caches = [
    cache(currentSegment, [
      part('EXPRESSWAY', 300, 'g-65', '包茂高速'),
      part('NATIONAL_ROAD', 200, 'G210', '西安绕城国道'),
      part('PROVINCIAL_ROAD', 100, 'S101', '省道'),
      part('URBAN_ROAD', 100, undefined, '城市道路'),
      part('OTHER', 100, undefined, '连接线'),
      part('UNKNOWN', 200, undefined, undefined),
    ]),
    cache(oldSegment, [
      part('EXPRESSWAY', 200, 'G65', '包茂高速'),
      part('EXPRESSWAY', 100, undefined, '机场高速'),
      part('COUNTY_ROAD', 200, undefined, '县道'),
    ]),
    cache(planSegment, [part('EXPRESSWAY', 10_000, 'G65', '规划高速')]),
  ]
  return { current, allTrips: [current, old, plan], caches }
}

test('road comparison keeps the current scope beside all-review cumulative totals', () => {
  const { current, allTrips, caches } = fixture()
  const result = summarizeRoadStatisticsComparison([current], allTrips, caches)
  const row = (key) => result.composition.find((item) => item.roadClass === key)

  assert.deepEqual(
    result.composition.map((item) => [item.roadClass, item.currentDistanceMeters, item.historicalDistanceMeters]),
    [
      ['EXPRESSWAY', 300, 600],
      ['NATIONAL_ROAD', 200, 200],
      ['PROVINCIAL_ROAD', 100, 100],
      ['OTHER', 200, 400],
    ],
  )
  assert.equal(row('EXPRESSWAY').currentDistanceShare, 0.3)
  assert.equal(row('EXPRESSWAY').historicalDistanceShare, 0.4)
  assert.equal(result.unclassified.currentDistanceMeters, 200)
  assert.equal(result.historical.plannedDistanceMeters.value, 1_500)
})

test('named routes normalize refs, isolate unnumbered expressway, and count review trips', () => {
  const { current, allTrips, caches } = fixture()
  const result = summarizeRoadStatisticsComparison([current], allTrips, caches)
  const g65 = result.namedRoads.find((row) => row.key === 'EXPRESSWAY:G65')
  const unnumbered = result.namedRoads.find((row) => row.key === 'EXPRESSWAY:UNNUMBERED')

  assert.deepEqual([g65.currentDistanceMeters, g65.historicalDistanceMeters, g65.historicalTripCount], [300, 500, 2])
  assert.deepEqual([unnumbered.currentDistanceMeters, unnumbered.historicalDistanceMeters, unnumbered.historicalTripCount], [0, 100, 1])
  assert.deepEqual(unnumbered.roadNames, ['机场高速'])
  assert.equal(result.namedRoads.some((row) => row.key === 'EXPRESSWAY:G65' && row.historicalDistanceMeters === 10_500), false)
})

test('route search accepts spaced refs and sorts by current mileage', () => {
  const { current, allTrips, caches } = fixture()
  const rows = summarizeRoadStatisticsComparison([current], allTrips, caches).namedRoads
  assert.deepEqual(selectNamedRoadRows(rows, { query: 'G 65' }).map((row) => row.routeRef), ['G65'])
  assert.deepEqual(selectNamedRoadRows(rows, { direction: 'asc' }).map((row) => row.key), [
    'EXPRESSWAY:UNNUMBERED', 'PROVINCIAL_ROAD:PENDING:S101', 'NATIONAL_ROAD:G210', 'EXPRESSWAY:G65',
  ])
  assert.deepEqual(selectNamedRoadRows(rows, { currentOnly: true }).map((row) => row.key), [
    'EXPRESSWAY:G65', 'NATIONAL_ROAD:G210', 'PROVINCIAL_ROAD:PENDING:S101',
  ])
})

test('year and trip scopes rank roads and calculate shares using their own total mileage', () => {
  const segments = [segment('old', 10_000), segment('first', 1_000), segment('second', 1_000)]
  const trips = segments.map((value, index) => ({
    ...trip(value.id, 'review', value),
    startDate: index === 0 ? '2025-01-01' : '2026-01-01',
  }))
  const caches = [
    cache(segments[0], [part('EXPRESSWAY', 10_000, 'G5', '京昆高速')]),
    cache(segments[1], [part('EXPRESSWAY', 100, 'G5', '京昆高速'), part('EXPRESSWAY', 900, 'G65', '包茂高速')]),
    cache(segments[2], [part('EXPRESSWAY', 700, 'G5', '京昆高速'), part('EXPRESSWAY', 300, 'G65', '包茂高速')]),
  ]
  for (const [filter, expectedDistance, expectedShare] of [
    [{ scope: 'all', year: '', tripId: '' }, 10_800, 0.9],
    [{ scope: 'year', year: '2026', tripId: '' }, 1_200, 0.6],
    [{ scope: 'trip', year: '', tripId: 'first' }, 900, 0.9],
  ]) {
    const result = summarizeRoadStatisticsComparison(filterStatisticsTrips(trips, filter), trips, caches)
    const rows = selectNamedRoadRows(result.namedRoads)
    assert.equal(rows[0].routeRef, filter.scope === 'all' ? 'G5' : 'G65')
    assert.equal(rows[0].currentDistanceMeters, expectedDistance)
    assert.equal(rows[0].currentDistanceShare, expectedShare)
    assert.equal(result.historical.plannedDistanceMeters.value, 12_000)
    assert.deepEqual(selectNamedRoadRows(result.namedRoads, { direction: 'asc' }).map((row) => row.key), rows.map((row) => row.key).reverse())
    const searched = selectNamedRoadRows(result.namedRoads, { query: rows[0].routeRef, roadClass: 'EXPRESSWAY' })
    assert.equal(searched[0].currentDistanceShare, expectedShare)
  }
})

test('current mileage sorting keeps missing values last in either direction', () => {
  const { current, allTrips, caches } = fixture()
  const rows = summarizeRoadStatisticsComparison([current], allTrips, caches).namedRoads
  const missing = { ...rows[0], key: 'missing', currentDistanceMeters: null, historicalDistanceMeters: 99_999 }
  for (const direction of ['asc', 'desc']) {
    assert.equal(selectNamedRoadRows([...rows, missing], { direction }).at(-1).key, 'missing')
  }
})

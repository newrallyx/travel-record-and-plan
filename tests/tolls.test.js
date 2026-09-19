import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDrivingPath } from '../src/services/amap/routeApi.ts'
import { buildRouteKey, preferenceToStrategy } from '../src/services/amap/utils.ts'
import { parseTripBackupJson } from '../src/services/tripBackup.ts'
import { toPersistedTripReview } from '../src/services/tripStorage.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import {
  formatSegmentEstimatedToll,
  formatTollSummary,
  hasCurrentTollEstimate,
  summarizeEstimatedTolls,
} from '../src/utils/tolls.ts'

function createSegment(overrides = {}) {
  const segment = {
    id: 'segment-1',
    name: '西安到宝鸡',
    startPoint: '西安',
    endPoint: '宝鸡',
    startCoord: { lat: 34.3416, lon: 108.9398 },
    endCoord: { lat: 34.3619, lon: 107.2379 },
    routeType: 'DRIVING',
    preference: 'HIGHWAY_FIRST',
    ...overrides,
  }
  return segment
}

function withCurrentRoute(segment) {
  return { ...segment, routeBuildKey: buildSegmentRouteKey(segment) }
}

test('three route preferences map to distinct AMap V3 strategies and route keys', () => {
  assert.equal(preferenceToStrategy('SPEED_FIRST'), '0')
  assert.equal(preferenceToStrategy('HIGHWAY_FIRST'), '19')
  assert.equal(preferenceToStrategy('AVOID_TOLL'), '1')

  const points = [{ lat: 34.3, lng: 108.9 }, { lat: 34.4, lng: 107.2 }]
  assert.equal(new Set([
    buildRouteKey(points, 'SPEED_FIRST'),
    buildRouteKey(points, 'HIGHWAY_FIRST'),
    buildRouteKey(points, 'AVOID_TOLL'),
  ]).size, 3)
})

test('AMap driving response parses toll cost, toll distance and a legitimate zero', () => {
  const paid = parseDrivingPath({
    distance: '204217',
    duration: '9000',
    tolls: '86.5',
    toll_distance: '151000',
    steps: [{ polyline: '108.9398,34.3416;107.2379,34.3619' }],
  })
  assert.equal(paid.estimatedTollYuan, 86.5)
  assert.equal(paid.tollDistanceMeters, 151000)
  assert.equal(paid.distanceMeters, 204217)

  const free = parseDrivingPath({ tolls: '0', toll_distance: '0', steps: [] })
  assert.equal(free.estimatedTollYuan, 0)
  assert.equal(free.tollDistanceMeters, 0)

  const unknown = parseDrivingPath({ tolls: '', toll_distance: '-1', steps: [] })
  assert.equal(unknown.estimatedTollYuan, undefined)
  assert.equal(unknown.tollDistanceMeters, undefined)
})

test('toll summaries distinguish zero, pending, partial and cycling routes', () => {
  const paid = withCurrentRoute(createSegment({ id: 'paid', estimatedTollYuan: 86.5 }))
  const free = withCurrentRoute(createSegment({ id: 'free', estimatedTollYuan: 0 }))
  const pending = withCurrentRoute(createSegment({ id: 'pending' }))
  const cycling = withCurrentRoute(createSegment({ id: 'cycling', routeType: 'CYCLING' }))

  assert.equal(formatSegmentEstimatedToll(free), '¥0')
  assert.equal(formatSegmentEstimatedToll(pending), '待计算')
  assert.equal(formatSegmentEstimatedToll(cycling), '不适用')
  assert.equal(formatTollSummary(summarizeEstimatedTolls([paid, free, pending, cycling])), '¥86.5（另有 1 条待计算）')
})

test('a toll estimate becomes stale when route inputs or strategy change', () => {
  const original = withCurrentRoute(createSegment({ estimatedTollYuan: 50 }))
  assert.equal(hasCurrentTollEstimate(original), true)
  assert.equal(hasCurrentTollEstimate({ ...original, preference: 'SPEED_FIRST' }), false)
  assert.equal(hasCurrentTollEstimate({ ...original, endPoint: '咸阳' }), false)
})

test('trip persistence keeps valid estimates, all three strategies and old data compatibility', () => {
  const source = {
    trips: [{
      id: 'trip-1',
      title: '测试旅程',
      category: 'plan',
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      days: [{
        id: 'day-1',
        date: '2026-07-14',
        routeSegments: [
          withCurrentRoute(createSegment({
            preference: 'SPEED_FIRST',
            estimatedTollYuan: 12.5,
            tollDistanceMeters: 18000,
            tollUpdatedAt: '2026-07-14T08:00:00.000Z',
          })),
          createSegment({ id: 'legacy', preference: 'HIGHWAY_FIRST' }),
        ],
      }],
    }],
  }

  const persisted = toPersistedTripReview(source)
  const [saved, legacy] = persisted.trips[0].days[0].routeSegments
  assert.equal(saved.preference, 'SPEED_FIRST')
  assert.equal(saved.estimatedTollYuan, 12.5)
  assert.equal(saved.tollDistanceMeters, 18000)
  assert.equal(saved.tollUpdatedAt, '2026-07-14T08:00:00.000Z')
  assert.equal(legacy.estimatedTollYuan, undefined)

  const imported = parseTripBackupJson(JSON.stringify(source))
  const restored = imported.tripReview.trips[0].days[0].routeSegments[0]
  assert.equal(restored.estimatedTollYuan, 12.5)
  assert.equal(restored.tollDistanceMeters, 18000)
  assert.equal(restored.preference, 'SPEED_FIRST')
})

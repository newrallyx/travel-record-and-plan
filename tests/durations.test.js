import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCyclingPath, parseDrivingPath, parsePolyline } from '../src/services/amap/routeApi.ts'
import { parseTripBackupJson } from '../src/services/tripBackup.ts'
import { toPersistedTripReview } from '../src/services/tripStorage.ts'
import {
  formatDurationSeconds,
  formatDurationSummary,
  formatSegmentEstimatedDuration,
  hasCurrentDurationEstimate,
  summarizeEstimatedDurations,
  sumCompleteDurationSeconds,
} from '../src/utils/durations.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'

function createSegment(overrides = {}) {
  return {
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
}

function withCurrentRoute(segment) {
  return { ...segment, routeBuildKey: buildSegmentRouteKey(segment) }
}

test('AMap driving and cycling responses expose numeric duration seconds', () => {
  const driving = parseDrivingPath({
    distance: '204217',
    duration: '9300',
    steps: [{ polyline: '108.9398,34.3416;107.2379,34.3619' }],
  })
  assert.equal(driving.durationSeconds, 9300)

  const cycling = parseCyclingPath({
    distance: 12000,
    duration: 2700,
    steps: [{ polyline: '108.9398,34.3416;108.8398,34.3619' }],
  })
  assert.equal(cycling.durationSeconds, 2700)

  assert.equal(parseDrivingPath({ duration: '0' }).durationSeconds, 0)
  assert.equal(parseDrivingPath({ duration: '' }).durationSeconds, undefined)
  assert.equal(parseDrivingPath({ duration: '-1' }).durationSeconds, undefined)
  assert.equal(parseDrivingPath({ duration: 'invalid' }).durationSeconds, undefined)
})

test('route polyline removes only adjacent step joins and preserves later repeated coordinates', () => {
  assert.deepEqual(parsePolyline([
    { polyline: '104.000000,30.000000;104.100000,30.100000;104.200000,30.200000' },
    { polyline: '104.200000,30.200000;104.100000,30.100000;104.300000,30.300000' },
  ]), [
    [30, 104],
    [30.1, 104.1],
    [30.2, 104.2],
    [30.1, 104.1],
    [30.3, 104.3],
  ])
})

test('duration formatting supports minutes, hours, zero and partial totals', () => {
  assert.equal(formatDurationSeconds(0), '0分钟')
  assert.equal(formatDurationSeconds(45 * 60), '45分钟')
  assert.equal(formatDurationSeconds((2 * 60 + 35) * 60), '2小时35分钟')
  assert.equal(formatDurationSeconds(3 * 60 * 60), '3小时')

  const paid = withCurrentRoute(createSegment({ id: 'known', estimatedDurationSeconds: 9300 }))
  const zero = withCurrentRoute(createSegment({ id: 'zero', estimatedDurationSeconds: 0 }))
  const pending = withCurrentRoute(createSegment({ id: 'pending' }))

  assert.equal(formatSegmentEstimatedDuration(paid), '2小时35分钟')
  assert.equal(formatSegmentEstimatedDuration(zero), '0分钟')
  assert.equal(formatSegmentEstimatedDuration(pending), '待计算')
  assert.equal(
    formatDurationSummary(summarizeEstimatedDurations([paid, zero, pending])),
    '2小时35分钟（另有 1 条待计算）',
  )
  assert.equal(formatDurationSummary(summarizeEstimatedDurations([pending])), '待计算')
})

test('multi-leg cycling duration is summed only when every leg has a known duration', () => {
  assert.equal(sumCompleteDurationSeconds([1200, 1800, 900]), 3900)
  assert.equal(sumCompleteDurationSeconds([1200, undefined, 900]), undefined)
})

test('duration estimates become stale when route inputs, strategy or route type changes', () => {
  const original = withCurrentRoute(createSegment({ estimatedDurationSeconds: 9300 }))
  assert.equal(hasCurrentDurationEstimate(original), true)
  assert.equal(hasCurrentDurationEstimate({ ...original, preference: 'SPEED_FIRST' }), false)
  assert.equal(hasCurrentDurationEstimate({ ...original, endPoint: '咸阳' }), false)
  assert.equal(hasCurrentDurationEstimate({ ...original, routeType: 'CYCLING' }), false)
  assert.equal(hasCurrentDurationEstimate({ ...original, waypoints: [{ id: 'wp-1', name: '法门寺' }] }), false)
})

test('trip persistence and backup import preserve durations while legacy data stays compatible', () => {
  const source = {
    trips: [{
      id: 'trip-1',
      title: '时间测试旅程',
      category: 'plan',
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      days: [{
        id: 'day-1',
        date: '2026-07-14',
        routeSegments: [
          withCurrentRoute(createSegment({
            estimatedDurationSeconds: 9300,
            durationUpdatedAt: '2026-07-14T08:00:00.000Z',
          })),
          createSegment({ id: 'legacy' }),
        ],
      }],
    }],
  }

  const persisted = toPersistedTripReview(source)
  const [saved, legacy] = persisted.trips[0].days[0].routeSegments
  assert.equal(saved.estimatedDurationSeconds, 9300)
  assert.equal(saved.durationUpdatedAt, '2026-07-14T08:00:00.000Z')
  assert.equal(legacy.estimatedDurationSeconds, undefined)

  const imported = parseTripBackupJson(JSON.stringify(source))
  const restored = imported.tripReview.trips[0].days[0].routeSegments[0]
  assert.equal(restored.estimatedDurationSeconds, 9300)
  assert.equal(restored.durationUpdatedAt, '2026-07-14T08:00:00.000Z')
})

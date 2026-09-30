import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_TRIP_STATISTICS_SORT,
  filterStatisticsTrips,
  getStatisticsYears,
  getStatisticsTripOptions,
  sortTripStatisticsRows,
} from '../src/utils/statisticsDashboard.ts'
import { summarizeSingleTripStatistics } from '../src/utils/tripStatistics.ts'

function createTrip(id, category, startDate) {
  return { id, title: id, category, startDate, endDate: startDate, days: [] }
}

function complete(value) {
  return {
    value,
    completeness: {
      status: 'complete', totalItemCount: 1, completeItemCount: 1,
      partialItemCount: 0, missingItemCount: 0, staleItemCount: 0, notApplicableItemCount: 0,
    },
  }
}

function missing() {
  return {
    value: null,
    completeness: {
      status: 'missing', totalItemCount: 1, completeItemCount: 0,
      partialItemCount: 0, missingItemCount: 1, staleItemCount: 0, notApplicableItemCount: 0,
    },
  }
}

function row(title, planned, status = 'complete') {
  return {
    tripId: title,
    title,
    category: 'review',
    segmentCount: 1,
    plannedDistanceMeters: planned === null ? missing() : complete(planned),
    actualDistanceMeters: missing(),
    tripDays: complete(1),
    estimatedDrivingTimeSeconds: complete(3600),
    actualDrivingTimeSeconds: missing(),
    dataCompleteness: {
      overallStatus: status,
      plannedDistance: planned === null ? missing().completeness : complete(1).completeness,
      actualDistance: missing().completeness,
    },
  }
}

test('statistics filters include only review trips and support all, year, and specific trip scopes', () => {
  const trips = [
    createTrip('review-2025', 'review', '2025-10-01'),
    createTrip('review-2026', 'review', '2026-01-01'),
    createTrip('plan-2026', 'plan', '2026-02-01'),
    createTrip('bad-date', 'review', 'unknown'),
  ]

  assert.deepEqual(getStatisticsYears(trips), ['2026', '2025'])
  assert.deepEqual(
    filterStatisticsTrips(trips, { scope: 'all', year: '', tripId: '' }).map((trip) => trip.id),
    ['review-2025', 'review-2026', 'bad-date'],
  )
  assert.deepEqual(
    filterStatisticsTrips(trips, { scope: 'year', year: '2026', tripId: '' }).map((trip) => trip.id),
    ['review-2026'],
  )
  assert.deepEqual(
    filterStatisticsTrips(trips, { scope: 'trip', year: '', tripId: 'review-2025' }).map((trip) => trip.id),
    ['review-2025'],
  )
})

test('trip selector sorts review trips by actual start date without changing input order', () => {
  const trips = [
    createTrip('A-late', 'review', '2026-01-01'),
    createTrip('missing', 'review', ''),
    createTrip('Z-early', 'review', '2024-11-01'),
    createTrip('plan', 'plan', '2023-01-01'),
    createTrip('invalid', 'review', '2025-02-30'),
    createTrip('B-same-date', 'review', '2024-12-01'),
    createTrip('A-same-date', 'review', '2024-12-01'),
  ]
  const originalOrder = trips.map((trip) => trip.id)
  assert.deepEqual(getStatisticsTripOptions(trips).map((trip) => trip.id), [
    'Z-early', 'A-same-date', 'B-same-date', 'A-late', 'invalid', 'missing',
  ])
  assert.deepEqual(trips.map((trip) => trip.id), originalOrder)
})

test('statistics table sorting keeps missing values after known values in both directions', () => {
  const rows = [row('乙', null, 'missing'), row('甲', 200, 'partial'), row('丙', 100, 'complete')]

  assert.deepEqual(
    sortTripStatisticsRows(rows, { key: 'plannedDistance', direction: 'asc' }).map((item) => item.title),
    ['丙', '甲', '乙'],
  )
  assert.deepEqual(
    sortTripStatisticsRows(rows, { key: 'plannedDistance', direction: 'desc' }).map((item) => item.title),
    ['甲', '丙', '乙'],
  )
  assert.deepEqual(
    sortTripStatisticsRows(rows, { key: 'completeness', direction: 'asc' }).map((item) => item.title),
    ['丙', '甲', '乙'],
  )
})

test('trip column sorts by start date across months and years regardless of title', () => {
  const trips = [
    createTrip('2023 10月凤县', 'review', '2023-10-01'),
    createTrip('2024 元旦', 'review', '2024-01-01'),
    createTrip('2023 3月洛南', 'review', '2023-03-01'),
    createTrip('名称与日期无关', 'review', '2022-12-31'),
    createTrip('2023 10月另一次', 'review', '2023-10-20'),
  ]
  const rows = trips.map((trip) => summarizeSingleTripStatistics(trip, []).tripBreakdown[0])
  const originalOrder = rows.map((item) => item.tripId)
  const expected = [trips[3].id, trips[2].id, trips[0].id, trips[4].id, trips[1].id]
  assert.deepEqual(sortTripStatisticsRows(rows, DEFAULT_TRIP_STATISTICS_SORT).map((item) => item.tripId), expected)
  assert.deepEqual(sortTripStatisticsRows(rows, { key: 'startDate', direction: 'desc' }).map((item) => item.tripId), [...expected].reverse())
  assert.deepEqual(rows.map((item) => item.tripId), originalOrder)
})

test('trip date sorting keeps absent and invalid dates last in both directions', () => {
  const rows = [
    { ...row('missing', 1), startDate: '' },
    { ...row('later', 1), startDate: '2024-03-01' },
    { ...row('invalid', 1), startDate: '2024-02-30' },
    { ...row('earlier', 1), startDate: '2024-02-29' },
  ]
  for (const direction of ['asc', 'desc']) {
    const sorted = sortTripStatisticsRows(rows, { key: 'startDate', direction })
    assert.deepEqual(sorted.slice(0, 2).map((item) => item.title), direction === 'asc' ? ['earlier', 'later'] : ['later', 'earlier'])
    assert.deepEqual(new Set(sorted.slice(2).map((item) => item.title)), new Set(['missing', 'invalid']))
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { moveTripToReview } from '../src/utils/tripLifecycle.ts'
import { buildTripFactSummary } from '../src/utils/factSummary.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'

function createSegment(id, overrides = {}) {
  const segment = {
    id,
    name: `路段-${id}`,
    startPoint: 'A',
    endPoint: 'B',
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    ...overrides,
  }
  if (overrides.routeBuildKey === undefined) {
    segment.routeBuildKey = buildSegmentRouteKey(segment)
  }
  return segment
}

function createTrip(id, { category = 'plan', order = 0, days = [], startDate = '2026-08-01', endDate = '2026-08-07' } = {}) {
  return {
    id,
    title: `旅程-${id}`,
    category,
    order,
    startDate,
    endDate,
    days,
  }
}

function createDay(id, date, segments) {
  return { id, date, routeSegments: segments }
}

test('moveTripToReview moves a plan trip to review while keeping ids', () => {
  const planTrip = createTrip('trip-a', { category: 'plan', order: 0 })
  const reviewTrip = createTrip('trip-b', { category: 'review', order: 0 })
  const review = { trips: [planTrip, reviewTrip] }

  const result = moveTripToReview(review, 'trip-a')
  const moved = result.trips.find((trip) => trip.id === 'trip-a')
  const untouched = result.trips.find((trip) => trip.id === 'trip-b')

  assert.equal(moved.category, 'review')
  assert.equal(moved.id, 'trip-a')
  assert.equal(moved.days, planTrip.days, 'days reference must be preserved')
  assert.equal(moved.title, planTrip.title)
  assert.equal(moved.startDate, planTrip.startDate)
  assert.equal(moved.endDate, planTrip.endDate)
  assert.equal(untouched.category, 'review')
})

test('moveTripToReview appends the trip to the end of review order', () => {
  const planTrip = createTrip('trip-c', { category: 'plan', order: 0 })
  const reviewTrips = ['trip-1', 'trip-2'].map((id, order) => createTrip(id, { category: 'review', order }))
  const review = { trips: [...reviewTrips, planTrip] }

  const result = moveTripToReview(review, 'trip-c')
  const reviewOnly = result.trips.filter((trip) => trip.category === 'review').sort((a, b) => a.order - b.order)
  assert.deepEqual(reviewOnly.map((trip) => trip.id), ['trip-1', 'trip-2', 'trip-c'])
  assert.equal(result.trips.find((trip) => trip.id === 'trip-c').order, 2)
  assert.equal(result.trips.find((trip) => trip.id === 'trip-1').order, 0)
})

test('moveTripToReview does not move a trip already in review', () => {
  const reviewTrip = createTrip('trip-d', { category: 'review', order: 0 })
  const review = { trips: [reviewTrip] }
  assert.equal(moveTripToReview(review, 'trip-d'), review)
})

test('moveTripToReview returns original data for unknown trip id', () => {
  const planTrip = createTrip('trip-e', { category: 'plan', order: 0 })
  const review = { trips: [planTrip] }
  assert.equal(moveTripToReview(review, 'missing-id'), review)
})

test('moveTripToReview returns new object only when something moved', () => {
  const planTrip = createTrip('trip-f', { category: 'plan', order: 0 })
  const review = { trips: [planTrip] }
  const result = moveTripToReview(review, 'trip-f')
  assert.notEqual(result, review)
  assert.notEqual(result.trips, review.trips)
})

test('buildTripFactSummary covers all known facts', () => {
  const trip = createTrip('trip-1', {
    days: [
      createDay('day-1', '2026-08-01', [
        createSegment('s-1', {
          distanceMeters: 354000,
          estimatedDurationSeconds: 22800,
          estimatedTollYuan: 168,
        }),
        createSegment('s-2', {
          distanceMeters: 1326000,
          estimatedDurationSeconds: 78000,
          estimatedTollYuan: 0,
        }),
      ]),
    ],
  })
  const summary = buildTripFactSummary(trip)
  assert.match(summary, /本次旅程从 2026 年 8 月 1 日 持续至 2026 年 8 月 7 日/)
  assert.match(summary, /共 1 天、2 条路段/)
  assert.match(summary, /总里程约 1680 公里/)
  assert.match(summary, /预计行驶 28小时/)
  assert.match(summary, /预估过路费 ¥168/)
})

test('buildTripFactSummary omits missing facts', () => {
  const trip = createTrip('trip-2', {
    days: [
      createDay('day-1', '2026-08-01', [createSegment('s-1')]),
    ],
  })
  const summary = buildTripFactSummary(trip)
  assert.match(summary, /共 1 天、1 条路段/)
  assert.doesNotMatch(summary, /总里程/)
  assert.doesNotMatch(summary, /预计行驶/)
  assert.doesNotMatch(summary, /过路费/)
  assert.doesNotMatch(summary, /照片/)
})

test('buildTripFactSummary reports photo count once per photo id', () => {
  const trip = createTrip('trip-3', {
    days: [
      createDay('day-1', '2026-08-01', [
        createSegment('s-1', { photoIds: ['p-1', 'p-2'] }),
        createSegment('s-2', { photoIds: ['p-2', 'p-3'] }),
      ]),
    ],
  })
  assert.match(buildTripFactSummary(trip), /关联照片 3 张/)
})

test('buildTripFactSummary returns empty string for a trip without facts', () => {
  const trip = {
    id: 'trip-4',
    title: '空旅程',
    category: 'plan',
    startDate: '',
    endDate: '',
    days: [],
  }
  assert.equal(buildTripFactSummary(trip), '')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeTripOrders, sortTripsByOrder, sortTripsByStartDate } from '../src/utils/tripOrder.ts'

function createTrip(id, category, order, startDate = '2026-01-01', endDate = '2026-01-01') {
  return {
    id,
    category,
    order,
    title: id,
    startDate,
    endDate,
    days: [],
  }
}

test('trip ordering follows visible order instead of backing-array order', () => {
  const trips = [
    createTrip('third', 'review', 2),
    createTrip('first', 'review', 0),
    createTrip('second', 'review', 1),
  ]

  assert.deepEqual(sortTripsByOrder(trips).map((trip) => trip.id), ['first', 'second', 'third'])
})

test('trip order normalization repairs gaps and duplicates independently per workspace', () => {
  const trips = [
    createTrip('review-last', 'review', 8),
    createTrip('plan-second', 'plan', 4),
    createTrip('review-first', 'review', 2),
    createTrip('plan-first', 'plan', 4),
  ]

  const normalized = normalizeTripOrders(trips)
  const orderById = Object.fromEntries(normalized.map((trip) => [trip.id, trip.order]))

  assert.deepEqual(orderById, {
    'review-last': 1,
    'plan-second': 0,
    'review-first': 0,
    'plan-first': 1,
  })
})

test('trips are sorted by start date with end date as tiebreaker', () => {
  const trips = [
    createTrip('late', 'plan', 0, '2026-03-01', '2026-03-05'),
    createTrip('early', 'plan', 1, '2026-01-10', '2026-01-12'),
    createTrip('mid', 'plan', 2, '2026-02-01', '2026-02-03'),
    createTrip('same-start-long', 'plan', 3, '2026-02-01', '2026-02-20'),
  ]

  assert.deepEqual(sortTripsByStartDate(trips).map((trip) => trip.id), [
    'early',
    'mid',
    'same-start-long',
    'late',
  ])
})

test('inserted trip order is assigned by start date within the workspace', () => {
  const trips = [
    createTrip('existing-late', 'review', 0, '2026-03-01', '2026-03-05'),
    createTrip('existing-early', 'review', 1, '2026-01-10', '2026-01-12'),
    createTrip('other-workspace', 'plan', 0, '2026-06-01', '2026-06-02'),
  ]
  const newTrip = createTrip('new-trip', 'review', 0, '2026-02-01', '2026-02-03')

  const orderById = new Map(
    sortTripsByStartDate([...trips.filter((trip) => trip.category === 'review'), newTrip])
      .map((trip, order) => [trip.id, order]),
  )

  assert.equal(orderById.get('existing-early'), 0)
  assert.equal(orderById.get('new-trip'), 1)
  assert.equal(orderById.get('existing-late'), 2)
})

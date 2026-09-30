import assert from 'node:assert/strict'
import test from 'node:test'
import { filterTripsByYear, getSelectedYear, getTripYear } from '../src/utils/tripYear.ts'

const trips = [
  { id: 'old', startDate: '2021-01-22', endDate: '2021-01-25' },
  { id: 'cross-year', startDate: '2025-12-30', endDate: '2026-01-03' },
  { id: 'new', startDate: '2026-03-01', endDate: '2026-03-02' },
  { id: 'undated', startDate: '' },
]

test('year overview includes whole trips by start year and preserves ordering', () => {
  assert.equal(getTripYear(trips[1]), '2025')
  assert.deepEqual(filterTripsByYear(trips, '2025').map((trip) => trip.id), ['cross-year'])
  assert.deepEqual(filterTripsByYear(trips, '2026').map((trip) => trip.id), ['new'])
  assert.deepEqual(filterTripsByYear(trips, '2030'), [])
  assert.equal(filterTripsByYear(trips, ''), trips)
  assert.deepEqual(filterTripsByYear(trips, 'unknown').map((trip) => trip.id), ['undated'])
})

test('direct trip navigation follows the trip year instead of a stale year selection', () => {
  assert.equal(getSelectedYear(trips, { year: '2021', tripId: 'new' }), '2026')
  assert.equal(getSelectedYear(trips, { year: '2021', tripId: '' }), '2021')
  assert.equal(getSelectedYear(trips, { tripId: '' }), '')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ROADBOOK_EMPTY_FILTER,
  filterRoadbookTrips,
  getTripTags,
  getTripYears,
  summarizeRoadbookStats,
  tripMatchesQuery,
  tripMatchesTag,
} from '../src/utils/roadbookFilters.ts'
import { toPersistedTripReview } from '../src/services/tripStorage.ts'
import { createPhotoConsistencyRepair } from '../src/services/photoConsistency.ts'

function createSegment(id, overrides = {}) {
  return {
    id,
    name: `路段-${id}`,
    startPoint: '成都',
    endPoint: '康定',
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    ...overrides,
  }
}

function createTrip(id, { startDate = '2026-08-01', category = 'review', days = [], coverPhotoId } = {}) {
  return {
    id,
    title: `旅程-${id}`,
    category,
    startDate,
    endDate: startDate,
    days,
    ...(coverPhotoId ? { coverPhotoId } : {}),
  }
}

function createDay(id, date, segments) {
  return { id, date, routeSegments: segments }
}

test('filterRoadbookTrips filters by year', () => {
  const trips = [
    createTrip('t-2025', { startDate: '2025-05-01' }),
    createTrip('t-2026', { startDate: '2026-08-01' }),
  ]
  const result = filterRoadbookTrips(trips, { ...ROADBOOK_EMPTY_FILTER, year: '2026' })
  assert.deepEqual(result.map((trip) => trip.id), ['t-2026'])
})

test('getTripYears returns unique years in descending order', () => {
  const trips = [
    createTrip('t-1', { startDate: '2025-05-01' }),
    createTrip('t-2', { startDate: '2026-08-01' }),
    createTrip('t-3', { startDate: '2025-06-01' }),
    createTrip('t-4', { startDate: 'bad-date' }),
  ]
  assert.deepEqual(getTripYears(trips), ['2026', '2025'])
})

test('tripMatchesQuery searches title, endpoints and waypoints', () => {
  const trip = createTrip('t-1', {
    days: [createDay('d-1', '2026-08-01', [
      createSegment('s-1', { startPoint: '成都', endPoint: '康定', waypoints: [{ id: 'w-1', name: '雅安' }] }),
    ])],
  })
  assert.equal(tripMatchesQuery(trip, '旅程-'), true)
  assert.equal(tripMatchesQuery(trip, '雅安'), true)
  assert.equal(tripMatchesQuery(trip, '成都'), true)
  assert.equal(tripMatchesQuery(trip, '康定'), true)
  assert.equal(tripMatchesQuery(trip, '拉萨'), false)
  assert.equal(tripMatchesQuery(trip, ''), true)
})

test('tripMatchesTag matches any segment tag', () => {
  const trip = createTrip('t-1', {
    days: [createDay('d-1', '2026-08-01', [
      createSegment('s-1', { reviewFacts: { tags: ['SUNNY', 'MOUNTAIN_ROAD'] } }),
      createSegment('s-2'),
    ])],
  })
  assert.equal(tripMatchesTag(trip, 'MOUNTAIN_ROAD'), true)
  assert.equal(tripMatchesTag(trip, 'RAIN'), false)
  assert.equal(tripMatchesTag(trip, ''), true)
})

test('getTripTags returns union of segment tags', () => {
  const trips = [
    createTrip('t-1', {
      days: [createDay('d-1', '2026-08-01', [
        createSegment('s-1', { reviewFacts: { tags: ['SUNNY', 'FOG'] } }),
      ])],
    }),
    createTrip('t-2', {
      days: [createDay('d-1', '2026-08-02', [
        createSegment('s-2', { reviewFacts: { tags: ['FOG', 'WORTH_REVISIT'] } }),
      ])],
    }),
  ]
  assert.deepEqual(getTripTags(trips).sort(), ['FOG', 'SUNNY', 'WORTH_REVISIT'])
})

test('filterRoadbookTrips combines year, query and tag', () => {
  const trips = [
    createTrip('t-1', {
      startDate: '2026-08-01',
      days: [createDay('d-1', '2026-08-01', [
        createSegment('s-1', { endPoint: '康定', reviewFacts: { tags: ['FOG'] } }),
      ])],
    }),
    createTrip('t-2', {
      startDate: '2026-09-01',
      days: [createDay('d-1', '2026-09-01', [
        createSegment('s-2', { endPoint: '康定' }),
      ])],
    }),
    createTrip('t-3', {
      startDate: '2025-08-01',
      days: [createDay('d-1', '2025-08-01', [
        createSegment('s-3', { endPoint: '康定', reviewFacts: { tags: ['FOG'] } }),
      ])],
    }),
  ]
  const result = filterRoadbookTrips(trips, { year: '2026', query: '康定', tag: 'FOG' })
  assert.deepEqual(result.map((trip) => trip.id), ['t-1'])
})

test('summarizeRoadbookStats aggregates trips, segments, photos and distance', () => {
  const trips = [
    createTrip('t-1', {
      days: [createDay('d-1', '2026-08-01', [
        createSegment('s-1', { distanceMeters: 100000, photoIds: ['p-1', 'p-2'] }),
        createSegment('s-2', { photoIds: ['p-2'] }),
      ])],
    }),
    createTrip('t-2', { days: [createDay('d-1', '2026-09-01', [createSegment('s-3')])] }),
  ]
  const stats = summarizeRoadbookStats(trips)
  assert.equal(stats.tripCount, 2)
  assert.equal(stats.segmentCount, 3)
  assert.equal(stats.photoCount, 2)
  assert.equal(stats.distanceMeters, 100000)
})

test('summarizeRoadbookStats returns null distance when nothing is known', () => {
  const stats = summarizeRoadbookStats([createTrip('t-1', { days: [] })])
  assert.equal(stats.tripCount, 1)
  assert.equal(stats.distanceMeters, null)
})

test('summarizeRoadbookStats counts review trips only and keeps repeated mileage', () => {
  const repeatedRoute = { distanceMeters: 120000, startPoint: '成都', endPoint: '康定' }
  const stats = summarizeRoadbookStats([
    createTrip('review-1', {
      days: [createDay('d-1', '2026-08-01', [createSegment('s-1', repeatedRoute)])],
    }),
    createTrip('review-2', {
      days: [createDay('d-2', '2026-08-02', [createSegment('s-2', repeatedRoute)])],
    }),
    createTrip('plan-1', {
      category: 'plan',
      days: [createDay('d-3', '2026-08-03', [createSegment('s-3', { distanceMeters: 500000 })])],
    }),
  ])

  assert.equal(stats.tripCount, 2)
  assert.equal(stats.segmentCount, 2)
  assert.equal(stats.distanceMeters, 240000)
})

test('toPersistedTripReview keeps and trims valid cover photo ids', () => {
  const review = {
    trips: [createTrip('t-1', { coverPhotoId: '  photo-1  ' })],
  }
  const persisted = toPersistedTripReview(review)
  assert.equal(persisted.trips[0].coverPhotoId, 'photo-1')
  const withoutCover = toPersistedTripReview({ trips: [createTrip('t-2')] })
  assert.equal(withoutCover.trips[0].coverPhotoId, undefined)
})

test('cover repair clears a cover photo that no longer belongs to the trip', () => {
  const data = {
    trips: [
      createTrip('t-1', {
        coverPhotoId: 'photo-1',
        days: [createDay('d-1', '2026-08-01', [createSegment('s-1', { photoIds: ['photo-1'] })])],
      }),
    ],
  }
  const photos = [
    { id: 'photo-1', segmentId: 's-1', storageMode: 'linked', libraryRootId: 'r-1', relativePath: 'a.jpg', importedAt: 'x', updatedAt: 'x', fingerprint: { size: 1, modifiedAt: 1 } },
  ]
  const repair = createPhotoConsistencyRepair(data, photos)
  assert.equal(repair.tripReview.trips[0].coverPhotoId, 'photo-1')

  const missingPhotoRepair = createPhotoConsistencyRepair(data, [])
  assert.equal(missingPhotoRepair.tripReview.trips[0].coverPhotoId, undefined)

  const movedToOtherTrip = createPhotoConsistencyRepair({
    trips: [
      createTrip('t-1', {
        coverPhotoId: 'photo-1',
        days: [createDay('d-1', '2026-08-01', [createSegment('s-1')])],
      }),
      createTrip('t-2', {
        days: [createDay('d-1', '2026-09-01', [createSegment('s-2', { photoIds: ['photo-1'] })])],
      }),
    ],
  }, [{
    id: 'photo-1', segmentId: 's-2', storageMode: 'linked', libraryRootId: 'r-1', relativePath: 'a.jpg', importedAt: 'x', updatedAt: 'x', fingerprint: { size: 1, modifiedAt: 1 },
  }])
  assert.equal(movedToOtherTrip.tripReview.trips[0].coverPhotoId, undefined)
})

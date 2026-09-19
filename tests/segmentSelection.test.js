import assert from 'node:assert/strict'
import test from 'node:test'

import { getSavedSegmentSelection } from '../src/hooks/tripManager/utils.ts'

function createSegmentRef() {
  const currentSegment = { id: 'segment-current', name: 'Current route' }
  const currentDay = { id: 'day-current', date: '2026-07-26', routeSegments: [currentSegment] }
  const nextDay = {
    id: 'day-next',
    date: '2026-07-27',
    routeSegments: [{ id: 'segment-next', name: 'Next route' }],
  }

  return {
    tripIndex: 0,
    dayIndex: 0,
    segmentIndex: 0,
    trip: {
      id: 'trip-1',
      title: 'Trip',
      category: 'plan',
      startDate: currentDay.date,
      endDate: nextDay.date,
      days: [currentDay, nextDay],
    },
    day: currentDay,
    segment: currentSegment,
  }
}

test('saving segment metadata keeps the current segment and its real day id selected', () => {
  const ref = createSegmentRef()

  assert.deepEqual(getSavedSegmentSelection(ref, ref.day.date), {
    dayId: 'day-current',
    segmentId: 'segment-current',
  })
})

test('moving a segment to an existing day keeps that segment selected', () => {
  const ref = createSegmentRef()

  assert.deepEqual(getSavedSegmentSelection(ref, '2026-07-27'), {
    dayId: 'day-next',
    segmentId: 'segment-current',
  })
})

test('moving a segment to a new day uses the id created by updateSegmentMeta', () => {
  const ref = createSegmentRef()

  assert.deepEqual(getSavedSegmentSelection(ref, '2026-07-28'), {
    dayId: '2026-07-28',
    segmentId: 'segment-current',
  })
})

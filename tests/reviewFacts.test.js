import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReviewFactsFromDraft,
  formatActualSummaryText,
  getReviewFactsDraftDefaults,
  summarizeActualResults,
} from '../src/utils/reviewFacts.ts'
import { toPersistedTripReview } from '../src/services/tripStorage.ts'

function createSegment(id, overrides = {}) {
  return {
    id,
    name: `路段-${id}`,
    startPoint: 'A',
    endPoint: 'B',
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    ...overrides,
  }
}

test('buildReviewFactsFromDraft assembles a complete facts object', () => {
  const facts = buildReviewFactsFromDraft({
    tags: ['SUNNY', 'MOUNTAIN_ROAD'],
    distanceText: '371.4',
    durationHoursText: '7',
    durationMinutesText: '5',
    tollText: '173.5',
  })
  assert.deepEqual(facts, {
    tags: ['SUNNY', 'MOUNTAIN_ROAD'],
    actual: { distanceMeters: 371400, durationSeconds: 25500, tollYuan: 173.5 },
  })
})

test('buildReviewFactsFromDraft returns undefined when nothing is filled', () => {
  assert.equal(buildReviewFactsFromDraft({
    tags: [],
    distanceText: '',
    durationHoursText: '',
    durationMinutesText: '',
    tollText: '',
  }), undefined)
})

test('buildReviewFactsFromDraft drops invalid numbers and duplicate tags', () => {
  const facts = buildReviewFactsFromDraft({
    tags: ['RAIN', 'RAIN'],
    distanceText: '-5',
    durationHoursText: '200',
    durationMinutesText: '99',
    tollText: 'abc',
  })
  assert.deepEqual(facts, { tags: ['RAIN'] })
})

test('getReviewFactsDraftDefaults maps stored facts back to text fields', () => {
  const draft = getReviewFactsDraftDefaults({
    tags: ['FOG'],
    actual: { distanceMeters: 120500, durationSeconds: 4500, tollYuan: 45 },
  })
  assert.deepEqual(draft, {
    tags: ['FOG'],
    distanceText: '120.5',
    durationHoursText: '1',
    durationMinutesText: '15',
    tollText: '45',
  })
})

test('getReviewFactsDraftDefaults returns empty fields without facts', () => {
  const draft = getReviewFactsDraftDefaults(undefined)
  assert.deepEqual(draft, {
    tags: [],
    distanceText: '',
    durationHoursText: '',
    durationMinutesText: '',
    tollText: '',
  })
})

test('summarizeActualResults only counts segments that were actually filled', () => {
  const segments = [
    createSegment('s-1', { reviewFacts: { actual: { distanceMeters: 100000, durationSeconds: 3600, tollYuan: 50 } } }),
    createSegment('s-2', { reviewFacts: { actual: { distanceMeters: 200000 } } }),
    createSegment('s-3', { reviewFacts: { tags: ['SUNNY'] } }),
    createSegment('s-4'),
  ]
  const summary = summarizeActualResults(segments)
  assert.equal(summary.distanceMeters, 300000)
  assert.equal(summary.durationSeconds, 3600)
  assert.equal(summary.tollYuan, 50)
  assert.equal(summary.knownSegmentCount, 2)
  assert.equal(summary.partial, true)
})

test('summarizeActualResults returns nulls when nothing is filled', () => {
  const summary = summarizeActualResults([createSegment('s-1'), createSegment('s-2')])
  assert.equal(summary.distanceMeters, null)
  assert.equal(summary.durationSeconds, null)
  assert.equal(summary.tollYuan, null)
  assert.equal(summary.knownSegmentCount, 0)
  assert.equal(summary.partial, false)
})

test('formatActualSummaryText marks incomplete records and omits empty fields', () => {
  const partial = summarizeActualResults([
    createSegment('s-1', { reviewFacts: { actual: { distanceMeters: 100000 } } }),
    createSegment('s-2'),
  ])
  assert.equal(formatActualSummaryText(partial), '实际里程 100.0 公里（部分路段有实际记录）')

  const complete = summarizeActualResults([
    createSegment('s-1', { reviewFacts: { actual: { distanceMeters: 100000, durationSeconds: 3600, tollYuan: 50 } } }),
  ])
  assert.equal(formatActualSummaryText(complete), '实际里程 100.0 公里 · 实际用时 1小时 · 实际过路费 ¥50')

  assert.equal(formatActualSummaryText(summarizeActualResults([createSegment('s-1')])), '')
})

test('toPersistedTripReview keeps valid review facts and drops unknown tags', () => {
  const review = {
    trips: [{
      id: 'trip-1',
      title: '旅程',
      category: 'review',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      days: [{
        id: 'day-1',
        date: '2026-08-01',
        routeSegments: [
          createSegment('s-1', {
            reviewFacts: {
              tags: ['SUNNY', 'NOT_A_TAG', 'ROADWORK'],
              actual: { distanceMeters: 123400, durationSeconds: 3600, tollYuan: -5 },
            },
          }),
        ],
      }],
    }],
  }
  const persisted = toPersistedTripReview(review)
  const facts = persisted.trips[0].days[0].routeSegments[0].reviewFacts
  assert.deepEqual(facts, {
    tags: ['SUNNY', 'ROADWORK'],
    actual: { distanceMeters: 123400, durationSeconds: 3600 },
  })
})

test('toPersistedTripReview returns undefined review facts for old data without them', () => {
  const review = {
    trips: [{
      id: 'trip-1',
      title: '旅程',
      category: 'review',
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      days: [{
        id: 'day-1',
        date: '2026-08-01',
        routeSegments: [createSegment('s-1')],
      }],
    }],
  }
  const persisted = toPersistedTripReview(review)
  assert.equal(persisted.trips[0].days[0].routeSegments[0].reviewFacts, undefined)
})

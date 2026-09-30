import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import {
  getNaturalTripDayCount,
  summarizeReviewTripStatistics,
  summarizeSingleTripStatistics,
} from '../src/utils/tripStatistics.ts'

function createSegment(id, overrides = {}) {
  const segment = {
    id,
    name: id,
    startPoint: `${id}-start`,
    endPoint: `${id}-end`,
    preference: 'HIGHWAY_FIRST',
    routeType: 'DRIVING',
    ...overrides,
  }
  return { ...segment, routeBuildKey: buildSegmentRouteKey(segment) }
}

function createTrip(id, category, startDate, endDate, segments) {
  return {
    id,
    title: id,
    category,
    startDate,
    endDate,
    days: [{ id: `${id}-day`, date: startDate, routeSegments: segments }],
  }
}

function createRoadPart(roadClass, distanceMeters, routeRef, roadName) {
  return {
    roadClass,
    distanceMeters,
    routeRef,
    roadName,
    confidence: 'HIGH',
    source: 'ROAD_NAME',
  }
}

function createCache(segment, roadParts, status = 'complete', routeBuildKey = segment.routeBuildKey) {
  const coverageMeters = roadParts.reduce((sum, part) => sum + part.distanceMeters, 0)
  return {
    segmentId: segment.id,
    routeBuildKey,
    points: [{ lat: 30, lon: 104 }, { lat: 30.1, lon: 104.1 }],
    updatedAt: 1,
    roadParts,
    roadAnalysis: {
      schemaVersion: 1,
      classifierVersion: ROAD_CLASSIFIER_VERSION,
      analyzedAt: '2026-09-01T00:00:00.000Z',
      routeBuildKey,
      coverageMeters,
      routeDistanceMeters: coverageMeters,
      coverageRatio: 1,
      distanceErrorMeters: 0,
      distanceToleranceMeters: 100,
      status,
    },
  }
}

function findRoadClass(summary, roadClass) {
  return summary.roadClassDistance.entries.find((entry) => entry.roadClass === roadClass)
}

function findBand(distribution, key) {
  return distribution.bands.find((band) => band.key === key)
}

function createFixture() {
  const s1 = createSegment('s1', {
    distanceMeters: 500_000,
    estimatedDurationSeconds: 10 * 60 * 60,
    scenicScore: 9,
    difficultyScore: 7,
    reviewFacts: { actual: { distanceMeters: 480_000, durationSeconds: 9 * 60 * 60 } },
  })
  const s2 = createSegment('s2', {
    distanceMeters: 500_000,
    scenicScore: 4.9,
    difficultyScore: null,
    reviewFacts: { actual: { distanceMeters: 510_000 } },
  })
  const s3 = createSegment('s3', {
    distanceMeters: 600_000,
    estimatedDurationSeconds: 20 * 60 * 60,
    scenicScore: 6.9,
    difficultyScore: 10,
    reviewFacts: { actual: { distanceMeters: 610_000, durationSeconds: 21 * 60 * 60 } },
  })
  const s4 = createSegment('s4', {
    routeType: 'CYCLING',
    distanceMeters: 100_000,
    estimatedDurationSeconds: 2 * 60 * 60,
    scenicScore: null,
    difficultyScore: 5,
    reviewFacts: { actual: { durationSeconds: 2 * 60 * 60 } },
  })
  const p1 = createSegment('p1', {
    distanceMeters: 2_000_000,
    estimatedDurationSeconds: 40 * 60 * 60,
    scenicScore: 10,
    difficultyScore: 10,
  })

  const reviewOne = createTrip('review-1', 'review', '2026-01-01', '2026-01-03', [s1, s2])
  const reviewTwo = createTrip('review-2', 'review', '2026-02-01', '2026-02-01', [s3, s4])
  const plan = createTrip('plan-1', 'plan', '2026-03-01', '2026-03-02', [p1])

  const caches = [
    createCache(s1, [
      createRoadPart('EXPRESSWAY', 300_000, 'G65', '包茂高速'),
      createRoadPart('NATIONAL_ROAD', 200_000, 'G210', 'G210 国道'),
    ]),
    createCache(
      s2,
      [createRoadPart('EXPRESSWAY', 500_000, 'G65', '包茂高速')],
      'complete',
      'stale-route-key',
    ),
    createCache(s3, [
      createRoadPart('EXPRESSWAY', 100_000, 'G65', '包茂高速'),
      createRoadPart('EXPRESSWAY', 50_000, undefined, '机场高速'),
      createRoadPart('PROVINCIAL_ROAD', 450_000, 'S101', 'S101 省道'),
    ], 'partial'),
    createCache(s4, [createRoadPart('EXPRESSWAY', 100_000, 'G65', '虚构骑行高速')]),
    createCache(p1, [createRoadPart('EXPRESSWAY', 2_000_000, 'G65', '规划中的包茂高速')]),
  ]

  return {
    tripReview: { trips: [reviewOne, reviewTwo, plan] },
    reviewOne,
    reviewTwo,
    plan,
    caches,
  }
}

test('natural trip days include both endpoints and reject invalid ranges', () => {
  assert.equal(getNaturalTripDayCount({ startDate: '2026-01-01', endDate: '2026-01-01' }), 1)
  assert.equal(getNaturalTripDayCount({ startDate: '2026-01-01', endDate: '2026-01-03' }), 3)
  assert.equal(getNaturalTripDayCount({ startDate: '2026-02-30', endDate: '2026-03-01' }), null)
  assert.equal(getNaturalTripDayCount({ startDate: '2026-03-02', endDate: '2026-03-01' }), null)
})

test('review statistics separate planned and actual totals and exclude plan trips', () => {
  const fixture = createFixture()
  const summary = summarizeReviewTripStatistics(fixture.tripReview, fixture.caches)

  assert.equal(summary.tripCount, 2)
  assert.equal(summary.segmentCount, 4)
  assert.deepEqual(summary.tripBreakdown.map((trip) => trip.tripId), ['review-1', 'review-2'])
  assert.deepEqual(
    [summary.plannedDistanceMeters.value, summary.plannedDistanceMeters.completeness.status],
    [1_700_000, 'complete'],
  )
  assert.deepEqual(
    [summary.estimatedDrivingTimeSeconds.value, summary.estimatedDrivingTimeSeconds.completeness.status],
    [30 * 60 * 60, 'partial'],
  )
  assert.deepEqual(
    [summary.actualDistanceMeters.value, summary.actualDistanceMeters.completeness.status],
    [1_600_000, 'partial'],
  )
  assert.deepEqual(
    [summary.actualDrivingTimeSeconds.value, summary.actualDrivingTimeSeconds.completeness.status],
    [30 * 60 * 60, 'partial'],
  )
  assert.deepEqual([summary.tripDays.value, summary.tripDays.completeness.status], [4, 'complete'])

  assert.equal(findBand(summary.distributions.plannedMileage, 'KM_500_TO_1000').itemCount, 1)
  assert.equal(findBand(summary.distributions.plannedMileage, 'KM_1000_TO_1500').itemCount, 1)
  assert.equal(summary.distributions.plannedMileage.distanceShareDenominatorMeters, 1_700_000)
  assert.equal(findBand(summary.distributions.actualMileage, 'KM_500_TO_1000').distanceMeters, 990_000)
  assert.equal(summary.distributions.actualMileage.pending.itemCount, 1)
  assert.equal(summary.distributions.estimatedDrivingTime.pending.itemCount, 1)
  assert.equal(findBand(summary.distributions.estimatedDrivingTime, 'HOURS_20_TO_40').itemCount, 1)
  assert.equal(findBand(summary.distributions.actualDrivingTime, 'HOURS_20_TO_40').itemCount, 1)
  assert.equal(summary.distributions.actualDrivingTime.distancePendingItemCount, 1)
  assert.equal(findBand(summary.distributions.tripDays, 'DAY_TRIP').distanceMeters, 700_000)
  assert.equal(findBand(summary.distributions.tripDays, 'SHORT_TRIP').distanceMeters, 1_000_000)
})

test('road totals use only current driving analysis, keep repeated mileage and expose completeness', () => {
  const fixture = createFixture()
  const summary = summarizeReviewTripStatistics(fixture.tripReview, fixture.caches)

  assert.equal(summary.roadClassDistance.analyzedDistanceMeters, 1_200_000)
  assert.equal(findRoadClass(summary, 'EXPRESSWAY').distanceMeters, 550_000)
  assert.equal(findRoadClass(summary, 'NATIONAL_ROAD').distanceMeters, 200_000)
  assert.equal(findRoadClass(summary, 'PROVINCIAL_ROAD').distanceMeters, 450_000)

  const g65 = summary.numberedRoadDistance.entries.find((entry) => entry.routeRef === 'G65')
  const g210 = summary.numberedRoadDistance.entries.find((entry) => entry.routeRef === 'G210')
  assert.deepEqual([g65.distanceMeters, g65.tripCount, g65.roadPartCount], [500_000, 2, 3])
  assert.equal(g210.distanceMeters, 200_000)
  assert.equal(summary.numberedRoadDistance.entries.find((entry) => entry.routeRef === 'S101').distanceMeters, 450_000)
  assert.equal(summary.numberedRoadDistance.unnumberedExpressway.distanceMeters, 50_000)
  assert.equal(summary.numberedRoadDistance.distanceShareDenominatorMeters, 1_200_000)

  assert.deepEqual(summary.dataCompleteness.roadAnalysis, {
    status: 'partial',
    totalItemCount: 4,
    completeItemCount: 2,
    partialItemCount: 1,
    missingItemCount: 0,
    staleItemCount: 1,
    notApplicableItemCount: 0,
  })
})

test('score distributions keep unrated mileage separate and use rated mileage as denominator', () => {
  const fixture = createFixture()
  const summary = summarizeReviewTripStatistics(fixture.tripReview, fixture.caches)
  const scenic = summary.scenicScoreDistribution

  assert.equal(findBand(scenic, 'LOW').distanceMeters, 500_000)
  assert.equal(findBand(scenic, 'MEDIUM').distanceMeters, 600_000)
  assert.equal(findBand(scenic, 'TOP').distanceMeters, 500_000)
  assert.equal(findBand(scenic, 'TOP').distanceShare, 500_000 / 1_600_000)
  assert.deepEqual(
    [scenic.unrated.itemCount, scenic.unrated.distanceMeters, scenic.ratedDistanceMeters],
    [1, 100_000, 1_600_000],
  )
  assert.equal(scenic.distanceWeightedAverage, 11_090 / 1_600)
  assert.equal(summary.dataCompleteness.scenicScore.status, 'partial')

  const difficulty = summary.difficultyScoreDistribution
  assert.equal(findBand(difficulty, 'MEDIUM').itemCount, 1)
  assert.equal(findBand(difficulty, 'HIGH').itemCount, 1)
  assert.equal(findBand(difficulty, 'TOP').itemCount, 1)
  assert.equal(difficulty.unrated.itemCount, 1)
})

test('single-trip statistics can inspect a plan without allowing it into historical totals', () => {
  const fixture = createFixture()
  const single = summarizeSingleTripStatistics(fixture.plan, fixture.caches)
  const historical = summarizeReviewTripStatistics(fixture.tripReview, fixture.caches)

  assert.equal(single.tripCount, 1)
  assert.equal(single.tripBreakdown[0].category, 'plan')
  assert.equal(single.plannedDistanceMeters.value, 2_000_000)
  assert.equal(single.numberedRoadDistance.entries.find((entry) => entry.routeRef === 'G65').distanceMeters, 2_000_000)
  assert.equal(historical.plannedDistanceMeters.value, 1_700_000)
  assert.equal(historical.numberedRoadDistance.entries.find((entry) => entry.routeRef === 'G65').distanceMeters, 500_000)
})

test('partial and wholly missing fields remain explicit instead of becoming zero or the lowest band', () => {
  const known = createSegment('known', { distanceMeters: 100_000 })
  const missing = createSegment('missing')
  const trip = createTrip('partial', 'review', 'bad-date', '2026-01-01', [known, missing])
  const summary = summarizeSingleTripStatistics(trip)

  assert.equal(summary.plannedDistanceMeters.value, 100_000)
  assert.equal(summary.plannedDistanceMeters.completeness.status, 'partial')
  assert.equal(summary.actualDistanceMeters.value, null)
  assert.equal(summary.actualDistanceMeters.completeness.status, 'missing')
  assert.equal(summary.tripDays.value, null)
  assert.equal(summary.distributions.plannedMileage.pending.itemCount, 1)
  assert.equal(findBand(summary.distributions.plannedMileage, 'UNDER_500_KM').itemCount, 0)
  assert.equal(summary.roadClassDistance.analyzedDistanceMeters, null)
  assert.equal(summary.scenicScoreDistribution.unrated.itemCount, 2)
})

test('scenic and difficulty score boundaries remain separate, including missing and invalid scores', () => {
  const scores = [1, 4.999, 5, 6.999, 7, 8.999, 9, 10, null, 0]
  const segments = scores.map((score, index) => createSegment(`score-${index}`, {
    distanceMeters: index < 8 ? 10_000 : 1_000,
    scenicScore: score,
    difficultyScore: score,
  }))
  const trip = createTrip('score-boundaries', 'review', '2026-04-01', '2026-04-01', segments)
  const summary = summarizeSingleTripStatistics(trip)

  for (const distribution of [summary.scenicScoreDistribution, summary.difficultyScoreDistribution]) {
    assert.equal(findBand(distribution, 'LOW').itemCount, 2)
    assert.equal(findBand(distribution, 'MEDIUM').itemCount, 2)
    assert.equal(findBand(distribution, 'HIGH').itemCount, 2)
    assert.equal(findBand(distribution, 'TOP').itemCount, 2)
    assert.deepEqual(
      [distribution.unrated.itemCount, distribution.unrated.distanceMeters, distribution.ratedDistanceMeters],
      [2, 2_000, 80_000],
    )
    assert.equal(distribution.distanceWeightedAverage, (1 + 4.999 + 5 + 6.999 + 7 + 8.999 + 9 + 10) / 8)
  }

  assert.equal(summary.scenicScoreDistribution.distanceWeightedAverage, summary.difficultyScoreDistribution.distanceWeightedAverage)
})

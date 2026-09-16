import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MILEAGE_BANDS,
  ROAD_CLASS_COLORS,
  ROAD_CLASS_LABELS,
  SCORE_MAX,
  SCORE_MIN,
} from '../src/config/roadStatistics.ts'
import {
  getDifficultyScoreBand,
  getDrivingTimeBand,
  getMileageBand,
  getScenicScoreBand,
  getTripDaysBand,
  summarizeNumericBandDistribution,
} from '../src/utils/roadStatistics.ts'

const ROAD_CLASSES = [
  'EXPRESSWAY',
  'NATIONAL_ROAD',
  'PROVINCIAL_ROAD',
  'COUNTY_ROAD',
  'TOWNSHIP_ROAD',
  'VILLAGE_ROAD',
  'URBAN_ROAD',
  'OTHER',
  'UNKNOWN',
]

test('every road class has one centralized label and color', () => {
  assert.deepEqual(Object.keys(ROAD_CLASS_LABELS), ROAD_CLASSES)
  assert.deepEqual(Object.keys(ROAD_CLASS_COLORS), ROAD_CLASSES)
  assert.equal(new Set(Object.values(ROAD_CLASS_COLORS)).size, ROAD_CLASSES.length)
  assert.equal(ROAD_CLASS_COLORS.NATIONAL_ROAD, '#2563eb')
  assert.equal(ROAD_CLASS_COLORS.PROVINCIAL_ROAD, '#0d9488')
})

test('mileage bands use inclusive lower and exclusive upper boundaries', () => {
  assert.equal(getMileageBand(499_900)?.key, 'UNDER_500_KM')
  assert.equal(getMileageBand(500_000)?.key, 'KM_500_TO_1000')
  assert.equal(getMileageBand(999_900)?.key, 'KM_500_TO_1000')
  assert.equal(getMileageBand(1_000_000)?.key, 'KM_1000_TO_1500')
  assert.equal(getMileageBand(1_499_900)?.key, 'KM_1000_TO_1500')
  assert.equal(getMileageBand(1_500_000)?.key, 'KM_1500_TO_2000')
  assert.equal(getMileageBand(1_999_900)?.key, 'KM_1500_TO_2000')
  assert.equal(getMileageBand(2_000_000)?.key, 'KM_2000_PLUS')
  assert.equal(getMileageBand(-1), null)
  assert.equal(getMileageBand(Number.NaN), null)
})

test('trip day bands reject non-day values and preserve natural-day boundaries', () => {
  assert.equal(getTripDaysBand(1)?.key, 'DAY_TRIP')
  assert.equal(getTripDaysBand(2)?.key, 'SHORT_TRIP')
  assert.equal(getTripDaysBand(4)?.key, 'MEDIUM_TRIP')
  assert.equal(getTripDaysBand(8)?.key, 'LONG_TRIP')
  assert.equal(getTripDaysBand(0), null)
  assert.equal(getTripDaysBand(1.5), null)
})

test('driving time bands are expressed in seconds', () => {
  assert.equal(getDrivingTimeBand(9.9 * 60 * 60)?.key, 'UNDER_10_HOURS')
  assert.equal(getDrivingTimeBand(10 * 60 * 60)?.key, 'HOURS_10_TO_20')
  assert.equal(getDrivingTimeBand(19.9 * 60 * 60)?.key, 'HOURS_10_TO_20')
  assert.equal(getDrivingTimeBand(20 * 60 * 60)?.key, 'HOURS_20_TO_40')
  assert.equal(getDrivingTimeBand(39.9 * 60 * 60)?.key, 'HOURS_20_TO_40')
  assert.equal(getDrivingTimeBand(40 * 60 * 60)?.key, 'HOURS_40_PLUS')
  assert.equal(getDrivingTimeBand(-1), null)
})

test('score bands cover every requested decimal boundary from 1 to 10', () => {
  assert.equal(SCORE_MIN, 1)
  assert.equal(SCORE_MAX, 10)
  assert.equal(getScenicScoreBand(4.9)?.key, 'LOW')
  assert.equal(getScenicScoreBand(5)?.key, 'MEDIUM')
  assert.equal(getScenicScoreBand(6.9)?.key, 'MEDIUM')
  assert.equal(getScenicScoreBand(7)?.key, 'HIGH')
  assert.equal(getScenicScoreBand(8.9)?.key, 'HIGH')
  assert.equal(getScenicScoreBand(9)?.key, 'TOP')
  assert.equal(getScenicScoreBand(10)?.key, 'TOP')
  assert.equal(getDifficultyScoreBand(4.9)?.label, '难度较低')
  assert.equal(getDifficultyScoreBand(5)?.label, '难度一般')
  assert.equal(getDifficultyScoreBand(7)?.label, '难度较高')
  assert.equal(getDifficultyScoreBand(9)?.label, '难度极高')
  assert.equal(getDifficultyScoreBand(10)?.key, 'TOP')
  assert.equal(getScenicScoreBand(0), null)
  assert.equal(getDifficultyScoreBand(11), null)
})

test('band distributions expose item counts, mileage shares, pending values and missing mileage', () => {
  const distribution = summarizeNumericBandDistribution([
    { value: 499_900, distanceMeters: 499_900 },
    { value: 500_000, distanceMeters: 500_000 },
    { value: 1_000_000, distanceMeters: null },
    { value: null, distanceMeters: null },
  ], MILEAGE_BANDS)

  const under500 = distribution.bands.find((band) => band.key === 'UNDER_500_KM')
  const km500To1000 = distribution.bands.find((band) => band.key === 'KM_500_TO_1000')
  const km1000To1500 = distribution.bands.find((band) => band.key === 'KM_1000_TO_1500')

  assert.deepEqual(
    [under500.itemCount, under500.distanceMeters, under500.distancePendingItemCount],
    [1, 499_900, 0],
  )
  assert.equal(under500.distanceShare, 499_900 / 999_900)
  assert.equal(km500To1000.distanceShare, 500_000 / 999_900)
  assert.deepEqual(
    [km1000To1500.itemCount, km1000To1500.distanceMeters, km1000To1500.distancePendingItemCount],
    [1, null, 1],
  )
  assert.deepEqual(distribution.pending, {
    itemCount: 1,
    distanceMeters: null,
    distanceKnownItemCount: 0,
    distancePendingItemCount: 1,
  })
  assert.equal(distribution.distanceShareDenominatorMeters, 999_900)
  assert.equal(distribution.distancePendingItemCount, 2)
})

import {
  DIFFICULTY_SCORE_BANDS,
  DRIVING_TIME_BANDS,
  MILEAGE_BANDS,
  SCENIC_SCORE_BANDS,
  SCORE_MAX,
  SCORE_MIN,
  TRIP_DAYS_BANDS,
} from '../config/roadStatistics.ts'
import type {
  NumericBandDefinition,
  NumericBandDistribution,
  NumericBandDistributionInput,
} from '../types/roadStatistics.ts'

export function findNumericBand<Band extends NumericBandDefinition<string>>(
  value: number,
  bands: readonly Band[],
): Band | null {
  if (!Number.isFinite(value)) return null
  return bands.find((band) => (
    value >= band.minInclusive
    && (band.maxExclusive === null || value < band.maxExclusive)
  )) ?? null
}

export function getMileageBand(distanceMeters: number | null | undefined) {
  if (typeof distanceMeters !== 'number' || distanceMeters < 0) return null
  return findNumericBand(distanceMeters, MILEAGE_BANDS)
}

export function getTripDaysBand(dayCount: number | null | undefined) {
  if (typeof dayCount !== 'number' || !Number.isInteger(dayCount) || dayCount < 1) return null
  return findNumericBand(dayCount, TRIP_DAYS_BANDS)
}

export function getDrivingTimeBand(durationSeconds: number | null | undefined) {
  if (typeof durationSeconds !== 'number' || durationSeconds < 0) return null
  return findNumericBand(durationSeconds, DRIVING_TIME_BANDS)
}

export function getScenicScoreBand(score: number | null | undefined) {
  if (typeof score !== 'number' || score < SCORE_MIN || score > SCORE_MAX) return null
  return findNumericBand(score, SCENIC_SCORE_BANDS)
}

export function getDifficultyScoreBand(score: number | null | undefined) {
  if (typeof score !== 'number' || score < SCORE_MIN || score > SCORE_MAX) return null
  return findNumericBand(score, DIFFICULTY_SCORE_BANDS)
}

function normalizeDistanceMeters(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 统一生成档位统计。数值未知的项目进入 pending，里程未知则单独计数；
 * 占比只使用“已进入某一档且里程已知”的项目里程作为分母。
 */
export function summarizeNumericBandDistribution<Key extends string>(
  items: readonly NumericBandDistributionInput[],
  bands: readonly NumericBandDefinition<Key>[],
): NumericBandDistribution<Key> {
  const summaries = bands.map((band) => ({
    ...band,
    itemCount: 0,
    distanceMeters: 0 as number | null,
    distanceKnownItemCount: 0,
    distancePendingItemCount: 0,
    distanceShare: null as number | null,
  }))
  const summaryByKey = new Map(summaries.map((summary) => [summary.key, summary]))
  const pending = {
    itemCount: 0,
    distanceMeters: 0 as number | null,
    distanceKnownItemCount: 0,
    distancePendingItemCount: 0,
  }

  let binnedDistanceMeters = 0
  let binnedDistanceKnownItemCount = 0
  let distancePendingItemCount = 0

  for (const item of items) {
    const band = typeof item.value === 'number' && Number.isFinite(item.value)
      ? findNumericBand(item.value, bands)
      : null
    const distanceMeters = normalizeDistanceMeters(item.distanceMeters)
    const target = band ? summaryByKey.get(band.key) : pending
    if (!target) continue

    target.itemCount += 1
    if (distanceMeters === null) {
      target.distancePendingItemCount += 1
      distancePendingItemCount += 1
    } else {
      target.distanceMeters = (target.distanceMeters ?? 0) + distanceMeters
      target.distanceKnownItemCount += 1
      if (band) {
        binnedDistanceMeters += distanceMeters
        binnedDistanceKnownItemCount += 1
      }
    }
  }

  for (const summary of summaries) {
    if (summary.itemCount > 0 && summary.distanceKnownItemCount === 0) summary.distanceMeters = null
  }
  if (pending.itemCount > 0 && pending.distanceKnownItemCount === 0) pending.distanceMeters = null

  const denominator = binnedDistanceKnownItemCount > 0 ? binnedDistanceMeters : null
  if (denominator !== null && denominator > 0) {
    for (const summary of summaries) {
      summary.distanceShare = (summary.distanceMeters ?? 0) / denominator
    }
  }

  return {
    bands: summaries,
    pending,
    distanceShareDenominatorMeters: denominator,
    distancePendingItemCount,
  }
}

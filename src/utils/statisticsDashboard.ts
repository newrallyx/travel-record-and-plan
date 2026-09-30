import type { Trip } from '../types/trip.ts'
import type { TripStatisticsBreakdown } from '../types/tripStatistics.ts'
import { parseIsoDateUtc } from './tripStatistics.ts'

export type StatisticsScope = 'all' | 'year' | 'trip'

export interface StatisticsDashboardFilter {
  scope: StatisticsScope
  year: string
  tripId: string
}

export type TripStatisticsSortKey =
  | 'startDate'
  | 'plannedDistance'
  | 'actualDistance'
  | 'tripDays'
  | 'estimatedDrivingTime'
  | 'actualDrivingTime'
  | 'completeness'

export interface TripStatisticsSort {
  key: TripStatisticsSortKey
  direction: 'asc' | 'desc'
}

export const DEFAULT_STATISTICS_FILTER: StatisticsDashboardFilter = {
  scope: 'all',
  year: '',
  tripId: '',
}

export const DEFAULT_TRIP_STATISTICS_SORT: TripStatisticsSort = {
  key: 'startDate',
  direction: 'asc',
}

/** 统计页只将已进入复盘的旅程作为历史记录，规划中的旅程不混入总览。 */
export function getReviewTrips(trips: readonly Trip[]): Trip[] {
  return trips.filter((trip) => trip.category === 'review')
}

/** 旅程筛选项按开始日期升序排列，缺失或无效日期放在末尾。 */
export function getStatisticsTripOptions(trips: readonly Trip[]): Trip[] {
  return getReviewTrips(trips).sort((left, right) => {
    const leftDate = parseIsoDateUtc(left.startDate)
    const rightDate = parseIsoDateUtc(right.startDate)
    if (leftDate === null && rightDate !== null) return 1
    if (rightDate === null && leftDate !== null) return -1
    return (leftDate !== null && rightDate !== null ? leftDate - rightDate : 0)
      || left.title.localeCompare(right.title, 'zh-CN')
  })
}

/** 使用旅程起始日期归档年份；日期缺失或不合法的旅程不会伪造一个年份。 */
export function getStatisticsYears(trips: readonly Trip[]): string[] {
  return Array.from(new Set(
    getReviewTrips(trips)
      .map((trip) => (/^\d{4}-\d{2}-\d{2}$/.test(trip.startDate) ? trip.startDate.slice(0, 4) : ''))
      .filter(Boolean),
  )).sort((left, right) => right.localeCompare(left))
}

export function filterStatisticsTrips(
  trips: readonly Trip[],
  filter: StatisticsDashboardFilter,
): Trip[] {
  const reviewTrips = getReviewTrips(trips)
  if (filter.scope === 'year') {
    return filter.year
      ? reviewTrips.filter((trip) => trip.startDate.startsWith(`${filter.year}-`))
      : reviewTrips
  }
  if (filter.scope === 'trip') {
    return filter.tripId ? reviewTrips.filter((trip) => trip.id === filter.tripId) : []
  }
  return reviewTrips
}

function getNumericSortValue(row: TripStatisticsBreakdown, key: TripStatisticsSortKey): number | null {
  switch (key) {
    case 'startDate': return parseIsoDateUtc(row.startDate)
    case 'plannedDistance': return row.plannedDistanceMeters.value
    case 'actualDistance': return row.actualDistanceMeters.value
    case 'tripDays': return row.tripDays.value
    case 'estimatedDrivingTime': return row.estimatedDrivingTimeSeconds.value
    case 'actualDrivingTime': return row.actualDrivingTimeSeconds.value
    default: return null
  }
}

function isNumericSortKey(key: TripStatisticsSortKey): boolean {
  return key === 'startDate'
    || key === 'plannedDistance'
    || key === 'actualDistance'
    || key === 'tripDays'
    || key === 'estimatedDrivingTime'
    || key === 'actualDrivingTime'
}

function getCompletenessRank(row: TripStatisticsBreakdown): number {
  switch (row.dataCompleteness.overallStatus) {
    case 'complete': return 0
    case 'partial': return 1
    case 'missing': return 2
  }
}

function compareTripStatisticsRows(
  left: TripStatisticsBreakdown,
  right: TripStatisticsBreakdown,
  key: TripStatisticsSortKey,
): number {
  switch (key) {
    case 'startDate':
    case 'plannedDistance':
    case 'actualDistance':
    case 'tripDays':
    case 'estimatedDrivingTime':
    case 'actualDrivingTime': {
      const leftValue = getNumericSortValue(left, key)
      const rightValue = getNumericSortValue(right, key)
      if (leftValue === null && rightValue === null) return 0
      if (leftValue === null) return 1
      if (rightValue === null) return -1
      return leftValue - rightValue
    }
    case 'completeness':
      return getCompletenessRank(left) - getCompletenessRank(right)
  }
}

/**
 * 空值始终排在有值之后，避免“待补全”在升序里被误读为最小值。
 * 同值按旅程名称稳定排序，保证切换排序时表格可预期。
 */
export function sortTripStatisticsRows(
  rows: readonly TripStatisticsBreakdown[],
  sort: TripStatisticsSort,
): TripStatisticsBreakdown[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    const comparison = compareTripStatisticsRows(left, right, sort.key)
    if (comparison !== 0) {
      const leftValue = getNumericSortValue(left, sort.key)
      const rightValue = getNumericSortValue(right, sort.key)
      const hasMissingNumericValue = isNumericSortKey(sort.key) && (leftValue === null || rightValue === null)
      return hasMissingNumericValue ? comparison : comparison * direction
    }
    return left.title.localeCompare(right.title, 'zh-CN')
  })
}

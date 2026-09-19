import type { Trip } from '../types/trip.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import type {
  NamedRoadComparisonRow,
  RoadCompositionRow,
  RoadDistanceComparison,
  RoadStatisticsComparison,
  TripStatisticsSummary,
} from '../types/tripStatistics.ts'
import { normalizeRoadText } from './roadClassifier.ts'
import { summarizeReviewTripStatistics, summarizeTripSetStatistics } from './tripStatistics.ts'

const COMPOSITION_GROUPS = [
  { roadClass: 'EXPRESSWAY', label: '高速', classes: ['EXPRESSWAY'] },
  { roadClass: 'NATIONAL_ROAD', label: '国道', classes: ['NATIONAL_ROAD'] },
  { roadClass: 'PROVINCIAL_ROAD', label: '省道', classes: ['PROVINCIAL_ROAD'] },
  { roadClass: 'OTHER', label: '其他道路', classes: ['COUNTY_ROAD', 'TOWNSHIP_ROAD', 'VILLAGE_ROAD', 'URBAN_ROAD', 'OTHER'] },
] as const

function knownRoadDistance(summary: TripStatisticsSummary, value: number): number | null {
  const completeness = summary.dataCompleteness.roadAnalysis
  if (summary.roadClassDistance.analyzedDistanceMeters !== null) return value
  // 没有旅程或全部为非驾车路段时确实没有道路里程；未读取到分析时不能伪装成 0。
  return completeness.totalItemCount === completeness.notApplicableItemCount ? 0 : null
}

function totalDistanceShare(value: number | null, summary: TripStatisticsSummary): number | null {
  const total = summary.plannedDistanceMeters
  return value !== null && total.completeness.status === 'complete' && total.value !== null && total.value > 0
    ? value / total.value
    : null
}

function compareDistances(
  currentDistanceMeters: number | null,
  historicalDistanceMeters: number | null,
  current: TripStatisticsSummary,
  historical: TripStatisticsSummary,
): RoadDistanceComparison {
  return {
    currentDistanceMeters,
    historicalDistanceMeters,
    currentDistanceShare: totalDistanceShare(currentDistanceMeters, current),
    historicalDistanceShare: totalDistanceShare(historicalDistanceMeters, historical),
  }
}

function namedRoadEntries(summary: TripStatisticsSummary) {
  const numbered = summary.numberedRoadDistance
  const provinceSensitive = (roadClass: NamedRoadComparisonRow['roadClass'], routeRef: string | null) => (
    roadClass === 'PROVINCIAL_ROAD' || (roadClass === 'EXPRESSWAY' && routeRef?.startsWith('S'))
  )
  const makeKey = (
    roadClass: NamedRoadComparisonRow['roadClass'],
    routeRef: string | null,
    provinceCode?: string,
    provinceStatus?: NamedRoadComparisonRow['provinceStatus'],
  ) => {
    if (!provinceSensitive(roadClass, routeRef)) return `${roadClass}:${routeRef ?? 'UNNUMBERED'}`
    return `${roadClass}:${provinceCode ?? (provinceStatus === 'pending' ? 'PENDING' : 'UNKNOWN')}:${routeRef ?? 'UNNUMBERED'}`
  }
  return [
    ...numbered.entries.map((entry) => ({
      ...entry,
      key: makeKey(entry.roadClass, entry.routeRef, entry.provinceCode, entry.provinceStatus),
    })),
    { ...numbered.unnumberedExpressway, key: 'EXPRESSWAY:UNNUMBERED', roadClass: 'EXPRESSWAY' as const, routeRef: null },
    { ...numbered.unnumberedNationalRoad, key: 'NATIONAL_ROAD:UNNUMBERED', roadClass: 'NATIONAL_ROAD' as const, routeRef: null },
    ...numbered.unnumberedProvincialRoads.map((entry) => ({
      ...entry,
      key: makeKey('PROVINCIAL_ROAD', null, entry.provinceCode, entry.provinceStatus),
      roadClass: 'PROVINCIAL_ROAD' as const,
      routeRef: null,
    })),
  ].filter((entry) => entry.roadPartCount > 0)
}

/** 两个页面共用的纯聚合入口：本次随选择变化，历史始终取全部 review，重复经过按实际次数累计。 */
export function summarizeRoadStatisticsComparison(
  currentTrips: readonly Trip[],
  allTrips: readonly Trip[],
  routeCaches: readonly RouteCacheRecord[] = [],
): RoadStatisticsComparison {
  const current = summarizeTripSetStatistics(currentTrips, routeCaches)
  const historical = summarizeReviewTripStatistics({ trips: [...allTrips] }, routeCaches)
  const composition: RoadCompositionRow[] = COMPOSITION_GROUPS.map((group) => {
    const distance = (summary: TripStatisticsSummary) => knownRoadDistance(summary,
      summary.roadClassDistance.entries.reduce((sum, entry) => (
        (group.classes as readonly string[]).includes(entry.roadClass) ? sum + entry.distanceMeters : sum
      ), 0))
    return { roadClass: group.roadClass, label: group.label, ...compareDistances(distance(current), distance(historical), current, historical) }
  })
  const unclassifiedDistance = (summary: TripStatisticsSummary, scope: 'currentDistanceMeters' | 'historicalDistanceMeters') => {
    const total = summary.plannedDistanceMeters.value
    return total === null ? null : Math.max(0, total - composition.reduce((sum, row) => sum + (row[scope] ?? 0), 0))
  }
  const currentEntries = new Map(namedRoadEntries(current).map((entry) => [entry.key, entry]))
  const historicalEntries = new Map(namedRoadEntries(historical).map((entry) => [entry.key, entry]))
  const keys = new Set([...currentEntries.keys(), ...historicalEntries.keys()])
  const namedRoads: NamedRoadComparisonRow[] = [...keys].map((key) => {
    const now = currentEntries.get(key)
    const past = historicalEntries.get(key)
    const entry = now ?? past!
    const currentDistance = knownRoadDistance(current, now?.distanceMeters ?? 0)
    const historicalDistance = knownRoadDistance(historical, past?.distanceMeters ?? 0)
    return {
      key,
      routeRef: entry.routeRef,
      roadClass: entry.roadClass,
      ...(entry.provinceCode ? { provinceCode: entry.provinceCode } : {}),
      ...(entry.provinceName ? { provinceName: entry.provinceName } : {}),
      ...(entry.provinceStatus ? { provinceStatus: entry.provinceStatus } : {}),
      ...('routeRefs' in entry && entry.routeRefs ? { routeRefs: entry.routeRefs } : {}),
      roadNames: [...new Set([...(now?.roadNames ?? []), ...(past?.roadNames ?? [])])].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      currentRoadPartCount: now?.roadPartCount ?? 0,
      historicalTripCount: historicalDistance === null ? null : past?.tripCount ?? 0,
      ...compareDistances(currentDistance, historicalDistance, current, historical),
    }
  })
  return {
    current,
    historical,
    composition,
    namedRoads,
    unclassified: compareDistances(unclassifiedDistance(current, 'currentDistanceMeters'), unclassifiedDistance(historical, 'historicalDistanceMeters'), current, historical),
  }
}

/** 搜索和排序只改变显示行，不改变累计或占比的统计范围。 */
export function selectNamedRoadRows(
  rows: readonly NamedRoadComparisonRow[],
  {
    query = '',
    direction = 'desc',
    currentOnly = false,
    roadClass = 'ALL',
    province = 'ALL',
  }: {
    query?: string
    direction?: 'asc' | 'desc'
    currentOnly?: boolean
    roadClass?: NamedRoadComparisonRow['roadClass'] | 'ALL'
    province?: string
  } = {},
): NamedRoadComparisonRow[] {
  const normalizedQuery = normalizeRoadText(query).replace(/[\s-]+/g, '')
  return rows.filter((row) => (!currentOnly || row.currentRoadPartCount > 0)
    && (roadClass === 'ALL' || row.roadClass === roadClass)
    && (province === 'ALL' || (row.provinceCode ?? row.provinceStatus) === province)
    && (!normalizedQuery || [row.routeRef ?? '', ...(row.routeRefs ?? []), row.provinceName ?? '', ...(row.roadNames ?? [])]
      .some((value) => normalizeRoadText(value).replace(/[\s-]+/g, '').includes(normalizedQuery))))
    .sort((left, right) => {
      const a = left.currentDistanceMeters
      const b = right.currentDistanceMeters
      if (a === null && b !== null) return 1
      if (a !== null && b === null) return -1
      if (a !== null && b !== null && a !== b) return (a - b) * (direction === 'asc' ? 1 : -1)
      return left.key.localeCompare(right.key, 'zh-CN', { numeric: true })
    })
}

/** 路书的分档沿用统一引擎，部分记录不以小计进入完整旅程档位。 */
export function getSingleTripClassificationRows(summary: TripStatisticsSummary) {
  return [
    { label: '规划里程', kind: 'distance' as const, metric: summary.plannedDistanceMeters, distribution: summary.distributions.plannedMileage },
    { label: '实际里程', kind: 'distance' as const, metric: summary.actualDistanceMeters, distribution: summary.distributions.actualMileage },
    { label: '旅行天数', kind: 'days' as const, metric: summary.tripDays, distribution: summary.distributions.tripDays },
    { label: '预计驾驶', kind: 'duration' as const, metric: summary.estimatedDrivingTimeSeconds, distribution: summary.distributions.estimatedDrivingTime },
    { label: '实际驾驶', kind: 'duration' as const, metric: summary.actualDrivingTimeSeconds, distribution: summary.distributions.actualDrivingTime },
  ].map(({ distribution, ...row }) => ({
    ...row,
    bandLabel: distribution.bands.find((band) => band.itemCount > 0)?.label ?? '待补全后分类',
  }))
}

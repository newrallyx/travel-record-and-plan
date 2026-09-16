import {
  DIFFICULTY_SCORE_BANDS,
  DRIVING_TIME_BANDS,
  MILEAGE_BANDS,
  ROAD_CLASS_LABELS,
  SCENIC_SCORE_BANDS,
  SCORE_MAX,
  SCORE_MIN,
  TRIP_DAYS_BANDS,
} from '../config/roadStatistics.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import type {
  DifficultyScoreBandKey,
  NumericBandDefinition,
  RoadClass,
  RoadProvinceStatus,
  RouteRoadPart,
  ScenicScoreBandKey,
} from '../types/roadStatistics.ts'
import type { RouteSegment, Trip, TripReview } from '../types/trip.ts'
import type {
  NumberedRoadDistanceEntry,
  NumberedRoadDistanceStatistics,
  NumericStatisticsTotal,
  RoadClassDistanceStatistics,
  ScoreDistribution,
  StatisticsCompleteness,
  StatisticsCompletenessStatus,
  TripStatisticsBreakdown,
  TripStatisticsDataCompleteness,
  TripStatisticsSummary,
  UnnumberedRoadDistanceEntry,
} from '../types/tripStatistics.ts'
import { getSegmentDrivingDurationSeconds } from './durations.ts'
import { getRoadAnalysisFreshness, isRoadAnalysisApplicableRouteType } from './routeBuildKey.ts'
import { summarizeNumericBandDistribution } from './roadStatistics.ts'
import { extractRouteRef } from './roadClassifier.ts'
import { isProvinceSensitiveRoadPart, provinceNameFromCode } from './province.ts'

const ROAD_CLASSES = Object.keys(ROAD_CLASS_LABELS) as RoadClass[]
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

type ScoreField = 'scenicScore' | 'difficultyScore'

interface SegmentReference {
  tripId: string
  segment: RouteSegment
}

interface CurrentRoadSegmentReference extends SegmentReference {
  roadParts: readonly RouteRoadPart[]
}

interface RoadAnalysisSelection {
  currentSegments: CurrentRoadSegmentReference[]
  completeness: StatisticsCompleteness
}

interface DistanceAccumulator {
  roadNames: Set<string>
  distanceMeters: number
  roadPartCount: number
  tripIds: Set<string>
  segmentKeys: Set<string>
  provinceCode?: string
  provinceName?: string
  provinceStatus?: RoadProvinceStatus
  routeRefs: Set<string>
}

interface NumberedDistanceAccumulator extends DistanceAccumulator {
  routeRef: string
  roadClass: Extract<RoadClass, 'EXPRESSWAY' | 'NATIONAL_ROAD' | 'PROVINCIAL_ROAD'>
  roadNames: Set<string>
}

function normalizeNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function createCompleteness(
  totalItemCount: number,
  completeItemCount: number,
  options: {
    partialItemCount?: number
    staleItemCount?: number
    notApplicableItemCount?: number
  } = {},
): StatisticsCompleteness {
  const partialItemCount = options.partialItemCount ?? 0
  const staleItemCount = options.staleItemCount ?? 0
  const notApplicableItemCount = options.notApplicableItemCount ?? 0
  const missingItemCount = Math.max(
    0,
    totalItemCount
      - completeItemCount
      - partialItemCount
      - staleItemCount
      - notApplicableItemCount,
  )
  const applicableItemCount = totalItemCount - notApplicableItemCount

  let status: StatisticsCompletenessStatus
  if (totalItemCount === 0) {
    status = 'missing'
  } else if (applicableItemCount === 0) {
    status = 'complete'
  } else if (
    completeItemCount === applicableItemCount
    && partialItemCount === 0
    && staleItemCount === 0
    && missingItemCount === 0
  ) {
    status = 'complete'
  } else if (completeItemCount === 0 && partialItemCount === 0) {
    status = 'missing'
  } else {
    status = 'partial'
  }

  return {
    status,
    totalItemCount,
    completeItemCount,
    partialItemCount,
    missingItemCount,
    staleItemCount,
    notApplicableItemCount,
  }
}

function mergeCompleteness(values: readonly StatisticsCompleteness[]): StatisticsCompleteness {
  return createCompleteness(
    values.reduce((sum, value) => sum + value.totalItemCount, 0),
    values.reduce((sum, value) => sum + value.completeItemCount, 0),
    {
      partialItemCount: values.reduce((sum, value) => sum + value.partialItemCount, 0),
      staleItemCount: values.reduce((sum, value) => sum + value.staleItemCount, 0),
      notApplicableItemCount: values.reduce((sum, value) => sum + value.notApplicableItemCount, 0),
    },
  )
}

function summarizeNumericValues(values: readonly (number | null)[]): NumericStatisticsTotal {
  const known = values.filter((value): value is number => value !== null)
  return {
    value: known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null,
    completeness: createCompleteness(values.length, known.length),
  }
}

function summarizeDrivingMetric(
  segments: readonly RouteSegment[],
  readValue: (segment: RouteSegment) => number | null,
): NumericStatisticsTotal {
  const drivingSegments = segments.filter((segment) => (segment.routeType ?? 'DRIVING') === 'DRIVING')
  const known = drivingSegments.map(readValue).filter((value): value is number => value !== null)
  return {
    value: known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null,
    completeness: createCompleteness(segments.length, known.length, {
      notApplicableItemCount: segments.length - drivingSegments.length,
    }),
  }
}

function mergeNumericTotals(values: readonly NumericStatisticsTotal[]): NumericStatisticsTotal {
  const knownValues = values
    .map((value) => value.value)
    .filter((value): value is number => value !== null)
  return {
    value: knownValues.length > 0 ? knownValues.reduce((sum, value) => sum + value, 0) : null,
    completeness: mergeCompleteness(values.map((value) => value.completeness)),
  }
}

export function parseIsoDateUtc(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }
  return timestamp
}

/** 按旅程起止日期的自然日计算，包含首尾两天。 */
export function getNaturalTripDayCount(trip: Pick<Trip, 'startDate' | 'endDate'>): number | null {
  const start = parseIsoDateUtc(trip.startDate)
  const end = parseIsoDateUtc(trip.endDate)
  if (start === null || end === null || end < start) return null
  return Math.floor((end - start) / MILLISECONDS_PER_DAY) + 1
}

function listSegments(trips: readonly Trip[]): SegmentReference[] {
  return trips.flatMap((trip) => trip.days.flatMap((day) => (
    day.routeSegments.map((segment) => ({ tripId: trip.id, segment }))
  )))
}

function buildRouteCacheMap(routeCaches: readonly RouteCacheRecord[]): Map<string, RouteCacheRecord> {
  return new Map(routeCaches.map((record) => [record.segmentId, record]))
}

function selectCurrentRoadAnalysis(
  segments: readonly SegmentReference[],
  routeCacheMap: ReadonlyMap<string, RouteCacheRecord>,
): RoadAnalysisSelection {
  const currentSegments: CurrentRoadSegmentReference[] = []
  let completeItemCount = 0
  let partialItemCount = 0
  let staleItemCount = 0
  let notApplicableItemCount = 0

  for (const reference of segments) {
    if (!isRoadAnalysisApplicableRouteType(reference.segment.routeType)) {
      notApplicableItemCount += 1
      continue
    }

    const cache = routeCacheMap.get(reference.segment.id)
    if (!cache) continue
    const freshness = getRoadAnalysisFreshness(reference.segment, cache)
    if (freshness === 'stale') {
      staleItemCount += 1
      continue
    }
    if (freshness !== 'current' || !cache.roadParts || !cache.roadAnalysis) continue

    currentSegments.push({ ...reference, roadParts: cache.roadParts })
    if (cache.roadAnalysis.status === 'complete') completeItemCount += 1
    else partialItemCount += 1
  }

  return {
    currentSegments,
    completeness: createCompleteness(segments.length, completeItemCount, {
      partialItemCount,
      staleItemCount,
      notApplicableItemCount,
    }),
  }
}

function getValidScore(segment: RouteSegment, field: ScoreField): number | null {
  const value = segment[field]
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= SCORE_MIN
    && value <= SCORE_MAX
    ? value
    : null
}

function summarizeScoreCompleteness(
  segments: readonly SegmentReference[],
  field: ScoreField,
): StatisticsCompleteness {
  const knownCount = segments.reduce((count, { segment }) => (
    count + (getValidScore(segment, field) === null ? 0 : 1)
  ), 0)
  return createCompleteness(segments.length, knownCount)
}

function summarizeScoreDistribution<Key extends ScenicScoreBandKey | DifficultyScoreBandKey>(
  segments: readonly SegmentReference[],
  field: ScoreField,
  bands: readonly NumericBandDefinition<Key>[],
): ScoreDistribution<Key> {
  const inputs = segments.map(({ segment }) => ({
    value: getValidScore(segment, field),
    distanceMeters: normalizeNonNegativeNumber(segment.distanceMeters),
  }))
  const distribution = summarizeNumericBandDistribution(inputs, bands)

  let weightedDistanceMeters = 0
  let weightedScoreDistance = 0
  for (const { segment } of segments) {
    const score = getValidScore(segment, field)
    const distanceMeters = normalizeNonNegativeNumber(segment.distanceMeters)
    if (score === null || distanceMeters === null) continue
    weightedDistanceMeters += distanceMeters
    weightedScoreDistance += score * distanceMeters
  }

  return {
    bands: distribution.bands,
    unrated: distribution.pending,
    ratedDistanceMeters: distribution.distanceShareDenominatorMeters,
    ratedSegmentCount: distribution.bands.reduce((sum, band) => sum + band.itemCount, 0),
    distancePendingSegmentCount: distribution.distancePendingItemCount,
    distanceWeightedAverage: weightedDistanceMeters > 0
      ? weightedScoreDistance / weightedDistanceMeters
      : null,
  }
}

function createDistanceAccumulator(): DistanceAccumulator {
  return {
    roadNames: new Set<string>(),
    distanceMeters: 0,
    roadPartCount: 0,
    tripIds: new Set<string>(),
    segmentKeys: new Set<string>(),
    routeRefs: new Set<string>(),
  }
}

function addRoadPartToAccumulator(
  accumulator: DistanceAccumulator,
  reference: CurrentRoadSegmentReference,
  distanceMeters: number,
  roadName?: string,
): void {
  accumulator.distanceMeters += distanceMeters
  accumulator.roadPartCount += 1
  accumulator.tripIds.add(reference.tripId)
  accumulator.segmentKeys.add(`${reference.tripId}:${reference.segment.id}`)
  if (roadName?.trim()) accumulator.roadNames.add(roadName.trim())
}

function toUnnumberedEntry(
  accumulator: DistanceAccumulator,
  denominator: number | null,
): UnnumberedRoadDistanceEntry {
  return {
    ...(accumulator.provinceCode ? { provinceCode: accumulator.provinceCode } : {}),
    ...(accumulator.provinceName ? { provinceName: accumulator.provinceName } : {}),
    ...(accumulator.provinceStatus ? { provinceStatus: accumulator.provinceStatus } : {}),
    ...(accumulator.routeRefs.size ? { routeRefs: [...accumulator.routeRefs].sort() } : {}),
    roadNames: Array.from(accumulator.roadNames).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    distanceMeters: accumulator.distanceMeters,
    distanceShare: denominator !== null && denominator > 0
      ? accumulator.distanceMeters / denominator
      : null,
    tripCount: accumulator.tripIds.size,
    segmentCount: accumulator.segmentKeys.size,
    roadPartCount: accumulator.roadPartCount,
  }
}

function addProvinceIdentity(accumulator: DistanceAccumulator, part: RouteRoadPart): void {
  if (!isProvinceSensitiveRoadPart(part)) return
  if (part.provinceCode) {
    accumulator.provinceCode = part.provinceCode
    accumulator.provinceName = part.provinceName ?? provinceNameFromCode(part.provinceCode)
    accumulator.provinceStatus = 'confirmed'
    return
  }
  accumulator.provinceStatus = 'pending'
}

function provinceAggregationKey(part: RouteRoadPart): string {
  if (part.provinceCode) return `KNOWN:${part.provinceCode}`
  const candidates = [...new Set(part.provinceCandidates ?? [])].sort()
  return candidates.length ? `PENDING:${candidates.join(',')}` : 'PENDING'
}

function summarizeRoadDistances(
  selection: RoadAnalysisSelection,
): {
  roadClassDistance: RoadClassDistanceStatistics
  numberedRoadDistance: NumberedRoadDistanceStatistics
} {
  const classAccumulators = new Map<RoadClass, DistanceAccumulator>(
    ROAD_CLASSES.map((roadClass) => [roadClass, createDistanceAccumulator()]),
  )
  const numberedAccumulators = new Map<string, NumberedDistanceAccumulator>()
  const unnumberedExpressway = createDistanceAccumulator()
  const unnumberedNationalRoad = createDistanceAccumulator()
  const unnumberedProvincialRoads = new Map<string, DistanceAccumulator>()
  let analyzedDistanceMeters = 0
  let numberedShareDenominatorMeters = 0

  for (const reference of selection.currentSegments) {
    for (const part of reference.roadParts) {
      const distanceMeters = normalizeNonNegativeNumber(part.distanceMeters)
      const classAccumulator = classAccumulators.get(part.roadClass)
      if (distanceMeters === null || !classAccumulator) continue

      analyzedDistanceMeters += distanceMeters
      addRoadPartToAccumulator(classAccumulator, reference, distanceMeters)

      if (part.roadClass !== 'EXPRESSWAY' && part.roadClass !== 'NATIONAL_ROAD' && part.roadClass !== 'PROVINCIAL_ROAD') continue
      numberedShareDenominatorMeters += distanceMeters

      const routeRef = extractRouteRef(part.routeRef)
      if (!routeRef) {
        if (part.roadClass === 'PROVINCIAL_ROAD') {
          const key = provinceAggregationKey(part)
          const accumulator = unnumberedProvincialRoads.get(key) ?? createDistanceAccumulator()
          addRoadPartToAccumulator(accumulator, reference, distanceMeters, part.roadName)
          addProvinceIdentity(accumulator, part)
          unnumberedProvincialRoads.set(key, accumulator)
        } else {
          addRoadPartToAccumulator(
            part.roadClass === 'EXPRESSWAY' ? unnumberedExpressway : unnumberedNationalRoad,
            reference,
            distanceMeters,
            part.roadName,
          )
        }
        continue
      }

      const provinceSensitive = isProvinceSensitiveRoadPart({ ...part, routeRef })
      const key = provinceSensitive
        ? `${part.roadClass}:${provinceAggregationKey(part)}:${routeRef}`
        : `${part.roadClass}:${routeRef}`
      let accumulator = numberedAccumulators.get(key)
      if (!accumulator) {
        accumulator = {
          ...createDistanceAccumulator(),
          routeRef,
          roadClass: part.roadClass,
          roadNames: new Set<string>(),
        }
        numberedAccumulators.set(key, accumulator)
      }
      addRoadPartToAccumulator(accumulator, reference, distanceMeters)
      accumulator.routeRefs.add(routeRef)
      addProvinceIdentity(accumulator, part)
      if (part.roadName?.trim()) accumulator.roadNames.add(part.roadName.trim())
    }
  }

  const hasCurrentAnalysis = selection.currentSegments.length > 0
  const roadDenominator = hasCurrentAnalysis ? analyzedDistanceMeters : null
  const numberedDenominator = hasCurrentAnalysis ? numberedShareDenominatorMeters : null

  const roadClassDistance: RoadClassDistanceStatistics = {
    entries: ROAD_CLASSES.map((roadClass) => {
      const accumulator = classAccumulators.get(roadClass) ?? createDistanceAccumulator()
      return {
        roadClass,
        distanceMeters: accumulator.distanceMeters,
        distanceShare: roadDenominator !== null && roadDenominator > 0
          ? accumulator.distanceMeters / roadDenominator
          : null,
        tripCount: accumulator.tripIds.size,
        segmentCount: accumulator.segmentKeys.size,
        roadPartCount: accumulator.roadPartCount,
      }
    }),
    analyzedDistanceMeters: roadDenominator,
  }

  const numberedEntries: NumberedRoadDistanceEntry[] = Array.from(numberedAccumulators.values())
    .map((accumulator) => ({
      routeRef: accumulator.routeRef,
      roadClass: accumulator.roadClass,
      ...(accumulator.provinceCode ? { provinceCode: accumulator.provinceCode } : {}),
      ...(accumulator.provinceName ? { provinceName: accumulator.provinceName } : {}),
      ...(accumulator.provinceStatus ? { provinceStatus: accumulator.provinceStatus } : {}),
      roadNames: Array.from(accumulator.roadNames).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      distanceMeters: accumulator.distanceMeters,
      distanceShare: numberedDenominator !== null && numberedDenominator > 0
        ? accumulator.distanceMeters / numberedDenominator
        : null,
      tripCount: accumulator.tripIds.size,
      segmentCount: accumulator.segmentKeys.size,
      roadPartCount: accumulator.roadPartCount,
    }))
    .sort((left, right) => (
      right.distanceMeters - left.distanceMeters || left.routeRef.localeCompare(right.routeRef)
    ))

  return {
    roadClassDistance,
    numberedRoadDistance: {
      entries: numberedEntries,
      unnumberedExpressway: toUnnumberedEntry(unnumberedExpressway, numberedDenominator),
      unnumberedNationalRoad: toUnnumberedEntry(unnumberedNationalRoad, numberedDenominator),
      unnumberedProvincialRoads: Array.from(unnumberedProvincialRoads.values())
        .map((accumulator) => toUnnumberedEntry(accumulator, numberedDenominator))
        .sort((left, right) => right.distanceMeters - left.distanceMeters),
      distanceShareDenominatorMeters: numberedDenominator,
    },
  }
}

function summarizeOverallStatus(
  completeness: Omit<TripStatisticsDataCompleteness, 'overallStatus'>,
): StatisticsCompletenessStatus {
  const statuses = Object.values(completeness).map((value) => value.status)
  if (statuses.every((status) => status === 'complete')) return 'complete'
  if (statuses.every((status) => status === 'missing')) return 'missing'
  return 'partial'
}

function buildDataCompleteness(
  values: Omit<TripStatisticsDataCompleteness, 'overallStatus'>,
): TripStatisticsDataCompleteness {
  return { overallStatus: summarizeOverallStatus(values), ...values }
}

function buildTripBreakdown(
  trip: Trip,
  routeCacheMap: ReadonlyMap<string, RouteCacheRecord>,
): TripStatisticsBreakdown {
  const segmentReferences = listSegments([trip])
  const segments = segmentReferences.map(({ segment }) => segment)
  const plannedDistanceMeters = summarizeNumericValues(
    segments.map((segment) => normalizeNonNegativeNumber(segment.distanceMeters)),
  )
  const estimatedDrivingTimeSeconds = summarizeDrivingMetric(
    segments,
    getSegmentDrivingDurationSeconds,
  )
  const actualDistanceMeters = summarizeNumericValues(
    segments.map((segment) => normalizeNonNegativeNumber(segment.reviewFacts?.actual?.distanceMeters)),
  )
  const actualDrivingTimeSeconds = summarizeDrivingMetric(
    segments,
    (segment) => normalizeNonNegativeNumber(segment.reviewFacts?.actual?.durationSeconds),
  )
  const tripDays = summarizeNumericValues([getNaturalTripDayCount(trip)])
  const roadSelection = selectCurrentRoadAnalysis(segmentReferences, routeCacheMap)

  const dataCompleteness = buildDataCompleteness({
    plannedDistance: plannedDistanceMeters.completeness,
    estimatedDrivingTime: estimatedDrivingTimeSeconds.completeness,
    actualDistance: actualDistanceMeters.completeness,
    actualDrivingTime: actualDrivingTimeSeconds.completeness,
    tripDays: tripDays.completeness,
    roadAnalysis: roadSelection.completeness,
    scenicScore: summarizeScoreCompleteness(segmentReferences, 'scenicScore'),
    difficultyScore: summarizeScoreCompleteness(segmentReferences, 'difficultyScore'),
  })

  return {
    tripId: trip.id,
    title: trip.title,
    startDate: trip.startDate,
    category: trip.category,
    segmentCount: segments.length,
    plannedDistanceMeters,
    estimatedDrivingTimeSeconds,
    actualDistanceMeters,
    actualDrivingTimeSeconds,
    tripDays,
    dataCompleteness,
  }
}

function completeMetricValue(metric: NumericStatisticsTotal): number | null {
  return metric.completeness.status === 'complete' ? metric.value : null
}

function mergeDataCompleteness(
  trips: readonly TripStatisticsBreakdown[],
): TripStatisticsDataCompleteness {
  return buildDataCompleteness({
    plannedDistance: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.plannedDistance)),
    estimatedDrivingTime: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.estimatedDrivingTime)),
    actualDistance: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.actualDistance)),
    actualDrivingTime: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.actualDrivingTime)),
    tripDays: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.tripDays)),
    roadAnalysis: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.roadAnalysis)),
    scenicScore: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.scenicScore)),
    difficultyScore: mergeCompleteness(trips.map((trip) => trip.dataCompleteness.difficultyScore)),
  })
}

/** 统一入口：单次旅程和任意旅程集合都通过同一套纯聚合逻辑。 */
export function summarizeTripSetStatistics(
  trips: readonly Trip[],
  routeCaches: readonly RouteCacheRecord[] = [],
): TripStatisticsSummary {
  const routeCacheMap = buildRouteCacheMap(routeCaches)
  const tripBreakdown = trips.map((trip) => buildTripBreakdown(trip, routeCacheMap))
  const segmentReferences = listSegments(trips)
  const roadSelection = selectCurrentRoadAnalysis(segmentReferences, routeCacheMap)
  const roadDistances = summarizeRoadDistances(roadSelection)
  const scenicScoreDistribution = summarizeScoreDistribution(
    segmentReferences,
    'scenicScore',
    SCENIC_SCORE_BANDS,
  )
  const difficultyScoreDistribution = summarizeScoreDistribution(
    segmentReferences,
    'difficultyScore',
    DIFFICULTY_SCORE_BANDS,
  )

  const plannedMileageInputs = tripBreakdown.map((trip) => {
    const distanceMeters = completeMetricValue(trip.plannedDistanceMeters)
    return { value: distanceMeters, distanceMeters }
  })
  const actualMileageInputs = tripBreakdown.map((trip) => {
    const distanceMeters = completeMetricValue(trip.actualDistanceMeters)
    return { value: distanceMeters, distanceMeters }
  })

  return {
    tripCount: trips.length,
    segmentCount: segmentReferences.length,
    tripBreakdown,
    plannedDistanceMeters: mergeNumericTotals(tripBreakdown.map((trip) => trip.plannedDistanceMeters)),
    estimatedDrivingTimeSeconds: mergeNumericTotals(
      tripBreakdown.map((trip) => trip.estimatedDrivingTimeSeconds),
    ),
    actualDistanceMeters: mergeNumericTotals(tripBreakdown.map((trip) => trip.actualDistanceMeters)),
    actualDrivingTimeSeconds: mergeNumericTotals(
      tripBreakdown.map((trip) => trip.actualDrivingTimeSeconds),
    ),
    tripDays: mergeNumericTotals(tripBreakdown.map((trip) => trip.tripDays)),
    roadClassDistance: roadDistances.roadClassDistance,
    numberedRoadDistance: roadDistances.numberedRoadDistance,
    scenicScoreDistribution,
    difficultyScoreDistribution,
    distributions: {
      plannedMileage: summarizeNumericBandDistribution(plannedMileageInputs, MILEAGE_BANDS),
      actualMileage: summarizeNumericBandDistribution(actualMileageInputs, MILEAGE_BANDS),
      tripDays: summarizeNumericBandDistribution(
        tripBreakdown.map((trip) => ({
          value: completeMetricValue(trip.tripDays),
          distanceMeters: completeMetricValue(trip.plannedDistanceMeters),
        })),
        TRIP_DAYS_BANDS,
      ),
      estimatedDrivingTime: summarizeNumericBandDistribution(
        tripBreakdown.map((trip) => ({
          value: completeMetricValue(trip.estimatedDrivingTimeSeconds),
          distanceMeters: completeMetricValue(trip.plannedDistanceMeters),
        })),
        DRIVING_TIME_BANDS,
      ),
      actualDrivingTime: summarizeNumericBandDistribution(
        tripBreakdown.map((trip) => ({
          value: completeMetricValue(trip.actualDrivingTimeSeconds),
          distanceMeters: completeMetricValue(trip.actualDistanceMeters),
        })),
        DRIVING_TIME_BANDS,
      ),
    },
    dataCompleteness: mergeDataCompleteness(tripBreakdown),
  }
}

export function summarizeSingleTripStatistics(
  trip: Trip,
  routeCaches: readonly RouteCacheRecord[] = [],
): TripStatisticsSummary {
  return summarizeTripSetStatistics([trip], routeCaches)
}

/** 历史累计的唯一入口；plan 旅程在这里集中排除。 */
export function summarizeReviewTripStatistics(
  tripReview: TripReview,
  routeCaches: readonly RouteCacheRecord[] = [],
): TripStatisticsSummary {
  return summarizeTripSetStatistics(
    tripReview.trips.filter((trip) => trip.category === 'review'),
    routeCaches,
  )
}

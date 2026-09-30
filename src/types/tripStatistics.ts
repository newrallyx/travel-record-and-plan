import type {
  DifficultyScoreBandKey,
  DrivingTimeBandKey,
  MileageBandKey,
  NumericBandBucket,
  NumericBandDistribution,
  NumericBandPendingBucket,
  RoadClass,
  RoadProvinceStatus,
  ScenicScoreBandKey,
  TripDaysBandKey,
} from './roadStatistics.ts'
import type { TripCategory } from './trip.ts'

export type StatisticsCompletenessStatus = 'complete' | 'partial' | 'missing'

export interface StatisticsCompleteness {
  status: StatisticsCompletenessStatus
  totalItemCount: number
  completeItemCount: number
  partialItemCount: number
  missingItemCount: number
  staleItemCount: number
  notApplicableItemCount: number
}

export interface NumericStatisticsTotal {
  /** 已知项目的小计；完全没有已知值时为 null，不能用 0 代替。 */
  value: number | null
  completeness: StatisticsCompleteness
}

export interface TripStatisticsBreakdown {
  tripId: string
  title: string
  startDate: string
  category: TripCategory
  segmentCount: number
  plannedDistanceMeters: NumericStatisticsTotal
  estimatedDrivingTimeSeconds: NumericStatisticsTotal
  actualDistanceMeters: NumericStatisticsTotal
  actualDrivingTimeSeconds: NumericStatisticsTotal
  tripDays: NumericStatisticsTotal
  dataCompleteness: TripStatisticsDataCompleteness
}

export interface RoadClassDistanceEntry {
  roadClass: RoadClass
  distanceMeters: number
  distanceShare: number | null
  tripCount: number
  segmentCount: number
  roadPartCount: number
}

export interface RoadClassDistanceStatistics {
  entries: RoadClassDistanceEntry[]
  /** 没有任何 current 道路分析时为 null。 */
  analyzedDistanceMeters: number | null
}

export interface NumberedRoadDistanceEntry {
  routeRef: string
  roadClass: Extract<RoadClass, 'EXPRESSWAY' | 'NATIONAL_ROAD' | 'PROVINCIAL_ROAD'>
  provinceCode?: string
  provinceName?: string
  provinceStatus?: RoadProvinceStatus
  roadNames: string[]
  distanceMeters: number
  distanceShare: number | null
  tripCount: number
  segmentCount: number
  roadPartCount: number
}

export interface UnnumberedRoadDistanceEntry {
  provinceCode?: string
  provinceName?: string
  provinceStatus?: RoadProvinceStatus
  routeRefs?: string[]
  roadNames: string[]
  distanceMeters: number
  distanceShare: number | null
  tripCount: number
  segmentCount: number
  roadPartCount: number
}

export interface NumberedRoadDistanceStatistics {
  entries: NumberedRoadDistanceEntry[]
  unnumberedExpressway: UnnumberedRoadDistanceEntry
  unnumberedNationalRoad: UnnumberedRoadDistanceEntry
  unnumberedProvincialRoads: UnnumberedRoadDistanceEntry[]
  /** 高速、国道、省道（含无编号）的已分析里程；没有 current 道路分析时为 null。 */
  distanceShareDenominatorMeters: number | null
}

export interface ScoreDistribution<Key extends ScenicScoreBandKey | DifficultyScoreBandKey> {
  bands: Array<NumericBandBucket<Key>>
  unrated: NumericBandPendingBucket
  /** 只以已评分且里程已知的路段为分母。 */
  ratedDistanceMeters: number | null
  ratedSegmentCount: number
  distancePendingSegmentCount: number
  distanceWeightedAverage: number | null
}

export interface TripStatisticsDataCompleteness {
  overallStatus: StatisticsCompletenessStatus
  plannedDistance: StatisticsCompleteness
  estimatedDrivingTime: StatisticsCompleteness
  actualDistance: StatisticsCompleteness
  actualDrivingTime: StatisticsCompleteness
  tripDays: StatisticsCompleteness
  roadAnalysis: StatisticsCompleteness
  scenicScore: StatisticsCompleteness
  difficultyScore: StatisticsCompleteness
}

export interface TripStatisticsDistributions {
  plannedMileage: NumericBandDistribution<MileageBandKey>
  actualMileage: NumericBandDistribution<MileageBandKey>
  tripDays: NumericBandDistribution<TripDaysBandKey>
  estimatedDrivingTime: NumericBandDistribution<DrivingTimeBandKey>
  actualDrivingTime: NumericBandDistribution<DrivingTimeBandKey>
}

export interface TripStatisticsSummary {
  tripCount: number
  segmentCount: number
  tripBreakdown: TripStatisticsBreakdown[]
  plannedDistanceMeters: NumericStatisticsTotal
  estimatedDrivingTimeSeconds: NumericStatisticsTotal
  actualDistanceMeters: NumericStatisticsTotal
  actualDrivingTimeSeconds: NumericStatisticsTotal
  tripDays: NumericStatisticsTotal
  roadClassDistance: RoadClassDistanceStatistics
  numberedRoadDistance: NumberedRoadDistanceStatistics
  scenicScoreDistribution: ScoreDistribution<ScenicScoreBandKey>
  difficultyScoreDistribution: ScoreDistribution<DifficultyScoreBandKey>
  distributions: TripStatisticsDistributions
  dataCompleteness: TripStatisticsDataCompleteness
}

export interface RoadDistanceComparison {
  currentDistanceMeters: number | null
  historicalDistanceMeters: number | null
  currentDistanceShare: number | null
  historicalDistanceShare: number | null
}

export interface RoadCompositionRow extends RoadDistanceComparison {
  roadClass: Extract<RoadClass, 'EXPRESSWAY' | 'NATIONAL_ROAD' | 'PROVINCIAL_ROAD' | 'OTHER'>
  label: string
}

export interface NamedRoadComparisonRow extends RoadDistanceComparison {
  key: string
  roadClass: Extract<RoadClass, 'EXPRESSWAY' | 'NATIONAL_ROAD' | 'PROVINCIAL_ROAD'>
  routeRef: string | null
  provinceCode?: string
  provinceName?: string
  provinceStatus?: RoadProvinceStatus
  routeRefs?: string[]
  roadNames: string[]
  historicalTripCount: number | null
  currentRoadPartCount: number
}

export interface RoadStatisticsComparison {
  composition: RoadCompositionRow[]
  namedRoads: NamedRoadComparisonRow[]
  /** 全部规划里程中尚未归入四类的部分，包含未知道路和非驾车路段。 */
  unclassified: RoadDistanceComparison
  current: TripStatisticsSummary
  historical: TripStatisticsSummary
}

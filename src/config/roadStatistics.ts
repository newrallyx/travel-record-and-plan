import type {
  DifficultyScoreBandKey,
  DrivingTimeBandKey,
  MileageBandKey,
  NumericBandDefinition,
  RoadClass,
  ScenicScoreBandKey,
  TripDaysBandKey,
} from '../types/roadStatistics.ts'

export { ROAD_ANALYSIS_SCHEMA_VERSION } from '../types/roadStatistics.ts'

export const ROAD_CLASSIFIER_VERSION = 'rules-v4'
export const ROAD_DISTANCE_TOLERANCE_MIN_METERS = 100
export const ROAD_DISTANCE_TOLERANCE_RATIO = 0.01

export const ROAD_CLASS_LABELS = {
  EXPRESSWAY: '高速公路',
  NATIONAL_ROAD: '国道',
  PROVINCIAL_ROAD: '省道',
  COUNTY_ROAD: '县道',
  TOWNSHIP_ROAD: '乡道',
  VILLAGE_ROAD: '村道',
  URBAN_ROAD: '城市道路',
  OTHER: '其他道路',
  UNKNOWN: '未知道路',
} as const satisfies Readonly<Record<RoadClass, string>>

export const ROAD_CLASS_COLORS = {
  EXPRESSWAY: '#dc2626',
  NATIONAL_ROAD: '#2563eb',
  PROVINCIAL_ROAD: '#0d9488',
  COUNTY_ROAD: '#22c55e',
  TOWNSHIP_ROAD: '#14b8a6',
  VILLAGE_ROAD: '#06b6d4',
  URBAN_ROAD: '#3b82f6',
  OTHER: '#7c3aed',
  UNKNOWN: '#94a3b8',
} as const satisfies Readonly<Record<RoadClass, string>>

/** 单次旅程里程档位，单位为米。 */
export const MILEAGE_BANDS = [
  { key: 'UNDER_500_KM', label: '<500 公里', minInclusive: 0, maxExclusive: 500_000 },
  { key: 'KM_500_TO_1000', label: '500–<1000 公里', minInclusive: 500_000, maxExclusive: 1_000_000 },
  { key: 'KM_1000_TO_1500', label: '1000–<1500 公里', minInclusive: 1_000_000, maxExclusive: 1_500_000 },
  { key: 'KM_1500_TO_2000', label: '1500–<2000 公里', minInclusive: 1_500_000, maxExclusive: 2_000_000 },
  { key: 'KM_2000_PLUS', label: '≥2000 公里', minInclusive: 2_000_000, maxExclusive: null },
] as const satisfies readonly NumericBandDefinition<MileageBandKey>[]

/** 旅行自然日档位；同日往返按 1 天计算。 */
export const TRIP_DAYS_BANDS = [
  { key: 'DAY_TRIP', label: '1 天', minInclusive: 1, maxExclusive: 2 },
  { key: 'SHORT_TRIP', label: '2–3 天', minInclusive: 2, maxExclusive: 4 },
  { key: 'MEDIUM_TRIP', label: '4–7 天', minInclusive: 4, maxExclusive: 8 },
  { key: 'LONG_TRIP', label: '8 天以上', minInclusive: 8, maxExclusive: null },
] as const satisfies readonly NumericBandDefinition<TripDaysBandKey>[]

/** 单次旅程驾驶时间档位，单位为秒。 */
export const DRIVING_TIME_BANDS = [
  { key: 'UNDER_10_HOURS', label: '<10 小时', minInclusive: 0, maxExclusive: 10 * 60 * 60 },
  { key: 'HOURS_10_TO_20', label: '10–<20 小时', minInclusive: 10 * 60 * 60, maxExclusive: 20 * 60 * 60 },
  { key: 'HOURS_20_TO_40', label: '20–<40 小时', minInclusive: 20 * 60 * 60, maxExclusive: 40 * 60 * 60 },
  { key: 'HOURS_40_PLUS', label: '≥40 小时', minInclusive: 40 * 60 * 60, maxExclusive: null },
] as const satisfies readonly NumericBandDefinition<DrivingTimeBandKey>[]

export const SCORE_MIN = 1
export const SCORE_MAX = 10

/** 风景评分允许 0.1 分；所有档位统一使用左闭右开，10 分由末档包含。 */
export const SCENIC_SCORE_BANDS = [
  { key: 'LOW', label: '风景较差', minInclusive: 1, maxExclusive: 5 },
  { key: 'MEDIUM', label: '风景一般', minInclusive: 5, maxExclusive: 7 },
  { key: 'HIGH', label: '风景较好', minInclusive: 7, maxExclusive: 9 },
  { key: 'TOP', label: '风景极好', minInclusive: 9, maxExclusive: null },
] as const satisfies readonly NumericBandDefinition<ScenicScoreBandKey>[]

/** 难度评分与风景评分共享边界，但文案保持独立。 */
export const DIFFICULTY_SCORE_BANDS = [
  { key: 'LOW', label: '难度较低', minInclusive: 1, maxExclusive: 5 },
  { key: 'MEDIUM', label: '难度一般', minInclusive: 5, maxExclusive: 7 },
  { key: 'HIGH', label: '难度较高', minInclusive: 7, maxExclusive: 9 },
  { key: 'TOP', label: '难度极高', minInclusive: 9, maxExclusive: null },
] as const satisfies readonly NumericBandDefinition<DifficultyScoreBandKey>[]

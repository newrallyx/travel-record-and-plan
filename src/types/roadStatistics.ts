// 道路统计领域类型：只描述分析结果和统一档位，不绑定高德解析、缓存或界面。

export const ROAD_ANALYSIS_SCHEMA_VERSION = 1 as const

export type RoadClass =
  | 'EXPRESSWAY'
  | 'NATIONAL_ROAD'
  | 'PROVINCIAL_ROAD'
  | 'COUNTY_ROAD'
  | 'TOWNSHIP_ROAD'
  | 'VILLAGE_ROAD'
  | 'URBAN_ROAD'
  | 'OTHER'
  | 'UNKNOWN'

export type RoadClassificationConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type RoadClassificationSource =
  | 'MANUAL'
  | 'ROAD_CODE'
  | 'ROAD_NAME'
  | 'ROAD_TYPE'
  | 'MIXED'
  | 'FALLBACK'

/** 省级行政区只描述归属证据，不参与道路类别本身的有效性判断。 */
export type RoadProvinceStatus = 'confirmed' | 'pending'

export type RoadProvinceSource =
  | 'NAVIGATION'
  | 'POLYLINE_GEOCODE'
  | 'MANUAL'
  | 'ESTIMATED_SPLIT'
  | 'UNKNOWN'

/** 道路片段里程的来源；几何分配不能冒充导航或实测里程。 */
export type RoadDistanceSource =
  | 'NAVIGATION'
  | 'RECORDED_ALLOCATION'
  | 'GEOMETRY_ESTIMATE'
  | 'MANUAL'

export type RoadAnalysisStatus = 'complete' | 'partial'

export interface RoadClassification {
  roadClass: RoadClass
  routeRef?: string
  confidence: RoadClassificationConfidence
  source: RoadClassificationSource
}

export interface RoadClassificationResult extends RoadClassification {
  normalizedRoadName: string
}

export interface RouteRoadPart extends RoadClassification {
  distanceMeters: number
  distanceSource?: RoadDistanceSource
  roadName?: string
  tollRoad?: string
  instruction?: string
  polyline?: Array<[number, number]>
  provinceCode?: string
  provinceName?: string
  provinceSource?: RoadProvinceSource
  provinceStatus?: RoadProvinceStatus
  provinceCandidates?: string[]
}

export interface ManualRoadIntervalAnnotation {
  id: string
  startPointIndex: number
  endPointIndex: number
  roadClass: RoadClass
  routeRef?: string
  provinceCode?: string
  provinceName?: string
  provinceSource?: Extract<RoadProvinceSource, 'MANUAL' | 'ESTIMATED_SPLIT'>
  provinceStatus?: RoadProvinceStatus
  distanceMeters: number
  distanceSource: Extract<RoadDistanceSource, 'RECORDED_ALLOCATION' | 'GEOMETRY_ESTIMATE'>
  createdAt: string
  updatedAt: string
}

/**
 * 道路分析结果的最小溯源信息。
 * routeBuildKey 为可选是为了兼容旧缓存；缺少它的分析不能视为 current。
 */
export interface RoadAnalysisMeta {
  schemaVersion: typeof ROAD_ANALYSIS_SCHEMA_VERSION
  classifierVersion: string
  analyzedAt: string
  routeBuildKey?: string
  coverageMeters: number
  routeDistanceMeters?: number
  coverageRatio?: number
  distanceErrorMeters?: number
  distanceToleranceMeters?: number
  status: RoadAnalysisStatus
}

export interface NumericBandDefinition<Key extends string> {
  key: Key
  label: string
  minInclusive: number
  maxExclusive: number | null
}

export interface NumericBandDistributionInput {
  value: number | null | undefined
  distanceMeters: number | null | undefined
}

export interface NumericBandBucket<Key extends string> extends NumericBandDefinition<Key> {
  itemCount: number
  distanceMeters: number | null
  distanceKnownItemCount: number
  distancePendingItemCount: number
  /** 以所有已归档且里程已知的项目里程为分母。 */
  distanceShare: number | null
}

export interface NumericBandPendingBucket {
  itemCount: number
  distanceMeters: number | null
  distanceKnownItemCount: number
  distancePendingItemCount: number
}

export interface NumericBandDistribution<Key extends string> {
  bands: Array<NumericBandBucket<Key>>
  /** 数值缺失或非法，不能落入最低档。 */
  pending: NumericBandPendingBucket
  /** 所有档位内里程已知项目的合计；没有任何已知里程时为 null。 */
  distanceShareDenominatorMeters: number | null
  /** 数值是否已知都要计入，用于单列“里程待补全”。 */
  distancePendingItemCount: number
}

export type MileageBandKey =
  | 'UNDER_500_KM'
  | 'KM_500_TO_1000'
  | 'KM_1000_TO_1500'
  | 'KM_1500_TO_2000'
  | 'KM_2000_PLUS'
export type TripDaysBandKey = 'DAY_TRIP' | 'SHORT_TRIP' | 'MEDIUM_TRIP' | 'LONG_TRIP'
export type DrivingTimeBandKey =
  | 'UNDER_10_HOURS'
  | 'HOURS_10_TO_20'
  | 'HOURS_20_TO_40'
  | 'HOURS_40_PLUS'
export type ScenicScoreBandKey = 'LOW' | 'MEDIUM' | 'HIGH' | 'TOP'
export type DifficultyScoreBandKey = 'LOW' | 'MEDIUM' | 'HIGH' | 'TOP'

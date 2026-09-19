// 旅程领域类型：统一定义 Trip / TripDay / RouteSegment 以及筛选与汇总类型。

export type RoutePreference = 'SPEED_FIRST' | 'HIGHWAY_FIRST' | 'AVOID_TOLL'
export type RouteType = 'DRIVING' | 'CYCLING'
export type TripCategory = 'review' | 'plan'
export type RouteColorMode = 'default' | 'scenic' | 'difficulty' | 'roadType'

// 复盘标签白名单：稳定英文代码存储，界面显示中文。
// 不允许自由扩展，新增标签必须同时加入类型与 utils/reviewTags.ts。
export type ReviewTag =
  | 'SUNNY'
  | 'OVERCAST'
  | 'RAIN'
  | 'FOG'
  | 'SNOW'
  | 'HOT'
  | 'COLD'
  | 'SMOOTH'
  | 'CONGESTED'
  | 'ROADWORK'
  | 'ROUGH_ROAD'
  | 'MOUNTAIN_ROAD'
  | 'NIGHT_DRIVING'
  | 'DETOUR'
  | 'RELAXED'
  | 'TIRED'
  | 'SURPRISE'
  | 'NEUTRAL'
  | 'WORTH_REVISIT'
  | 'NO_REVISIT'

/** 实际行驶结果：全部可选，未填写不得显示为 0。 */
export interface ActualDriveResult {
  distanceMeters?: number
  durationSeconds?: number
  tollYuan?: number
}

export interface SegmentReviewFacts {
  tags?: ReviewTag[]
  actual?: ActualDriveResult
}

export interface CoordPoint {
  lat: number
  lon: number
  timestamp?: string
}

export interface Waypoint {
  id: string
  name: string
  lat?: number
  lng?: number
  amapId?: string
  timestamp?: string
}

export interface RouteSegment {
  id: string
  name: string
  date?: string
  order?: number
  startPoint: string
  endPoint: string
  /**
   * 历史兼容字段：旧版本以逗号分隔文本记录途经点。
   * 新增/编辑/规划主流程统一使用 waypoints。
   */
  viaPointsText?: string
  preference: RoutePreference
  routeType?: RouteType
  startCoord?: CoordPoint
  endCoord?: CoordPoint
  startPlaceId?: string
  endPlaceId?: string
  points?: CoordPoint[]
  distanceMeters?: number
  estimatedDurationSeconds?: number
  durationUpdatedAt?: string
  estimatedTollYuan?: number
  tollDistanceMeters?: number
  tollUpdatedAt?: string
  routeBuildKey?: string
  waypoints?: Waypoint[]
  scenicScore?: number | null
  difficultyScore?: number | null
  note?: string
  photoIds?: string[]
  reviewFacts?: SegmentReviewFacts
}

export interface TripDay {
  id: string
  date: string // YYYY-MM-DD
  routeSegments: RouteSegment[]
}

export interface Trip {
  id: string
  title: string
  category: TripCategory
  order?: number
  startDate: string
  endDate: string
  days: TripDay[]
  /** 手动指定的旅程封面照片；被移除或不可访问时回退到默认封面。 */
  coverPhotoId?: string
  /** 生成的游记 Markdown 文本；保存后可在路书浏览中再次查看或下载。 */
  travelogue?: string
}

export interface TripReview {
  trips: Trip[]
}

export interface FilterState {
  tripId: string
  dayId: string
  segmentId: string
}

export interface RouteSummary {
  totalDistanceText: string
  totalEstimatedDurationText: string
  totalEstimatedTollText: string
}

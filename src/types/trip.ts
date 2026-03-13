// 旅程领域类型：统一定义 Trip / TripDay / RouteSegment 以及筛选与汇总类型。

export type RoutePreference = 'HIGHWAY_FIRST' | 'AVOID_TOLL'
export type RouteType = 'DRIVING' | 'CYCLING'
export type TripCategory = 'review' | 'plan'

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
  routeBuildKey?: string
  waypoints?: Waypoint[]
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
}

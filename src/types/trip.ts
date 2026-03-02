// 旅程领域类型：统一定义 Trip / TripDay / RouteSegment 以及筛选与汇总类型。

export type RoutePreference = 'HIGHWAY_FIRST' | 'LESS_TOLL' | 'NORMAL_ROAD_FIRST' | 'SHORTEST_TIME' | 'AVOID_TOLL'

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
  startPoint: string
  endPoint: string
  viaPointsText: string
  preference: RoutePreference
  startCoord?: CoordPoint
  endCoord?: CoordPoint
  startPlaceId?: string
  endPlaceId?: string
  points?: CoordPoint[]
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
  totalDurationText: string
}

import type { RoadAnalysisMeta, RouteRoadPart } from '../../types/roadStatistics.ts'

export interface AMapTip {
  id: string
  name: string
  district: string
  address: string
  location: string
  adcode: string
  typecode: string
  type: string
}

export interface AMapPlaceSuggestion {
  id?: string
  name: string
  displayName: string
  lat: number
  lng: number
  district?: string
  address?: string
  adcode?: string
  sourceType?: 'city' | 'poi' | 'fallback-poi'
  isAdministrative?: boolean
  isOutOfScope?: boolean
}

export interface InputTipsQuery {
  keywords: string
  mode?: 'poi' | 'city'
  type?: string
  city?: string
  citylimit?: boolean
  datatype?: 'all' | 'poi' | 'bus' | 'busline'
  location?: string
}

export interface DrivingRequestPoint {
  lat: number
  lng: number
}

export interface DrivingRouteResult {
  polyline: Array<[number, number]>
  roadParts?: RouteRoadPart[]
  roadAnalysis?: RoadAnalysisMeta
  distanceText: string
  durationText: string
  durationSeconds?: number
  distanceMeters?: number
  estimatedTollYuan?: number
  tollDistanceMeters?: number
  tollUpdatedAt?: string
  durationUpdatedAt?: string
  routeKey: string
  fromCache?: boolean
}

export interface AMapServiceError {
  code?: string
  message: string
}

export interface RouteApiResult {
  polyline: Array<[number, number]>
  roadParts?: RouteRoadPart[]
  distanceText: string
  durationText: string
  durationSeconds?: number
  distanceMeters?: number
  estimatedTollYuan?: number
  tollDistanceMeters?: number
}

export interface PlannedRouteResponse {
  route: DrivingRouteResult | null
  error: AMapServiceError | null
}

import type { CoordPoint, RouteSegment } from '../../types/trip'
import type { RoadAnalysisMeta, RouteRoadPart } from '../../types/roadStatistics'

export type PointKind = 'start' | 'via' | 'end'
export type EditMode = 'start' | 'end' | 'track'

export interface SegmentTrack {
  segmentId: string
  segmentName: string
  points: Array<{ name: string; lat: number; lon: number; type: PointKind }>
  line: CoordPoint[]
  /** 道路分析只保留在路线缓存中；地图读取到当前分析时附带用于分段绘制。 */
  roadParts?: RouteRoadPart[]
  roadAnalysis?: RoadAnalysisMeta
  distanceMeters?: number
}

export interface SegmentRouteDescriptor {
  segment: RouteSegment
  buildKey: string
  canReusePersisted: boolean
}

export interface ResolvedRoutePatch {
  segmentId: string
  points: CoordPoint[]
  distanceMeters: number | null
  estimatedDurationSeconds: number | null
  durationUpdatedAt?: string
  estimatedTollYuan: number | null
  tollDistanceMeters: number | null
  tollUpdatedAt?: string
  routeBuildKey: string
  roadParts?: RouteRoadPart[]
  roadAnalysis?: RoadAnalysisMeta
}

export interface RouteRefreshRequest {
  segmentId: string | null
  revision: number
}

export interface TrackSavePayload {
  segmentId: string
  startCoord: CoordPoint
  endCoord: CoordPoint
  points: CoordPoint[]
}

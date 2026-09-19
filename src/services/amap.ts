// 高德服务稳定入口：调用方只从此文件导入，具体实现按职责放在 amap/ 子目录。
export { searchAmapInputTips } from './amap/inputTips'
export { requestCyclingRoute, requestDrivingRoute } from './amap/routeApi'
export { requestAmapProvinceLookup } from './amap/provinceLookup'
export { planCyclingRoute, planDrivingRoute } from './amap/routePlanner'
export type {
  AMapPlaceSuggestion,
  AMapServiceError,
  AMapTip,
  DrivingRequestPoint,
  DrivingRouteResult,
  InputTipsQuery,
  PlannedRouteResponse,
  RouteApiResult,
} from './amap/types'
export type { AmapProvinceLookup } from './amap/provinceLookup'

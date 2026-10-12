import type { RouteRoadPart } from '../types/roadStatistics.ts'

const SOURCES = { MANUAL: '人工修正', ROAD_CODE: '道路编号', ROAD_NAME: '道路名称', ROAD_TYPE: '导航道路类型', MIXED: '综合判断', FALLBACK: '兜底分类' }
const CONFIDENCE = { HIGH: '高', MEDIUM: '中', LOW: '低' }
const DISTANCES = { NAVIGATION: '导航里程', RECORDED_ALLOCATION: '按原里程分配', GEOMETRY_ESTIMATE: '几何估算', MANUAL: '人工填写' }

export function roadEvidenceText(part: RouteRoadPart): string {
  return `分类来源：${SOURCES[part.source] ?? '未记录'} · 可信度：${CONFIDENCE[part.confidence] ?? '未记录'} · 里程来源：${part.distanceSource ? DISTANCES[part.distanceSource] ?? '未记录' : '未记录'}${part.originalRoadName ? ` · 原名称：${part.originalRoadName}` : ''}`
}

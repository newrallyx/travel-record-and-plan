import type { RouteRoadPart } from '../types/roadStatistics.ts'

export function isRoadConnector(part: Pick<RouteRoadPart, 'roadName' | 'instruction'>): boolean {
  // A future exit instruction does not make the current mainline a ramp.
  return /匝道|辅路|连接线|联络线|收费站|服务区|出口|入口/.test(part.roadName ?? '')
    || /^沿\s*[^，,。;；]*?(?:匝道|辅路|连接线|联络线)(?:行驶|向)/.test(part.instruction ?? '')
}

/** The retained first navigation step describes only this distance, not a merged road. */
export function connectorInstructionMetres(part: Pick<RouteRoadPart, 'roadName' | 'instruction'>): number | undefined {
  if (!isRoadConnector(part)) return undefined
  const match = /^沿[^，,。;；]*?行驶\s*(\d+(?:\.\d+)?)\s*(千米|公里|米)/.exec(part.instruction ?? '')
  if (!match) return undefined
  const metres = Number(match[1]) * (match[2] === '米' ? 1 : 1000)
  return metres > 0 ? metres : undefined
}

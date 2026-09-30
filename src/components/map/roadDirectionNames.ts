import type { RoadClass, RouteRoadPart } from '../../types/roadStatistics.ts'
export { isRoadConnector } from '../../utils/roadConnector.ts'

import { nationalRoadDisplayName } from '../../config/nationalRoadNames.ts'
import { ROAD_DIRECTION_REFERENCES } from './roadDirectionReference.ts'

export const ROAD_DIRECTION_NAMES = ROAD_DIRECTION_REFERENCES

export function roadDisplayName(referenceKey: string, roadClass: RoadClass, original?: string): string | undefined {
  const entry = ROAD_DIRECTION_NAMES[referenceKey]
  const nationalName = nationalRoadDisplayName(referenceKey, roadClass)
  return nationalName ?? entry?.aliases.find((name) => /线$/.test(name))
    ?? entry?.name ?? original
}

/** S-numbers need a province or an unambiguous matching road name, never a global S lookup. */
export function roadDirectionReferenceKey(part: RouteRoadPart, routeRef: string): string | undefined {
  if (routeRef.startsWith('G')) return ROAD_DIRECTION_NAMES[routeRef] ? routeRef : undefined
  const text = `${part.roadName ?? ''} ${part.instruction ?? ''}`
  const matches = Object.entries(ROAD_DIRECTION_NAMES).filter(([key, entry]) => key.endsWith(`:${routeRef}`)
    && (part.provinceCode ? entry.provinceCode === part.provinceCode : entry.aliases.some((alias) => text.includes(alias))))
  return matches.length === 1 ? matches[0][0] : undefined
}

export function readRoadDestination(part: RouteRoadPart, routeRef: string): string | undefined {
  const entry = ROAD_DIRECTION_NAMES[roadDirectionReferenceKey(part, routeRef) ?? '']
  if (!entry || part.source === 'MANUAL') return undefined
  const name = part.roadName ?? ''
  const instruction = part.instruction ?? ''
  const onCurrentRoad = new RegExp(`^沿\\s*(?:${routeRef}(?!\\d)|${entry.aliases.join('|')})`).test(instruction)
  // Exit/fork destinations describe a subsequent road, not necessarily the current one.
  const safeInstruction = !/出口|入口|匝道|驶入|驶出|进入|离开|朝|转向|左转|右转/.test(instruction)
    && onCurrentRoad
    ? instruction : ''
  const matches = entry.endpoints.filter((endpoint) =>
    name.includes(`${endpoint}方向`) || safeInstruction.includes(`向${endpoint}方向行驶`))
  return matches.length === 1 ? matches[0] : undefined
}

export function oppositeRoadDestination(routeRef: string, destination: string): string | undefined {
  const ends = ROAD_DIRECTION_NAMES[routeRef]?.endpoints
  return ends?.includes(destination) ? ends.find((end) => end !== destination) : undefined
}

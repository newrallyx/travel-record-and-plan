import { normalizeRoadText } from './roadClassifier.ts'
import { nationalRoadDisplayName } from '../config/nationalRoadNames.ts'
import { ROAD_CLASS_LABELS } from '../config/roadStatistics.ts'
import type { RoadClass, RouteRoadPart } from '../types/roadStatistics.ts'

/** 原道路名称优先；缺少名称时才使用当前人工修正后的编号与类型。 */
export function getRoadPartDisplayName(part: Pick<RouteRoadPart, 'roadName' | 'tollRoad' | 'routeRef' | 'roadClass'>): string {
  return part.roadName?.trim() || part.tollRoad?.trim()
    || (part.routeRef?.trim() ? `${part.routeRef.trim()} ${ROAD_CLASS_LABELS[part.roadClass]}` : '未命名道路')
}

/** Presentation only: keep original names and road identities untouched. */
export function presentRoadNames(roadNames: readonly string[], routeRef: string | null, roadClass?: RoadClass) {
  const conflicts: string[] = []
  const names = new Set<string>()
  for (const original of roadNames) {
    const normalized = normalizeRoadText(original)
    const refs = [...normalized.matchAll(/(?:^|[^A-Z0-9])([GSXYCZ])[-\s]*(\d{1,4})(?!\d)/g)]
      .map((match) => `${match[1]}${match[2]}`)
    const chineseRefs = [...normalized.matchAll(/(\d{1,4})\s*(国道|省道|县道|乡道)/g)]
      .map((match) => `${({ 国道: 'G', 省道: 'S', 县道: 'X', 乡道: 'Y' } as Record<string, string>)[match[2]]}${match[1]}`)
    if (routeRef && [...refs, ...chineseRefs].some((ref) => ref !== routeRef)) {
      conflicts.push(original)
      continue
    }
    const name = normalized.replace(/(?:入口|出口)$/, '').trim()
    if (/(?:隧道|桥|立交|互通|枢纽|匝道|收费站|服务区|停车区)$/.test(name)) continue
    // A numbered row needs matching evidence before a name is promoted to its summary.
    if (routeRef && ![...refs, ...chineseRefs].includes(routeRef)) continue
    const label = routeRef ? name.replace(new RegExp(`^${routeRef[0]}[-\\s]*${routeRef.slice(1)}(?!\\d)\\s*`), '').trim() : name
    if (label) names.add(label)
  }
  return { summary: roadClass ? nationalRoadDisplayName(routeRef, roadClass) ?? [...names].slice(0, 2).join('、')
    : [...names].slice(0, 2).join('、'), conflicts }
}

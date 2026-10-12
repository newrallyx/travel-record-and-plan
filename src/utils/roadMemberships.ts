import type { ConcurrentRoad, RouteRoadPart } from '../types/roadStatistics.ts'
import { extractRouteRef } from './roadClassifier.ts'
import { isProvinceSensitiveRoadPart, normalizeProvinceCode, provinceNameFromCode } from './province.ts'

type RoadIdentity = Pick<RouteRoadPart, 'roadClass' | 'routeRef' | 'provinceCode' | 'provinceCandidates'>
export const CONCURRENT_ROAD_CLASSES = ['EXPRESSWAY', 'NATIONAL_ROAD', 'PROVINCIAL_ROAD'] as const

/** Candidate sets are distinct pending identities, independent of order or duplicates. */
export function roadProvinceKey(part: Pick<RouteRoadPart, 'provinceCode' | 'provinceCandidates'>): string {
  if (part.provinceCode) return part.provinceCode
  const candidates = [...new Set(part.provinceCandidates ?? [])].sort()
  return candidates.length ? `PENDING:${candidates.join(',')}` : 'PENDING'
}

export function roadIdentityKey(part: RoadIdentity): string | null {
  if (!(CONCURRENT_ROAD_CLASSES as readonly string[]).includes(part.roadClass)) return null
  const routeRef = extractRouteRef(part.routeRef)
  const province = isProvinceSensitiveRoadPart({ ...part, routeRef }) ? `${roadProvinceKey(part)}:` : ''
  return `${part.roadClass}:${province}${routeRef ?? 'UNNUMBERED'}`
}

/** Strict on user saves; tolerate older backups without this optional metadata. */
export function normalizeConcurrentRoads(value: unknown, primary: RoadIdentity, strict = false): ConcurrentRoad[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    if (strict) throw new Error('共线道路列表格式无效。')
    return []
  }
  if (value.length && (!(CONCURRENT_ROAD_CLASSES as readonly string[]).includes(primary.roadClass) || !extractRouteRef(primary.routeRef))) {
    if (strict) throw new Error('请先填写高速、国道或省道的主道路编号。')
    return []
  }
  const seen = new Set([roadIdentityKey(primary)])
  const result: ConcurrentRoad[] = []
  for (const item of value) {
    const roadClass = item?.roadClass
    const ref = typeof item?.routeRef === 'string' ? item.routeRef.toUpperCase().replace(/[\s-]/g, '') : ''
    const valid = roadClass === 'NATIONAL_ROAD' ? /^G\d{3}$/.test(ref)
      : roadClass === 'PROVINCIAL_ROAD' ? /^S\d{3}$/.test(ref)
        : roadClass === 'EXPRESSWAY' && /^[GS](?:\d{1,2}|\d{4})$/.test(ref)
    const provinceCode = normalizeProvinceCode(item?.provinceCode)
    const sensitive = isProvinceSensitiveRoadPart({ roadClass, routeRef: ref })
    if (!valid || (sensitive && !provinceCode)) {
      if (strict) throw new Error('请填写与类型匹配的完整共线编号；省道和省级高速还需选择省份。')
      continue
    }
    const road: ConcurrentRoad = { roadClass, routeRef: ref, ...(sensitive ? { provinceCode } : {}) }
    const key = roadIdentityKey(road)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(road)
  }
  return result
}

/** Temporary membership views retain one source/geometry; never persist extra parts. */
export function roadMembershipParts(part: RouteRoadPart): RouteRoadPart[] {
  return [part, ...normalizeConcurrentRoads(part.concurrentRoads, part).map(road => ({
    ...part,
    ...road,
    concurrentRoads: undefined,
    roadName: undefined,
    tollRoad: undefined,
    instruction: undefined,
    manualDirection: undefined,
    provinceCode: road.provinceCode,
    provinceName: provinceNameFromCode(road.provinceCode),
    provinceSource: road.provinceCode ? 'MANUAL' as const : undefined,
    provinceStatus: road.provinceCode ? 'confirmed' as const : undefined,
    provinceCandidates: undefined,
  }))]
}

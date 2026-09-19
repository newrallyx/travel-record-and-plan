import type {
  RoadClass,
  RoadClassificationConfidence,
  RoadClassificationResult,
  RouteRoadPart,
} from '../types/roadStatistics.ts'
import { isProvinceSensitiveRoadPart } from './province.ts'

const ANONYMOUS_ROAD_NAMES = new Set([
  '',
  'UNKNOWN',
  'UNKNOWN ROAD',
  'N/A',
  '无名道路',
  '未命名道路',
  '未知道路',
])

const EXPLICIT_CLASS_RULES: ReadonlyArray<{ roadClass: RoadClass; pattern: RegExp }> = [
  { roadClass: 'EXPRESSWAY', pattern: /高速(?!铁路|列车|网络)/ },
  { roadClass: 'NATIONAL_ROAD', pattern: /国道/ },
  { roadClass: 'PROVINCIAL_ROAD', pattern: /省道/ },
  { roadClass: 'COUNTY_ROAD', pattern: /县道/ },
  { roadClass: 'TOWNSHIP_ROAD', pattern: /乡道/ },
  { roadClass: 'VILLAGE_ROAD', pattern: /村道/ },
  { roadClass: 'URBAN_ROAD', pattern: /城市道路/ },
]

const GENERIC_URBAN_ROAD_PATTERN = /(?:快速路|高架|大道|大街|街|路|巷|弄|胡同|环路|辅路|支路|隧道|桥)$/
const NON_ROAD_NAME_PATTERN = /(?:高速铁路|铁路|高速列车|高速网络)$/
const ROUTE_REF_PATTERN = /(?:^|[^A-Z0-9])([GSXYCZ])\s*[-‐‑–—]?\s*(\d{1,4})(?=$|[^A-Z0-9])/
const CHINESE_ROUTE_REF_RULES: ReadonlyArray<{
  roadClass: RoadClass
  prefix: 'G' | 'S' | 'X' | 'Y' | 'C'
  pattern: RegExp
}> = [
  { roadClass: 'NATIONAL_ROAD', prefix: 'G', pattern: /(\d{1,4})\s*国道/ },
  { roadClass: 'PROVINCIAL_ROAD', prefix: 'S', pattern: /(\d{1,4})\s*省道/ },
  { roadClass: 'COUNTY_ROAD', prefix: 'X', pattern: /(\d{1,4})\s*县道/ },
  { roadClass: 'TOWNSHIP_ROAD', prefix: 'Y', pattern: /(\d{1,4})\s*乡道/ },
  { roadClass: 'VILLAGE_ROAD', prefix: 'C', pattern: /(\d{1,4})\s*村道/ },
]
const ROAD_INFRASTRUCTURE_PATTERN = /(?:隧道|桥|立交|互通|匝道|收费站)$/
const EXPRESSWAY_CONNECTOR_PATTERN = /(?:立交|互通|匝道|收费站)$/
const ROUTE_ENTRY_EXIT_PATTERN = /(?:入口|出口|收费站|驶入|驶出|驶离|离开)/

const SPECIFIC_ROAD_CLASSES = new Set<RoadClass>([
  'EXPRESSWAY',
  'NATIONAL_ROAD',
  'PROVINCIAL_ROAD',
  'COUNTY_ROAD',
  'TOWNSHIP_ROAD',
  'VILLAGE_ROAD',
])

const CONFIDENCE_RANK: Readonly<Record<RoadClassificationConfidence, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
}

function toHalfWidth(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)
    if (codePoint === 0x3000) return ' '
    if (codePoint !== undefined && codePoint >= 0xff01 && codePoint <= 0xff5e) {
      return String.fromCodePoint(codePoint - 0xfee0)
    }
    return character
  }).join('')
}

/** 全角转半角、折叠空白，并统一为大写，供分类与编号比较复用。 */
export function normalizeRoadText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return toHalfWidth(value).replace(/\s+/g, ' ').trim().toUpperCase()
}

/** 提取并规范化首个中国公路编号，例如 G65、G210、S101。 */
export function extractRouteRef(value: unknown): string | undefined {
  const normalized = normalizeRoadText(value)
  const match = ROUTE_REF_PATTERN.exec(normalized)
  if (match) return `${match[1]}${match[2]}`

  for (const rule of CHINESE_ROUTE_REF_RULES) {
    const chineseMatch = rule.pattern.exec(normalized)
    if (chineseMatch) return `${rule.prefix}${chineseMatch[1]}`
  }
  return undefined
}

function extractRouteRefForClass(value: string, roadClass: RoadClass): string | undefined {
  const rule = CHINESE_ROUTE_REF_RULES.find((candidate) => candidate.roadClass === roadClass)
  const match = rule?.pattern.exec(value)
  return match && rule ? `${rule.prefix}${match[1]}` : undefined
}

function classifyRouteRef(routeRef: string | undefined): RoadClass | null {
  const match = /^([GSXYCZ])(\d{1,4})$/.exec(routeRef ?? '')
  if (!match) return null

  const [, prefix, digits] = match
  if (prefix === 'G') return digits.length === 3 ? 'NATIONAL_ROAD' : 'EXPRESSWAY'
  if (prefix === 'S') return digits.length === 3 ? 'PROVINCIAL_ROAD' : 'EXPRESSWAY'
  if (prefix === 'X') return 'COUNTY_ROAD'
  if (prefix === 'Y') return 'TOWNSHIP_ROAD'
  if (prefix === 'C') return 'VILLAGE_ROAD'
  return 'OTHER'
}

function findExplicitRoadClass(normalizedRoadName: string): RoadClass | null {
  return EXPLICIT_CLASS_RULES.find((rule) => rule.pattern.test(normalizedRoadName))?.roadClass ?? null
}

/**
 * 关键词优先，编号规则仅在没有明确道路关键词时补充判断。
 * 关键词与编号惯例冲突时保留关键词结果，并把置信度降为 MEDIUM。
 */
export function classifyRoad(value: unknown): RoadClassificationResult {
  const normalizedRoadName = normalizeRoadText(value)

  if (ANONYMOUS_ROAD_NAMES.has(normalizedRoadName)) {
    return {
      normalizedRoadName,
      roadClass: 'UNKNOWN',
      confidence: 'LOW',
      source: 'FALLBACK',
    }
  }

  const explicitRoadClass = findExplicitRoadClass(normalizedRoadName)
  const routeRef = explicitRoadClass
    ? extractRouteRefForClass(normalizedRoadName, explicitRoadClass) ?? extractRouteRef(normalizedRoadName)
    : extractRouteRef(normalizedRoadName)
  const refRoadClass = classifyRouteRef(routeRef)
  if (explicitRoadClass) {
    const conflictsWithRef = refRoadClass !== null
      && refRoadClass !== 'OTHER'
      && refRoadClass !== explicitRoadClass
    return {
      normalizedRoadName,
      roadClass: explicitRoadClass,
      ...(routeRef ? { routeRef } : {}),
      confidence: conflictsWithRef ? 'MEDIUM' : 'HIGH',
      source: 'ROAD_NAME',
    }
  }

  if (routeRef && refRoadClass) {
    return {
      normalizedRoadName,
      roadClass: refRoadClass,
      routeRef,
      confidence: 'MEDIUM',
      source: 'ROAD_CODE',
    }
  }

  if (!NON_ROAD_NAME_PATTERN.test(normalizedRoadName) && GENERIC_URBAN_ROAD_PATTERN.test(normalizedRoadName)) {
    return {
      normalizedRoadName,
      roadClass: 'URBAN_ROAD',
      confidence: 'MEDIUM',
      source: 'ROAD_NAME',
    }
  }

  return {
    normalizedRoadName,
    roadClass: 'OTHER',
    confidence: 'LOW',
    source: 'FALLBACK',
  }
}

export interface RoadPartEvidence {
  roadName?: unknown
  tollRoad?: unknown
  instruction?: unknown
}

function isSpecificRoadClassification(result: RoadClassificationResult): boolean {
  return SPECIFIC_ROAD_CLASSES.has(result.roadClass)
}

function isRoadInfrastructureName(value: unknown): boolean {
  return ROAD_INFRASTRUCTURE_PATTERN.test(normalizeRoadText(value))
}

function roadClassRank(roadClass: RoadClass): number {
  switch (roadClass) {
    case 'EXPRESSWAY': return 6
    case 'NATIONAL_ROAD': return 5
    case 'PROVINCIAL_ROAD': return 4
    case 'COUNTY_ROAD': return 3
    case 'TOWNSHIP_ROAD': return 2
    case 'VILLAGE_ROAD': return 1
    default: return 0
  }
}

function isTraversedHigherClassRoad(
  primary: RoadClassificationResult,
  instruction: unknown,
  secondary: RoadClassificationResult | undefined,
): boolean {
  const normalizedInstruction = normalizeRoadText(instruction)
  return Boolean(
    secondary?.routeRef
    && normalizedInstruction.includes('途径')
    && !ROUTE_ENTRY_EXIT_PATTERN.test(normalizedInstruction)
    && roadClassRank(secondary.roadClass) > roadClassRank(primary.roadClass),
  )
}

/**
 * 高德会把高速中的隧道、桥梁和互通名称放进 road，而把真正的高速编号放在
 * toll_road 或 instruction。普通城市道路即使“途径某高速入口”也不能被覆盖。
 */
export function classifyRoadPartEvidence({
  roadName,
  tollRoad,
  instruction,
}: RoadPartEvidence): RoadClassificationResult {
  const primary = classifyRoad(roadName)
  const instructionClassification = classifyRoad(instruction)
  const traversedRoad = isSpecificRoadClassification(instructionClassification)
    ? instructionClassification
    : undefined
  if (isTraversedHigherClassRoad(primary, instruction, traversedRoad)) {
    return {
      normalizedRoadName: primary.normalizedRoadName,
      roadClass: traversedRoad!.roadClass,
      routeRef: traversedRoad!.routeRef,
      confidence: traversedRoad!.confidence,
      source: 'MIXED',
    }
  }

  const canUseSecondaryEvidence = primary.roadClass === 'UNKNOWN'
    || primary.roadClass === 'OTHER'
    || isRoadInfrastructureName(primary.normalizedRoadName)
  if (!canUseSecondaryEvidence) return primary

  const secondary = [classifyRoad(tollRoad), instructionClassification]
    // “转入/驶入某道路”描述的是下一步动作，不足以证明当前 step 已经在该路上。
    .filter((_candidate, index) => index === 0 || !ROUTE_ENTRY_EXIT_PATTERN.test(normalizeRoadText(instruction)))
    .filter(isSpecificRoadClassification)
    .sort((left, right) => CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence])[0]
  if (!secondary) return primary

  return {
    normalizedRoadName: primary.normalizedRoadName,
    roadClass: secondary.roadClass,
    ...(secondary.routeRef ? { routeRef: secondary.routeRef } : {}),
    confidence: secondary.confidence,
    source: 'MIXED',
  }
}

function weakerConfidence(
  left: RoadClassificationConfidence,
  right: RoadClassificationConfidence,
): RoadClassificationConfidence {
  return CONFIDENCE_RANK[left] <= CONFIDENCE_RANK[right] ? left : right
}

function normalizedPartRouteRef(part: RouteRoadPart): string | undefined {
  return extractRouteRef(part.routeRef)
}

function copyPolyline(polyline: RouteRoadPart['polyline']): RouteRoadPart['polyline'] {
  return polyline?.map(([lat, lng]) => [lat, lng])
}

function appendPolyline(
  previous: RouteRoadPart['polyline'],
  next: RouteRoadPart['polyline'],
): RouteRoadPart['polyline'] {
  if (!previous) return copyPolyline(next)
  if (!next) return copyPolyline(previous)

  const combined = copyPolyline(previous) ?? []
  for (const point of next) {
    const last = combined[combined.length - 1]
    if (last && last[0] === point[0] && last[1] === point[1]) continue
    combined.push([point[0], point[1]])
  }
  return combined
}

function normalizeRoadPart(sourcePart: RouteRoadPart): RouteRoadPart {
  const {
    routeRef: _routeRef,
    roadName: _roadName,
    tollRoad: _tollRoad,
    instruction: _instruction,
    polyline: _polyline,
    ...rest
  } = sourcePart
  const routeRef = normalizedPartRouteRef(sourcePart)
  const roadName = normalizeRoadText(sourcePart.roadName) || undefined
  const tollRoad = normalizeRoadText(sourcePart.tollRoad) || undefined
  const instruction = typeof sourcePart.instruction === 'string'
    ? sourcePart.instruction.trim() || undefined
    : undefined

  return {
    ...rest,
    ...(routeRef ? { routeRef } : {}),
    ...(roadName ? { roadName } : {}),
    ...(tollRoad ? { tollRoad } : {}),
    ...(instruction ? { instruction } : {}),
    ...(sourcePart.polyline ? { polyline: copyPolyline(sourcePart.polyline) } : {}),
  }
}

function reclassifyRoadPart(sourcePart: RouteRoadPart): RouteRoadPart {
  const normalized = normalizeRoadPart(sourcePart)
  if (normalized.source === 'MANUAL') return normalized

  const { normalizedRoadName: _normalizedRoadName, ...classification } = classifyRoadPartEvidence({
    roadName: normalized.roadName,
    tollRoad: normalized.tollRoad,
    instruction: normalized.instruction,
  })
  const { roadClass: _roadClass, routeRef: _routeRef, confidence: _confidence, source: _source, ...metadata } = normalized
  return { ...metadata, ...classification }
}

function isAmbiguousInfrastructurePart(part: RouteRoadPart): boolean {
  return part.source !== 'MANUAL'
    && (part.roadClass === 'UNKNOWN' || part.roadClass === 'OTHER' || part.roadClass === 'URBAN_ROAD')
    && (
      isRoadInfrastructureName(part.roadName)
      || isRoadInfrastructureName(part.tollRoad)
      || /(?:进入|驶入|驶出)匝道/.test(normalizeRoadText(part.instruction))
    )
}

function isUnnumberedAliasPart(part: RouteRoadPart): boolean {
  return part.source !== 'MANUAL'
    && normalizedPartRouteRef(part) === undefined
    && (
      part.roadClass === 'UNKNOWN'
      || part.roadClass === 'OTHER'
      || part.roadClass === 'URBAN_ROAD'
      || isRoadInfrastructureName(part.roadName)
  )
}

function sameProvinceIdentity(left: RouteRoadPart | undefined, right: RouteRoadPart | undefined): boolean {
  if (!left || !right) return false
  if (!isProvinceSensitiveRoadPart(left) && !isProvinceSensitiveRoadPart(right)) return true
  if (left.provinceCode && right.provinceCode) return left.provinceCode === right.provinceCode
  // 省道和 S 编号高速在省份未确定时不提前合并，避免跨省同号被误吞。
  return false
}

function sameSpecificRoad(left: RouteRoadPart | undefined, right: RouteRoadPart | undefined): boolean {
  if (!left || !right || !SPECIFIC_ROAD_CLASSES.has(left.roadClass)) return false
  return left.roadClass === right.roadClass
    && normalizedPartRouteRef(left) !== undefined
    && normalizedPartRouteRef(left) === normalizedPartRouteRef(right)
    && sameProvinceIdentity(left, right)
}

function inferFromContext(part: RouteRoadPart, neighbor: RouteRoadPart): RouteRoadPart {
  const routeRef = normalizedPartRouteRef(neighbor)
  return {
    ...part,
    roadClass: neighbor.roadClass,
    ...(routeRef ? { routeRef } : {}),
    confidence: 'MEDIUM',
    source: 'MIXED',
    ...(neighbor.provinceCode ? { provinceCode: neighbor.provinceCode } : {}),
    ...(neighbor.provinceName ? { provinceName: neighbor.provinceName } : {}),
    ...(neighbor.provinceSource ? { provinceSource: neighbor.provinceSource } : {}),
    ...(neighbor.provinceStatus ? { provinceStatus: neighbor.provinceStatus } : {}),
    ...(neighbor.provinceCandidates ? { provinceCandidates: [...neighbor.provinceCandidates] } : {}),
  }
}

/**
 * 高德会把一条连续国省道的地方别名（例如镇东路、黄杨路、长新路）拆成独立
 * step。只有相同公路编号的两个锚点之间可安全视为同一走廊；最后一个锚点
 * 之后缺少右侧证据，不能继续把地方道路推断成该国省道。
 */
function inferContinuousRouteAliases(parts: RouteRoadPart[]): void {
  const anchors = parts
    .map((part, index) => ({ index, part, routeRef: normalizedPartRouteRef(part) }))
    .filter((item): item is { index: number; part: RouteRoadPart; routeRef: string } => (
      item.routeRef !== undefined && SPECIFIC_ROAD_CLASSES.has(item.part.roadClass)
    ))

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex]
    const right = anchors[anchorIndex + 1]
    if (left.routeRef !== right.routeRef || left.part.roadClass !== right.part.roadClass) continue
    if (!sameProvinceIdentity(left.part, right.part)) continue
    for (let index = left.index + 1; index < right.index; index += 1) {
      if (isUnnumberedAliasPart(parts[index])) parts[index] = inferFromContext(parts[index], left.part)
    }
  }

}

/**
 * 对高德 step 或旧缓存进行可重复的本地重分类。只有隧道/桥梁/互通等基础设施
 * 片段才允许继承相邻道路；普通城市道路不会因提到“高速入口”而变成高速。
 */
export function reclassifyRoadParts(
  sourceParts: readonly RouteRoadPart[],
  options: { tollCovered?: readonly boolean[] } = {},
): RouteRoadPart[] {
  const parts = sourceParts.map(reclassifyRoadPart)
  let index = 0

  while (index < parts.length) {
    if (!isAmbiguousInfrastructurePart(parts[index])) {
      index += 1
      continue
    }

    const start = index
    while (index + 1 < parts.length && isAmbiguousInfrastructurePart(parts[index + 1])) index += 1
    const end = index
    const left = parts[start - 1]
    const right = parts[end + 1]
    const fullyTolled = Array.from({ length: end - start + 1 }, (_value, offset) => (
      options.tollCovered?.[start + offset] === true
    )).every(Boolean)

    let context: RouteRoadPart | undefined
    if (sameSpecificRoad(left, right)) {
      context = left
    } else if (fullyTolled && left?.roadClass === 'EXPRESSWAY') {
      context = left
    } else if (fullyTolled && right?.roadClass === 'EXPRESSWAY') {
      context = right
    } else if (
      !right
      && left?.roadClass === 'EXPRESSWAY'
      && Array.from({ length: end - start + 1 }, (_value, offset) => (
        EXPRESSWAY_CONNECTOR_PATTERN.test(normalizeRoadText(parts[start + offset].roadName))
      )).every(Boolean)
    ) {
      context = left
    }

    if (context) {
      for (let partIndex = start; partIndex <= end; partIndex += 1) {
        parts[partIndex] = inferFromContext(parts[partIndex], context)
      }
    }
    index += 1
  }

  inferContinuousRouteAliases(parts)

  return parts
}

/** 移除指定片段的人工结论，再使用原始道路证据和相邻上下文恢复自动分类。 */
export function restoreAutomaticRoadPartClassification(
  sourceParts: readonly RouteRoadPart[],
  targetIndex: number,
): RouteRoadPart[] {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= sourceParts.length) {
    throw new Error('要恢复的道路片段不存在。')
  }
  const resetParts = sourceParts.map((part, index) => index === targetIndex
    ? (() => {
        const next = {
          ...part,
          roadClass: 'UNKNOWN' as const,
          routeRef: undefined,
          confidence: 'LOW' as const,
          source: 'FALLBACK' as const,
        }
        if (part.provinceSource === 'MANUAL' || part.provinceSource === 'ESTIMATED_SPLIT') {
          delete (next as Partial<RouteRoadPart>).provinceCode
          delete (next as Partial<RouteRoadPart>).provinceName
          delete (next as Partial<RouteRoadPart>).provinceSource
          delete (next as Partial<RouteRoadPart>).provinceStatus
          delete (next as Partial<RouteRoadPart>).provinceCandidates
        }
        return next
      })()
    : { ...part })
  return reclassifyRoadParts(resetParts)
}

/**
 * 只合并相邻、同类别且具有同一有效道路编号的片段；无编号片段不会推断为同一路段。
 * 返回新数组和新对象，不修改调用方传入的数据。
 */
export function mergeAdjacentRoadParts(parts: readonly RouteRoadPart[]): RouteRoadPart[] {
  const merged: RouteRoadPart[] = []

  for (const sourcePart of parts) {
    const part = normalizeRoadPart(sourcePart)
    const routeRef = normalizedPartRouteRef(part)
    const previous = merged[merged.length - 1]
    const previousRouteRef = previous ? normalizedPartRouteRef(previous) : undefined

    if (
      previous
      && routeRef !== undefined
      && previousRouteRef === routeRef
      && previous.roadClass === part.roadClass
      && sameProvinceIdentity(previous, part)
      && previous.source !== 'MANUAL'
      && part.source !== 'MANUAL'
    ) {
      const roadName = previous.roadName || part.roadName
      const tollRoad = previous.tollRoad || part.tollRoad
      const instruction = previous.instruction || part.instruction
      const polyline = appendPolyline(previous.polyline, part.polyline)
      merged[merged.length - 1] = {
        ...previous,
        distanceMeters: previous.distanceMeters + part.distanceMeters,
        ...(roadName ? { roadName } : {}),
        ...(tollRoad ? { tollRoad } : {}),
        ...(instruction ? { instruction } : {}),
        ...(polyline ? { polyline } : {}),
        routeRef,
        confidence: weakerConfidence(previous.confidence, part.confidence),
        source: previous.source === part.source ? previous.source : 'MIXED',
      }
      continue
    }

    merged.push(part)
  }

  return merged
}

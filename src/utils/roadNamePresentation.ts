import { normalizeRoadText } from './roadClassifier.ts'

/** Presentation only: keep original names and road identities untouched. */
export function presentRoadNames(roadNames: readonly string[], routeRef: string | null) {
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
  return { summary: [...names].slice(0, 2).join('、'), conflicts }
}

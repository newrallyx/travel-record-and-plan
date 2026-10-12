import type { RouteRoadPart } from '../types/roadStatistics.ts'
import { calcPolylineDistanceMeters } from './distance.ts'

type Point = [number, number]
const interpolate = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** Overlap in metres, limited to the actual stored corridor, including reversed geometry. */
function overlap(a: Point, b: Point, c: Point, d: Point): [number, number] | undefined {
  if (Math.max(a[0], b[0]) + 0.00004 < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + 0.00004 < Math.min(a[0], b[0])
    || Math.max(a[1], b[1]) + 0.00008 < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + 0.00008 < Math.min(a[1], b[1])) return
  const sx = 111319.49 * Math.cos((a[0] + b[0]) * Math.PI / 360), sy = 111319.49
  const vx = (b[1] - a[1]) * sx, vy = (b[0] - a[0]) * sy
  const wx = (d[1] - c[1]) * sx, wy = (d[0] - c[0]) * sy
  const length2 = vx * vx + vy * vy, otherLength2 = wx * wx + wy * wy
  if (length2 < 1e-8 || otherLength2 < 1e-8 || Math.abs(vx * wx + vy * wy) < Math.sqrt(length2 * otherLength2) * Math.cos(Math.PI / 18)) return
  const at = (p: Point) => (((p[1] - a[1]) * sx) * vx + ((p[0] - a[0]) * sy) * vy) / length2
  const tc = at(c), td = at(d)
  const from = Math.max(0, Math.min(tc, td)), to = Math.min(1, Math.max(tc, td))
  if (to - from < 1e-9) return
  for (const t of [from, to]) {
    const p = interpolate(c, d, (t - tc) / (td - tc)), q = interpolate(a, b, t)
    if (Math.hypot((p[1] - q[1]) * sx, (p[0] - q[0]) * sy) > 2) return
  }
  return [from, to]
}

/** Reanalysis may change step boundaries; split new parts instead of extending old annotations. */
export function preserveConcurrentRoadIntervals(automaticParts: readonly RouteRoadPart[], manualParts: readonly RouteRoadPart[]): RouteRoadPart[] {
  const manualEdges = manualParts.flatMap(part => (part.polyline ?? []).slice(1).map((b, index) => ({ part, a: part.polyline![index], b })))
  return automaticParts.flatMap(part => {
    const points = part.polyline ?? []
    const lengths = points.slice(1).map((b, index) => calcPolylineDistanceMeters([
      { lat: points[index][0], lon: points[index][1] }, { lat: b[0], lon: b[1] },
    ]) ?? 0)
    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (!total) return [{ ...part }]
    const chunks: Array<{ owner?: RouteRoadPart; points: Point[]; length: number }> = []
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index]
      const matches = manualEdges.flatMap(edge => {
        const interval = overlap(a, b, edge.a, edge.b)
        return interval ? [{ from: interval[0], to: interval[1], owner: edge.part }] : []
      })
      const cuts = [...new Set([0, 1, ...matches.flatMap(match => [match.from, match.to])])].sort((x, y) => x - y)
      for (let i = 1; i < cuts.length; i++) {
        const from = cuts[i - 1], to = cuts[i], middle = (from + to) / 2
        const owner = matches.find(match => match.from <= middle && middle <= match.to)?.owner
        const length = lengths[index - 1] * (to - from)
        const start = interpolate(a, b, from), end = interpolate(a, b, to)
        const previous = chunks[chunks.length - 1]
        if (previous && previous.owner === owner) { previous.points.push(end); previous.length += length }
        else chunks.push({ owner, points: [start, end], length })
      }
    }
    // A missing overlap must never transfer a label to a nearby unrelated road.
    if (!chunks.some(chunk => chunk.owner)) return [{ ...part }]
    let allocated = 0
    return chunks.map((chunk, index) => {
      const distanceMeters = index === chunks.length - 1 ? Math.max(0, part.distanceMeters - allocated) : part.distanceMeters * chunk.length / total
      allocated += distanceMeters
      const owner = chunk.owner
      return { ...part, ...(owner ? {
        roadClass: owner.roadClass,
        routeRef: owner.routeRef,
        source: 'MANUAL' as const,
        confidence: 'HIGH' as const,
        concurrentRoads: owner.concurrentRoads?.map(road => ({ ...road })),
        manualDirection: owner.manualDirection,
        manualAnnotationId: owner.manualAnnotationId,
        ...(owner.manualAnnotationId ? { roadName: owner.roadName, originalRoadName: owner.originalRoadName } : {}),
        provinceCode: owner.provinceCode,
        provinceName: owner.provinceName,
        provinceSource: owner.provinceSource,
        provinceStatus: owner.provinceStatus,
        provinceCandidates: owner.provinceCandidates,
      } : {}), polyline: chunk.points, distanceMeters }
    })
  })
}

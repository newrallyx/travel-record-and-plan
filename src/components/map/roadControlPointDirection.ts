import type { RoadDirectionReference } from './roadDirectionReference.ts'

type Position = readonly [number, number]
export interface ControlPointDirectionInterval {
  fromKm: number
  toKm: number
  sign: 1 | -1
  anchors: readonly [string, string]
}
export interface ControlPointDirectionResult {
  distancesKm: number[]
  intervals: ControlPointDirectionInterval[]
}

export function groundDistanceKm(a: Position, b: Position): number {
  return Math.hypot((b[0] - a[0]) * 111.195,
    (b[1] - a[1]) * 111.195 * Math.cos((a[0] + b[0]) * Math.PI / 360))
}

/** Match actual passage order near distinct, ordered control towns, not compass heading.
 * Administrative centres are coarse anchors: only supported intervals are labelled.
 * No interpolation across invalid points, no single-town/endpoint-bearing fallback.
 */
export function inferControlPointDirection(positions: readonly Position[], reference: RoadDirectionReference): ControlPointDirectionResult {
  const distancesKm = [0]
  const valid = (p: Position) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 85 && Math.abs(p[1]) <= 180
  const breaks: number[] = []
  for (let i = 1; i < positions.length; i++) {
    const length = valid(positions[i - 1]) && valid(positions[i]) ? groundDistanceKm(positions[i - 1], positions[i]) : NaN
    // Navigation polylines are dense. Sparse jumps cannot prove a visit near an intermediate town.
    if (!Number.isFinite(length) || length > 5) breaks.push(distancesKm[i - 1])
    distancesKm.push(distancesKm[i - 1] + (Number.isFinite(length) ? length : 0))
  }
  const hits: Array<{ at: number; order: number; name: string; point: Position; radius: number }> = []
  for (const [name, lat, lon, radius, order] of reference.controls) {
    const scaleX = 111.195 * Math.cos(lat * Math.PI / 180)
    let nearest: { at: number; distance: number } | undefined
    const flush = () => {
      if (nearest) hits.push({ at: nearest.at, order, name, point: [lat, lon], radius })
      nearest = undefined
    }
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1], b = positions[i], length = distancesKm[i] - distancesKm[i - 1]
      if (!valid(a) || !valid(b) || length > 5 || !length) { flush(); continue }
      const ax = (a[1] - lon) * scaleX, ay = (a[0] - lat) * 111.195
      const dx = (b[1] - a[1]) * scaleX, dy = (b[0] - a[0]) * 111.195
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
      const distance = Math.hypot(ax + t * dx, ay + t * dy)
      if (distance > radius) { flush(); continue }
      if (!nearest || distance < nearest.distance) nearest = { at: distancesKm[i - 1] + t * length, distance }
    }
    flush()
  }
  hits.sort((a, b) => a.at - b.at || a.order - b.order)
  const visits = hits.filter((h, i) => !i || h.order !== hits[i - 1].order)
  const intervals: ControlPointDirectionInterval[] = []
  for (let i = 1; i < visits.length; i++) {
    const a = visits[i - 1], b = visits[i], span = b.at - a.at
    const separation = groundDistanceKm(a.point, b.point)
    // Do not infer direction from overlapping town circles, a tiny segment, or a large detour.
    if (a.order === b.order || Math.abs(a.order - b.order) > 3 || span < 20
      || separation < a.radius + b.radius || span < separation * 0.65 || span > separation * 5
      || breaks.some((at) => at >= a.at && at <= b.at)) continue
    intervals.push({ fromKm: a.at, toKm: b.at, sign: b.order > a.order ? 1 : -1, anchors: [a.name, b.name] })
  }
  return { distancesKm, intervals }
}

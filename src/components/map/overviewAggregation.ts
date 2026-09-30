import type { RoadClass, RouteRoadPart } from '../../types/roadStatistics.ts'
import type { SegmentTrack } from './types.ts'
import { ROAD_DIRECTION_NAMES, readRoadDestination, oppositeRoadDestination, roadDirectionReferenceKey, roadDisplayName, isRoadConnector } from './roadDirectionNames.ts'
import { inferControlPointDirection, groundDistanceKm } from './roadControlPointDirection.ts'
import { connectorInstructionMetres } from '../../utils/roadConnector.ts'

type XY = { x: number; y: number }
type Edge = { a: XY; b: XY; length: number; sourceIndex?: number; sourceFraction?: number }
type Evidence = { manualDirection?: string; roadClass: RoadClass; routeRef: string; manual: boolean; ramp: boolean; hoverMainline?: boolean; roadName?: string; destination?: string;
  referenceKey?: string; nameSource?: 'text' | 'control-points' | 'manual'; anchors?: readonly [string, string]; destinationConflict?: boolean }
type Visit = Evidence & { from: number; to: number; source: string; start: number; end: number; direction: number; actualA: XY; actualB: XY }
type Representative = Edge & { evidence: Evidence; visits: Visit[] }
export interface OverviewDirection {
  count: number
  /** Geometry is aligned with the parent line; reverse travel follows it backwards. */
  positions: Array<[number, number]>
  destination?: string
}
export interface OverviewLine {
  id: string
  positions: Array<[number, number]>
  count: number
  /** Majority travel direction relative to this line's geometry; zero is ambiguous. */
  flowSign: number
  /** Retain both observed flows even when their majority is tied. */
  flowCounts?: { forward: number; reverse: number }
  /** Original travelled intervals distinguish one passage from a later return. */
  passages?: Array<{ source: string; start: number; end: number; direction: number }>
  mainline: boolean
  firstClassRoad: boolean
  roadClass: RoadClass
  sourceIds: string[]
  routeRef?: string
  roadName?: string
  directionReferenceKey?: string
  directions?: { manualOverride?: boolean; forward: OverviewDirection; reverse: OverviewDirection; conflictingNames?: boolean;
    nameSource?: 'text' | 'control-points' | 'manual'; anchors?: readonly [string, string] }
}

const R = 6378137
const RAD = Math.PI / 180
const CELL = 250
const EPS = 0.001
/** Widest divided-carriageway separation still counted as one driven highway corridor. */
const CORRIDOR_SEPARATION = 200
const UNKNOWN: Evidence = { roadClass: 'UNKNOWN', routeRef: '', manual: false, ramp: false }
const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const distance = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y)
const project = (lat: number, lon: number): XY => ({ x: R * lon * RAD, y: R * Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) })
const unproject = (p: XY): [number, number] => [(2 * Math.atan(Math.exp(p.y / R)) - Math.PI / 2) / RAD, p.x / R / RAD]
const valid = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) < 85 && Math.abs(lon) <= 180
const scaleAt = (edge: Edge) => Math.cosh((edge.a.y + edge.b.y) / (2 * R))
const fraction = (p: XY, edge: Edge) => ((p.x - edge.a.x) * (edge.b.x - edge.a.x) + (p.y - edge.a.y) * (edge.b.y - edge.a.y)) / edge.length ** 2

/** Fixed geographical index: matching does not depend on map zoom or input sampling density. */
class EdgeIndex<T extends Edge> {
  cells = new Map<string, T[]>()
  add(edge: T) {
    this.keys(edge, 0, (key) => {
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(edge)
      else this.cells.set(key, [edge])
    })
  }
  near(edge: Edge, margin: number): T[] {
    const found = new Set<T>()
    this.keys(edge, margin, (key) => this.cells.get(key)?.forEach((item) => found.add(item)))
    return [...found]
  }
  private keys(edge: Edge, margin: number, visit: (key: string) => void) {
    for (let x = Math.floor((Math.min(edge.a.x, edge.b.x) - margin) / CELL); x <= Math.floor((Math.max(edge.a.x, edge.b.x) + margin) / CELL); x++) {
      for (let y = Math.floor((Math.min(edge.a.y, edge.b.y) - margin) / CELL); y <= Math.floor((Math.max(edge.a.y, edge.b.y) + margin) / CELL); y++) visit(`${x},${y}`)
    }
  }
}

function edges(points: readonly (readonly number[])[]): Edge[] {
  const result: Edge[] = []
  for (let i = 1; i < points.length; i++) {
    const [latA, lonA] = points[i - 1], [latB, lonB] = points[i]
    if (!valid(latA, lonA) || !valid(latB, lonB)) continue // Never bridge invalid coordinates.
    const a = project(latA, lonA), b = project(latB, lonB)
    const length = distance(a, b)
    if (length < EPS) continue
    const n = Math.ceil(length / (120 * scaleAt({ a, b, length })))
    for (let j = 0; j < n; j++) result.push({ a: lerp(a, b, j / n), b: lerp(a, b, (j + 1) / n), length: length / n,
      sourceIndex: i - 1, sourceFraction: (j + 0.5) / n })
  }
  return result
}

/** Returns the source interval whose projection lies on the representative. */
function overlap(source: Edge, target: Edge, tolerance: number) {
  const dot = ((source.b.x - source.a.x) * (target.b.x - target.a.x) + (source.b.y - source.a.y) * (target.b.y - target.a.y)) / (source.length * target.length)
  if (Math.abs(dot) < Math.cos(10 * RAD)) return null
  const a = fraction(source.a, target), b = fraction(source.b, target)
  const from = Math.max(0, Math.min((0 - a) / (b - a), (1 - a) / (b - a)))
  const to = Math.min(1, Math.max((0 - a) / (b - a), (1 - a) / (b - a)))
  if ((to - from) * source.length < EPS) return null
  const separation = Math.max(...[from, to].map((t) => {
    const p = lerp(source.a, source.b, t)
    return distance(p, lerp(target.a, target.b, fraction(p, target)))
  }))
  if (separation > tolerance) return null
  return { from, to, separation, direction: Math.sign(dot) }
}

function evidenceFor(part: RouteRoadPart): Evidence {
  const routeRef = (part.routeRef ?? '').toUpperCase().replace(/[\s-]/g, '')
  return {
    roadClass: part.roadClass,
    routeRef,
    roadName: part.roadName,
    destination: part.manualDirection ? (part.manualDirection === 'pending' ? undefined : part.manualDirection) : readRoadDestination(part, routeRef),
    manualDirection: part.manualDirection,
    referenceKey: roadDirectionReferenceKey(part, routeRef),
    nameSource: part.manualDirection ? 'manual' : 'text',
    manual: part.source === 'MANUAL',
    ramp: isRoadConnector(part),
  }
}

function resolveClass(visits: Evidence[]): RoadClass {
  const known = visits.filter((v) => v.roadClass !== 'UNKNOWN')
  const manual = known.filter((v) => v.manual)
  const classes = new Set((manual.length ? manual : known).map((v) => v.roadClass))
  return classes.size === 1 ? [...classes][0] : 'UNKNOWN'
}

/** Attach current road analysis to the original geometry, retaining uncovered sections. */
function attributedEdges(track: SegmentTrack, includeDirections: boolean): Array<Edge & { evidence: Evidence }> {
  const index = new EdgeIndex<Edge & { evidence: Evidence }>()
  for (const part of track.roadParts ?? []) {
    const base = evidenceFor(part)
    const connectorMetres = connectorInstructionMetres(part)
    const partDistances = [0]
    for (let i = 1; i < (part.polyline?.length ?? 0); i++) {
      partDistances.push(partDistances[i - 1] + groundDistanceKm(part.polyline![i - 1], part.polyline![i]) * 1000)
    }
    // Legacy caches may have swallowed many steps into a single part. Restrict
    // their first-step connector label to its documented extent, not a fixed km rule.
    const mergedConnector = base.ramp && base.roadClass === 'EXPRESSWAY' && Boolean(base.routeRef)
      && connectorMetres !== undefined && partDistances[partDistances.length - 1] > connectorMetres * 1.1 + 20
    const reference = ROAD_DIRECTION_NAMES[base.referenceKey ?? '']
    const inferred = includeDirections && reference && !base.manualDirection && !base.ramp && (part.roadClass === 'EXPRESSWAY' || part.roadClass === 'NATIONAL_ROAD')
      ? inferControlPointDirection(part.polyline ?? [], reference) : undefined
    let intervalIndex = 0
    for (const edge of edges(part.polyline ?? [])) {
      let evidence = base
      if (mergedConnector) {
        const i = edge.sourceIndex!, mid = partDistances[i] + (partDistances[i + 1] - partDistances[i]) * edge.sourceFraction!
        evidence = { ...base, hoverMainline: mid > connectorMetres! + 20 }
      }
      if (inferred && reference) {
        const i = edge.sourceIndex!, distances = inferred.distancesKm
        const mid = distances[i] + (distances[i + 1] - distances[i]) * edge.sourceFraction!
        while (intervalIndex < inferred.intervals.length && inferred.intervals[intervalIndex].toKm < mid) intervalIndex++
        const hint = inferred.intervals[intervalIndex]
        if (hint && hint.fromKm <= mid && mid <= hint.toKm) {
          const destination = reference.endpoints[hint.sign > 0 ? 1 : 0]
          const conflict = Boolean(base.destination && base.destination !== destination)
          evidence = { ...base, destination: conflict ? undefined : destination, destinationConflict: conflict,
            nameSource: base.destination ? 'text' : 'control-points', anchors: hint.anchors }
        }
      }
      index.add({ ...edge, evidence })
    }
  }
  const result: Array<Edge & { evidence: Evidence }> = []
  for (const edge of edges(track.line.map((p) => [p.lat, p.lon]))) {
    const candidates = index.near(edge, 2 * scaleAt(edge)).flatMap((part) => {
      const match = overlap(edge, part, 2 * scaleAt(edge))
      return match ? [{ ...match, evidence: { ...part.evidence,
        destination: match.direction > 0 ? part.evidence.destination
          : oppositeRoadDestination(part.evidence.referenceKey ?? part.evidence.routeRef, part.evidence.destination ?? ''),
        anchors: match.direction > 0 || !part.evidence.anchors ? part.evidence.anchors
          : [part.evidence.anchors[1], part.evidence.anchors[0]] as const } }] : []
    })
    const cuts = [...new Set([0, 1, ...candidates.flatMap((c) => [c.from, c.to])])].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i]
      if ((to - from) * edge.length < EPS) continue
      const mid = (from + to) / 2
      const matches = candidates.filter((c) => c.from <= mid && c.to >= mid).sort((a, b) => Number(b.evidence.manual) - Number(a.evidence.manual) || a.separation - b.separation)
      const evidence = matches.length ? { ...matches[0].evidence, roadClass: resolveClass(matches.map((c) => c.evidence)) } : UNKNOWN
      result.push({ a: lerp(edge.a, edge.b, from), b: lerp(edge.a, edge.b, to), length: (to - from) * edge.length, evidence })
    }
  }
  return result
}

function addVisit(rep: Representative, visit: Visit) {
  const previous = rep.visits[rep.visits.length - 1]
  // Adjacent samples are one passage; a reversal or a later return is a new passage.
  if (previous && previous.source === visit.source && previous.direction === visit.direction && Math.abs(previous.end - visit.start) < EPS
    && previous.roadClass === visit.roadClass && previous.manual === visit.manual
    && previous.routeRef === visit.routeRef && previous.destination === visit.destination && previous.ramp === visit.ramp
    && previous.hoverMainline === visit.hoverMainline
    && previous.manualDirection === visit.manualDirection
    && previous.referenceKey === visit.referenceKey && previous.nameSource === visit.nameSource
    && previous.destinationConflict === visit.destinationConflict
    && previous.anchors?.join('|') === visit.anchors?.join('|')
    && visit.from <= previous.to + EPS && visit.to >= previous.from - EPS) {
    if (visit.from < previous.from) previous.actualA = visit.actualA
    if (visit.to > previous.to) previous.actualB = visit.actualB
    previous.from = Math.min(previous.from, visit.from)
    previous.to = Math.max(previous.to, visit.to)
    previous.end = visit.end
  } else rep.visits.push(visit)
}

function sameHighway(a: Evidence, b: Evidence) {
  return (a.roadClass === 'EXPRESSWAY' || a.roadClass === 'NATIONAL_ROAD') && a.roadClass === b.roadClass
    && a.routeRef !== '' && a.routeRef === b.routeRef && !a.ramp && !b.ramp
}

/** Accumulate corridor support across samples, rather than requiring each sample to be long. */
function supportedOffsets(edges: Array<Edge & { evidence: Evidence }>, index: EdgeIndex<Representative>) {
  const supported = new Set<Edge>()
  let run: Edge[] = [], metres = 0, last: XY | undefined, owner = '', direction = 0
  const finish = () => {
    if (metres >= 40) run.forEach((edge) => supported.add(edge))
    run = []; metres = 0
  }
  for (const edge of edges) {
    if (!sameHighway(edge.evidence, edge.evidence)) { finish(); last = undefined; continue }
    const scale = scaleAt(edge)
    const matches = index.near(edge, 25 * scale).flatMap((rep) => {
      if (!sameHighway(edge.evidence, rep.evidence)) return []
      const match = overlap(edge, rep, 25 * scale)
      return match ? [{ ...match, owner: rep.visits[0].source }] : []
    }).sort((a, b) => a.separation - b.separation)
    const cuts = [...new Set([0, 1, ...matches.flatMap((m) => [m.from, m.to])])].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i]
      if ((to - from) * edge.length < EPS) continue
      const mid = (from + to) / 2, match = matches.find((m) => m.from <= mid && m.to >= mid)
      if (!match) { finish(); last = undefined; continue }
      const a = lerp(edge.a, edge.b, from), b = lerp(edge.a, edge.b, to)
      if (!last || distance(last, a) > EPS || owner !== match.owner || direction !== match.direction) finish()
      run.push(edge); metres += (to - from) * edge.length / scale
      last = b; owner = match.owner; direction = match.direction
    }
  }
  finish()
  return supported
}

export const OVERVIEW_COUNT_BANDS = [1, 2, 4, 8, 16] as const
export const OVERVIEW_COUNT_LABELS = ['1 次', '2–3 次', '4–7 次', '8–15 次', '16 次以上'] as const
export function overviewLineWeight(count: number, zoom: number) {
  const band = count >= 16 ? 4 : count >= 8 ? 3 : count >= 4 ? 2 : count >= 2 ? 1 : 0
  return (2 + band * 1.25) * (1 + Math.max(0, Math.min(1, (zoom - 6) / 8)) * 0.45)
}

/** Pure display derivation. No writes, route planning or changes to distance statistics. */
export function aggregateOverviewTracks(tracks: readonly SegmentTrack[], includeDirections = true): OverviewLine[] {
  const index = new EdgeIndex<Representative>()
  const representatives: Representative[] = []
  // Stable representative geometry even when async cache loading changes input order.
  for (const track of [...tracks].sort((a, b) => a.segmentId.localeCompare(b.segmentId))) {
    const sourceEdges = attributedEdges(track, includeDirections)
    const offsetSupport = supportedOffsets(sourceEdges, index)
    let travelled = 0
    let previousEnd: XY | undefined
    for (let edgeIndex = 0; edgeIndex < sourceEdges.length; edgeIndex++) {
      const edge = sourceEdges[edgeIndex]
      if (previousEnd && distance(previousEnd, edge.a) > EPS) travelled += 1 // Break passage continuity across gaps.
      previousEnd = edge.b
      const scale = scaleAt(edge)
      const nearby = index.near(edge, 25 * scale)
      // An outbound and inbound carriageway can also occur inside a single recorded polyline.
      if (!offsetSupport.has(edge) && nearby.some((rep) => rep.visits[0].source === track.segmentId && sameHighway(edge.evidence, rep.evidence)
        && overlap(edge, rep, 25 * scale) && !overlap(edge, rep, 2 * scale))) {
        let start = edgeIndex, end = edgeIndex, length = 0
        while (start > 0 && length < 100 * scale) length += sourceEdges[--start].length
        length = 0
        while (end + 1 < sourceEdges.length && length < 100 * scale) length += sourceEdges[++end].length
        supportedOffsets(sourceEdges.slice(start, end + 1), index).forEach((supported) => offsetSupport.add(supported))
      }
      const matches = nearby.flatMap((rep) => {
        if ((edge.evidence.roadClass === 'EXPRESSWAY' || edge.evidence.roadClass === 'NATIONAL_ROAD')
          && edge.evidence.roadClass === rep.evidence.roadClass && edge.evidence.routeRef && rep.evidence.routeRef
          && edge.evidence.routeRef !== rep.evidence.routeRef) return []
        const wide = offsetSupport.has(edge) && sameHighway(edge.evidence, rep.evidence)
        const match = overlap(edge, rep, (wide ? 25 : 2) * scale)
        if (!match) return []
        return [{ ...match, rep }]
      }).sort((a, b) => a.separation - b.separation)
      const cuts = [...new Set([0, 1, ...matches.flatMap((m) => [m.from, m.to])])].sort((a, b) => a - b)
      for (let i = 1; i < cuts.length; i++) {
        const from = cuts[i - 1], to = cuts[i]
        if ((to - from) * edge.length < EPS) continue
        const middle = (from + to) / 2
        const match = matches.find((m) => m.from <= middle && m.to >= middle)
        const a = lerp(edge.a, edge.b, from), b = lerp(edge.a, edge.b, to)
        const rep = match?.rep ?? { a, b, length: distance(a, b), evidence: edge.evidence, visits: [] }
        const p = Math.max(0, Math.min(1, fraction(a, rep))), q = Math.max(0, Math.min(1, fraction(b, rep)))
        addVisit(rep, { ...edge.evidence, from: Math.min(p, q), to: Math.max(p, q), source: track.segmentId,
          start: travelled + from * edge.length, end: travelled + to * edge.length, direction: match?.direction ?? 1,
          actualA: p <= q ? a : b, actualB: p <= q ? b : a })
        if (!match) { representatives.push(rep); index.add(rep) }
      }
      travelled += edge.length
    }
  }
  const lines: OverviewLine[] = []
  for (const rep of representatives) {
    const cuts = [...new Set(rep.visits.flatMap((v) => [v.from, v.to]))].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1], to = cuts[i]
      if ((to - from) * rep.length < EPS) continue
      const middle = (from + to) / 2
      const visits = rep.visits.filter((v) => v.from <= middle && v.to >= middle)
      if (!visits.length) continue
      const positions: Array<[number, number]> = [unproject(lerp(rep.a, rep.b, from)), unproject(lerp(rep.a, rep.b, to))]
      const roadClass = resolveClass(visits)
      const refs = [...new Set(visits.map((v) => v.routeRef).filter(Boolean))]
      const routeRef = refs.length === 1 ? refs[0] : undefined
      const referenceKeys = [...new Set(visits.map((v) => v.referenceKey))]
      const referenceKey = referenceKeys.length === 1 ? referenceKeys[0] : undefined
      const directional = includeDirections && (roadClass === 'EXPRESSWAY' || roadClass === 'NATIONAL_ROAD')
        && visits.every((v) => !v.ramp && v.roadClass === roadClass) && refs.length === 1
      const getDirection = (sign: number): OverviewDirection => {
        const selected = visits.filter((v) => v.direction === sign)
        const sample = selected[0]
        return { count: selected.length, positions: sample
          ? [from, to].map((t) => unproject(lerp(sample.actualA, sample.actualB, (t - sample.from) / (sample.to - sample.from))))
          : positions }
      }
      const manualVisits = visits.filter((v) => v.manualDirection)
      const namingVisits = manualVisits.length ? manualVisits : visits
      const pendingDirection = manualVisits.some((v) => v.manualDirection === 'pending')
      const forwardNames = new Set((pendingDirection ? [] : namingVisits).flatMap((v) => {
        const name = v.direction > 0 ? v.destination : oppositeRoadDestination(referenceKey ?? routeRef ?? '', v.destination ?? '')
        return name ? [name] : []
      }))
      const forward = getDirection(1), reverse = getDirection(-1)
      const anchorVisit = visits.find((v) => v.anchors)
      const anchors = anchorVisit?.anchors && anchorVisit.direction < 0
        ? [anchorVisit.anchors[1], anchorVisit.anchors[0]] as const : anchorVisit?.anchors
      if (forwardNames.size === 1) {
        forward.destination = [...forwardNames][0]
        reverse.destination = oppositeRoadDestination(referenceKey ?? routeRef ?? '', forward.destination)
      }
      lines.push({ id: `${lines.length}`, positions, count: visits.length, roadClass,
        passages: visits.map(v => {
          const at = (t: number) => v.start + (v.direction > 0 ? t - v.from : v.to - t) / (v.to - v.from) * (v.end - v.start)
          return { source: v.source, start: Math.min(at(from), at(to)), end: Math.max(at(from), at(to)), direction: v.direction }
        }),
        flowSign: Math.sign(visits.reduce((sum, visit) => sum + visit.direction, 0)),
        flowCounts: { forward: forward.count, reverse: reverse.count },
        mainline: visits.filter((visit) => !visit.ramp || visit.hoverMainline).length > visits.length / 2,
        firstClassRoad: visits.some((visit) => /一级公路/.test(visit.roadName ?? '')),
        sourceIds: [...new Set(visits.map((v) => v.source))].sort(),
        routeRef, roadName: roadDisplayName(referenceKey ?? routeRef ?? '', roadClass, visits.find((v) => v.roadName)?.roadName),
        ...(directional ? { directionReferenceKey: referenceKey,
          directions: { forward, reverse, manualOverride: manualVisits.length > 0, conflictingNames: forwardNames.size > 1 || visits.some((v) => v.destinationConflict),
            nameSource: manualVisits.length ? 'manual' : visits.some((v) => v.destination && v.nameSource === 'text') ? 'text'
              : visits.some((v) => v.destination && v.nameSource === 'control-points') ? 'control-points' : undefined,
            anchors } } : {}) })
    }
  }
  if (includeDirections) propagateDirectionNames(lines)
  return joinLines(lines)
}

/** Look up the opposite carriageway at the cursor position, without changing stored passage counts. */
function passageTotal(lines: OverviewLine[], alignment: number) {
  if (lines.some(line => !line.passages)) return lines.reduce((sum, line) => sum + line.count, 0)
  const bySource = new Map<string, Array<{ start: number; end: number }>>()
  for (const [i, line] of lines.entries()) for (const passage of line.passages!) {
    const key = `${passage.source}:${passage.direction * (i === 0 ? 1 : alignment)}`
    const events = bySource.get(key) ?? []
    events.push(passage); bySource.set(key, events)
  }
  let total = 0
  for (const events of bySource.values()) {
    events.sort((a, b) => a.start - b.start || a.end - b.end)
    let end = -Infinity
    for (const event of events) {
      // Adjacent pieces in the same travel direction are one event. Reversals
      // have separate direction keys; a later loop has a disjoint travelled interval.
      // Match the one-metre display simplification tolerance at fragmented ends.
      if (event.start > end + 1) total++
      end = Math.max(end, event.end)
    }
  }
  return total
}

type LineEdge = Edge & { line: OverviewLine }

/** Evenly spaced line samples, keeping every edge for short lines. */
function corridorSamples(lineEdges: LineEdge[]): XY[] {
  if (lineEdges.length <= 24) return lineEdges.map((edge) => lerp(edge.a, edge.b, 0.5))
  return Array.from({ length: 24 }, (_, i) => {
    const edge = lineEdges[Math.round((i + 0.5) * lineEdges.length / 24)]
    return lerp(edge.a, edge.b, 0.5)
  })
}

export function createOverviewHoverIndex(lines: readonly OverviewLine[]) {
  const index = new EdgeIndex<LineEdge>()
  const identity = (line: OverviewLine) => line.routeRef
    || (line.firstClassRoad && line.roadName !== '一级公路' ? line.roadName : undefined)
  const eligible = (line: OverviewLine) => line.mainline && Boolean(identity(line))
    && (line.roadClass === 'EXPRESSWAY' || line.roadClass === 'NATIONAL_ROAD' || line.firstClassRoad)
  const edges = new Map<OverviewLine, LineEdge[]>()
  for (const line of lines) {
    if (!eligible(line)) continue
    const lineEdges: LineEdge[] = []
    for (let i = 1; i < line.positions.length; i++) {
      const a = project(...line.positions[i - 1]), b = project(...line.positions[i])
      const length = distance(a, b)
      if (length < EPS) continue
      const edge = { a, b, length, line }
      lineEdges.push(edge); index.add(edge)
    }
    edges.set(line, lineEdges)
  }
  const sameRoadAs = (line: OverviewLine) => (other: OverviewLine) => other.roadClass === line.roadClass
    && identity(other) === identity(line)
  // Both carriageways of one driven highway can keep separate representatives well beyond the
  // 25 m merge distance, so pair each line with its mutual nearest neighbour. A parallel road of
  // the same number can never pull in an unrelated carriageway through such a chain.
  const nearestSameRoad = new Map<OverviewLine, OverviewLine>()
  for (const line of edges.keys()) {
    const sameRoad = sameRoadAs(line), samples = corridorSamples(edges.get(line)!)
    let best: OverviewLine | undefined, bestDistance = Infinity
    for (const point of samples) {
      const scale = Math.cosh(point.y / R)
      for (const candidate of index.near({ a: point, b: point, length: 0 }, CORRIDOR_SEPARATION * scale)) {
        if (candidate.line === line || !sameRoad(candidate.line)) continue
        const t = fraction(point, candidate)
        if (t < 0 || t > 1) continue
        const separation = distance(point, lerp(candidate.a, candidate.b, t))
        if (separation < bestDistance) { bestDistance = separation; best = candidate.line }
      }
    }
    if (best && bestDistance > EPS) nearestSameRoad.set(line, best)
  }
  return (line: OverviewLine, position: [number, number]) => {
    if (!eligible(line)) return line.count
    const point = project(...position)
    let source: LineEdge | undefined, sourcePoint: XY | undefined, sourceDistance = Infinity
    for (const edge of edges.get(line) ?? []) {
      const p = lerp(edge.a, edge.b, Math.max(0, Math.min(1, fraction(point, edge))))
      const d = distance(point, p)
      if (d < sourceDistance) { sourceDistance = d; source = edge; sourcePoint = p }
    }
    if (!source || !sourcePoint) return line.count
    const scale = scaleAt(source)
    const sameRoad = (other: OverviewLine) => other.roadClass === line.roadClass && identity(other) === identity(line)
    const geometryDot = (a: LineEdge, b: LineEdge) => ((a.b.x - a.a.x) * (b.b.x - b.a.x)
      + (a.b.y - a.a.y) * (b.b.y - b.a.y)) / (a.length * b.length)
    const flows = (line: OverviewLine) => line.flowCounts ?? {
      forward: line.flowSign > 0 ? line.count : 0, reverse: line.flowSign < 0 ? line.count : 0,
    }
    const oppositeFlows = (a: LineEdge, b: LineEdge) => {
      const dot = geometryDot(a, b), x = flows(a.line), y = flows(b.line)
      if (Math.abs(dot) < Math.cos(10 * RAD)) return false
      return dot > 0 ? (x.forward > 0 && y.reverse > 0) || (x.reverse > 0 && y.forward > 0)
        : (x.forward > 0 && y.forward > 0) || (x.reverse > 0 && y.reverse > 0)
    }
    // Divided highways can keep their carriageways farther apart than the local window, so the
    // band widens to the measured separation. Inside it the opposite carriageway must still run
    // beside this range for a real stretch: a crossing or a parallel road of the same number
    // shares no such band.
    const bandSupport = (edge: LineEdge, anchor: XY, separation: number) => {
      // Match the one-metre display/projection tolerance at the measured band boundary.
      const radius = Math.max(80 * scale, separation * 1.5), band = Math.max(50 * scale, separation + scale)
      const t = fraction(anchor, edge)
      const start = Math.max(0, t - radius / edge.length), end = Math.min(1, t + radius / edge.length)
      if (end <= start) return false
      const sample = { a: lerp(edge.a, edge.b, start), b: lerp(edge.a, edge.b, end), length: (end - start) * edge.length }
      const intervals = index.near(sample, band).flatMap(other => {
        if (!sameRoad(other.line) || !oppositeFlows(edge, other)) return []
        const match = overlap(sample, other, band)
        return match ? [match] : []
      }).sort((a, b) => a.from - b.from)
      let metres = 0, coveredTo = 0
      for (const interval of intervals) {
        metres += Math.max(0, interval.to - Math.max(coveredTo, interval.from)) * sample.length / scale
        coveredTo = Math.max(coveredTo, interval.to)
      }
      return metres >= 40
    }
    // Count boundaries and bends can split a carriageway into arbitrarily short edges.
    // Measure corridor support over connected samples, never impose a minimum sample length.
    const hasCorridorSupport = (origin: LineEdge, point: XY) => {
      const local = index.near({ a: point, b: point, length: 0 }, 100 * scale)
        .filter(edge => sameRoad(edge.line) && Math.abs(geometryDot(origin, edge)) >= Math.cos(10 * RAD))
      const connected = new Set<LineEdge>([origin]), queue = [origin]
      let metres = 0
      for (const edge of queue) {
        const t = fraction(point, edge), radius = 80 * scale / edge.length
        const start = Math.max(0, t - radius), end = Math.min(1, t + radius)
        if (end <= start) continue
        const sample = { a: lerp(edge.a, edge.b, start), b: lerp(edge.a, edge.b, end), length: (end - start) * edge.length }
        const intervals = index.near(sample, 50 * scale).flatMap(other => {
          if (!sameRoad(other.line) || !oppositeFlows(edge, other)) return []
          const match = overlap(sample, other, 50 * scale)
          return match ? [match] : []
        }).sort((a, b) => a.from - b.from)
        let coveredTo = 0
        for (const interval of intervals) {
          metres += Math.max(0, interval.to - Math.max(coveredTo, interval.from)) * sample.length / scale
          coveredTo = Math.max(coveredTo, interval.to)
        }
        if (metres >= 40) return true
        for (const next of local) {
          if (connected.has(next)) continue
          // Aggregation can snap a carriageway onto a representative up to 25 m away.
          // Allow that transition only along a shared recorded route.
          const tolerance = edge.line.sourceIds.some(id => next.line.sourceIds.includes(id)) ? 25 * scale : EPS
          if ([edge.a, edge.b].some(p => [next.a, next.b].some(q => distance(p, q) < tolerance))) {
            connected.add(next); queue.push(next)
          }
        }
      }
      return false
    }
    let opposite: LineEdge | undefined, oppositePoint: XY | undefined, nearest = Infinity
    const nearby = index.near({ a: sourcePoint, b: sourcePoint, length: 0 }, 50 * scale)
    // Two representatives of one recorded route can sit on the same geometry, where opposite flow
    // cannot be told apart. They are paired from the shared recorded route instead. A representative
    // can also be snapped this far from the geometry it was recorded on, so the window matches that.
    const sharesRecordedRoute = (point: XY, edge: LineEdge) =>
      distance(point, lerp(edge.a, edge.b, Math.max(0, Math.min(1, fraction(point, edge))))) <= 25 * scale
      && line.sourceIds.some(id => edge.line.sourceIds.includes(id))
    for (const candidate of nearby) {
      const other = candidate.line
      if (other === line || other.roadClass !== line.roadClass || identity(other) !== identity(line)) continue
      if (!oppositeFlows(source, candidate)) continue
      // Require coverage at the cursor, not merely somewhere along the source line.
      const t = fraction(sourcePoint, candidate)
      // One metre covers display simplification and tiny projection gaps at bends.
      if (t < -scale / candidate.length || t > 1 + scale / candidate.length) continue
      const p = lerp(candidate.a, candidate.b, Math.max(0, Math.min(1, t)))
      const separation = distance(sourcePoint, p)
      if (separation <= 2 * scale || separation > 50 * scale || separation >= nearest) continue
      nearest = separation; opposite = candidate; oppositePoint = p
    }
    // One recorded route can stay on two representatives of the same geometry, where opposite
    // flow cannot decide the pair. The shared recording does, and passageTotal still counts each
    // traversal once, so such a pair can never double a total. Representatives that sit on the very
    // same geometry are equidistant, so every one of them is kept and the pair whose passages add up
    // to the most traversals wins: merging the richest piece can never show less than merging another.
    let ownRouteDistance = Infinity, ownRouteEdges: LineEdge[] = []
    for (const candidate of nearby) {
      if (candidate.line === line || !sameRoad(candidate.line)) continue
      if (Math.abs(geometryDot(source, candidate)) < Math.cos(10 * RAD)) continue
      if (!sharesRecordedRoute(sourcePoint, candidate)) continue
      const t = fraction(sourcePoint, candidate)
      if (t < -scale / candidate.length || t > 1 + scale / candidate.length) continue
      const separation = distance(sourcePoint, lerp(candidate.a, candidate.b, Math.max(0, Math.min(1, t))))
      if (separation < ownRouteDistance - EPS) { ownRouteDistance = separation; ownRouteEdges = [candidate] }
      else if (separation <= ownRouteDistance + EPS) ownRouteEdges.push(candidate)
    }
    // Shared recordings only deduplicate locally aligned pieces of the same road.
    // A recording alone is not road identity: it can traverse multiple nearby roads.
    const mergedTotal = (a: LineEdge, b: LineEdge) => Math.max(line.count, b.line.count,
      passageTotal([line, b.line], Math.sign(geometryDot(a, b))))
    let ownRouteEdge: LineEdge | undefined, ownRouteBest = -1
    for (const candidate of ownRouteEdges) {
      const total = mergedTotal(source, candidate)
      if (total > ownRouteBest) { ownRouteBest = total; ownRouteEdge = candidate }
    }
    // Wider corridors use the mutual nearest neighbour of this road, which cannot chain through a
    // parallel road. It covers carriageways farther apart than the local 50 m window.
    let pairedByCorridor = false
    const peerLine = nearestSameRoad.get(line)
    const peerEdges = peerLine && nearestSameRoad.size && nearestSameRoad.get(peerLine) === line ? edges.get(peerLine) : undefined
    // A shared recorded route is evidence at the cursor itself and outranks the corridor guess.
    let corridorDistance = Infinity
    for (const corridorEdge of !opposite ? (ownRouteEdge ? [ownRouteEdge] : peerEdges ?? []) : []) {
      if (corridorEdge !== ownRouteEdge && !oppositeFlows(source, corridorEdge)) continue
      const t = fraction(sourcePoint, corridorEdge)
      const anchor = lerp(corridorEdge.a, corridorEdge.b, Math.max(0, Math.min(1, t)))
      // Require coverage at the cursor: a carriageway that ends before this range never lends
      // its counts to it, and its own band ends with it.
      const covered = t >= -scale / corridorEdge.length && t <= 1 + scale / corridorEdge.length
      const separation = distance(sourcePoint, anchor)
      if (separation > CORRIDOR_SEPARATION * scale || separation >= corridorDistance) continue
      if (covered && (ownRouteEdge === corridorEdge
        || bandSupport(source, anchor, separation) || bandSupport(corridorEdge, anchor, separation))) {
        opposite = corridorEdge; oppositePoint = anchor; pairedByCorridor = true
        corridorDistance = separation
      }
    }
    // A shared recorded route at the cursor is the same physical corridor, so it replaces a local
    // opposite-flow match whenever it carries more traversals. Both totals count each traversal once,
    // so this only moves the displayed figure up to the combined one.
    if (ownRouteEdge && opposite !== ownRouteEdge && ownRouteBest > (opposite && oppositePoint
      ? mergedTotal(source, opposite) : line.count)) {
      opposite = ownRouteEdge
      oppositePoint = lerp(ownRouteEdge.a, ownRouteEdge.b, Math.max(0, Math.min(1, fraction(sourcePoint, ownRouteEdge))))
      pairedByCorridor = true
    }
    // Two carriageways that sit a couple of metres apart, or just outside the local window, keep
    // separate representatives. Pair the nearest opposite-flow line only where its geometry really
    // runs beside this range for a stretch, which a crossing or a same-number parallel road cannot do.
    if (!opposite || !oppositePoint) {
      let besideEdge: LineEdge | undefined, besideDistance = Infinity
      for (const candidate of nearby) {
        const other = candidate.line
        if (other === line || other.roadClass !== line.roadClass || identity(other) !== identity(line)) continue
        if (!oppositeFlows(source, candidate)) continue
        const t = fraction(sourcePoint, candidate)
        if (t < -scale / candidate.length || t > 1 + scale / candidate.length) continue
        const p = lerp(candidate.a, candidate.b, Math.max(0, Math.min(1, t)))
        const separation = distance(sourcePoint, p)
        if (separation > 50 * scale || separation >= besideDistance) continue
        besideDistance = separation; besideEdge = candidate
      }
      if (besideEdge) {
        const t = fraction(sourcePoint, besideEdge)
        const anchor = lerp(besideEdge.a, besideEdge.b, Math.max(0, Math.min(1, t)))
        const separation = distance(sourcePoint, anchor)
        if (bandSupport(source, anchor, separation)) {
          opposite = besideEdge; oppositePoint = anchor; pairedByCorridor = true
        }
      }
    }
    if (!opposite || !oppositePoint) return line.count
    if (!pairedByCorridor) {
      // Use a deterministic cross-section of the shared edges. Re-projecting the
      // cursor from each side shifts the 40 m support window at bends and thresholds.
      const [axis, peer] = line.id.localeCompare(opposite.line.id) < 0 ? [source, opposite] : [opposite, source]
      const fa = fraction(peer.a, axis), fb = fraction(peer.b, axis)
      const from = Math.max(0, Math.min(fa, fb)), to = Math.min(1, Math.max(fa, fb))
      const anchor = lerp(axis.a, axis.b, (from + to) / 2)
      const peerAnchor = lerp(peer.a, peer.b, Math.max(0, Math.min(1, fraction(anchor, peer))))
      if (!hasCorridorSupport(axis, anchor) && !hasCorridorSupport(peer, peerAnchor)) return line.count
    }
    return Math.max(line.count, opposite.line.count,
      passageTotal([line, opposite.line], Math.sign(geometryDot(source, opposite))))
  }
}

const endpointKey = (p: [number, number]) => `${p[0].toFixed(8)},${p[1].toFixed(8)}`

/** Transfer explicit anchors only along unambiguous, connected, same-road chains.
 * No endpoint-distance heuristics, no jumps over gaps, no propagation through forks.
 */
function propagateDirectionNames(lines: OverviewLine[]) {
  const nodes = new Map<string, Array<{ index: number; end: number }>>()
  lines.forEach((line, index) => {
    if (!line.directions || !line.routeRef) return
    line.positions.forEach((p, end) => {
      const key = `${line.roadClass}:${line.directionReferenceKey ?? line.routeRef}:${endpointKey(p)}`
      const node = nodes.get(key) ?? []
      node.push({ index, end }); nodes.set(key, node)
    })
  })
  const seen = new Set<number>()
  lines.forEach((root, index) => {
    if (!root.directions || root.directions.manualOverride || !root.routeRef || seen.has(index)) return
    const chain = [{ index, sign: 1, startKm: 0 }], names = new Set<string>()
    seen.add(index)
    let conflict = false
    for (let cursor = 0; cursor < chain.length; cursor++) {
      const item = chain[cursor], line = lines[item.index], dirs = line.directions!
      conflict ||= Boolean(dirs.conflictingNames)
      const destination = item.sign > 0 ? dirs.forward.destination : dirs.reverse.destination
      if (destination && dirs.nameSource === 'text') names.add(destination)
      line.positions.forEach((p, end) => {
        const neighbors = nodes.get(`${line.roadClass}:${line.directionReferenceKey ?? line.routeRef}:${endpointKey(p)}`) ?? []
        if (neighbors.length !== 2) return
        const next = neighbors.find((n) => n.index !== item.index)
        if (!next || seen.has(next.index) || lines[next.index].directions?.manualOverride) return
        seen.add(next.index)
        const sign = item.sign * (end === next.end ? -1 : 1)
        const at = item.startKm + item.sign * end * groundDistanceKm(line.positions[0], line.positions[1])
        const nextLine = lines[next.index]
        chain.push({ index: next.index, sign, startKm: at - sign * next.end * groundDistanceKm(nextLine.positions[0], nextLine.positions[1]) })
      })
    }
    conflict ||= names.size > 1
    if (!conflict && !names.size) {
      const reference = ROAD_DIRECTION_NAMES[root.directionReferenceKey ?? '']
      if (!reference) return
      // Recover the physical order of a degree-two chain across cache/analysis boundaries.
      const ordered = chain.map((item) => ({ ...item,
        lowKm: item.startKm + Math.min(0, item.sign * groundDistanceKm(lines[item.index].positions[0], lines[item.index].positions[1])) }))
        .sort((a, b) => a.lowKm - b.lowKm)
      const points: Array<[number, number]> = []
      for (const item of ordered) {
        const p = lines[item.index].positions
        const start = p[item.sign > 0 ? 0 : 1], end = p[item.sign > 0 ? 1 : 0]
        if (points.length && endpointKey(points[points.length - 1]) !== endpointKey(start)) return
        if (!points.length) points.push(start)
        points.push(end)
      }
      // A closed physical loop does not define a unique start/end direction.
      if (endpointKey(points[0]) === endpointKey(points[points.length - 1])) return
      const inferred = inferControlPointDirection(points, reference)
      let cursor = 0
      for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i], dirs = lines[item.index].directions!
        const mid = (inferred.distancesKm[i] + inferred.distancesKm[i + 1]) / 2
        while (cursor < inferred.intervals.length && inferred.intervals[cursor].toKm < mid) cursor++
        const hint = inferred.intervals[cursor]
        if (!hint || mid < hint.fromKm || mid > hint.toKm) continue
        const destination = reference.endpoints[hint.sign * item.sign > 0 ? 1 : 0]
        if (dirs.forward.destination && dirs.forward.destination !== destination) {
          dirs.forward.destination = undefined; dirs.reverse.destination = undefined
          dirs.conflictingNames = true; dirs.nameSource = undefined
        } else {
          dirs.forward.destination = destination
          dirs.reverse.destination = oppositeRoadDestination(root.directionReferenceKey!, destination)
          dirs.nameSource = 'control-points'
          dirs.anchors = item.sign > 0 ? hint.anchors : [hint.anchors[1], hint.anchors[0]]
        }
      }
      return
    }
    if (names.size === 1) {
      const expected = [...names][0]
      conflict ||= chain.some((item) => {
        const dirs = lines[item.index].directions!
        const destination = item.sign > 0 ? dirs.forward.destination : dirs.reverse.destination
        return Boolean(destination && destination !== expected)
      })
    }
    const name = !conflict && names.size === 1 ? [...names][0] : undefined
    for (const item of chain) {
      const dirs = lines[item.index].directions!
      dirs.forward.destination = item.sign > 0 ? name : oppositeRoadDestination(root.directionReferenceKey ?? root.routeRef, name ?? '')
      dirs.reverse.destination = item.sign < 0 ? name : oppositeRoadDestination(root.directionReferenceKey ?? root.routeRef, name ?? '')
      dirs.nameSource = name ? 'text' : undefined
      dirs.conflictingNames = conflict
    }
  })
}

/** Join only actual shared endpoints, equal attributes and degree-two nodes; never bridge gaps or forks. */
function joinLines(lines: OverviewLine[]): OverviewLine[] {
  const key = (p: [number, number]) => `${p[0].toFixed(8)},${p[1].toFixed(8)}`
  const endpoints = new Map<string, number[]>()
  lines.forEach((line, i) => line.positions.forEach((p) => {
    const k = key(p), bucket = endpoints.get(k)
    if (bucket) bucket.push(i)
    else endpoints.set(k, [i])
  }))
  const used = new Set<number>(), result: OverviewLine[] = []
  lines.forEach((line, i) => {
    if (used.has(i)) return
    used.add(i)
    const positions = [...line.positions]
    let passages = line.passages?.map(p => ({ ...p }))
    const directions = line.directions ? {
      ...line.directions,
      forward: { ...line.directions.forward, positions: [...line.directions.forward.positions] },
      reverse: { ...line.directions.reverse, positions: [...line.directions.reverse.positions] },
    } : undefined
    for (const forward of [true, false]) {
      while (true) {
        const end = forward ? positions[positions.length - 1] : positions[0]
        const neighbors = endpoints.get(key(end)) ?? []
        if (neighbors.length !== 2) break
        const next = neighbors.find((j) => !used.has(j))
        if (next === undefined) break
        const candidate = lines[next]
        const sharesStart = key(candidate.positions[0]) === key(end)
        const aligned = forward === sharesStart
        const candidateFlows = candidate.flowCounts
        if (line.flowCounts && candidateFlows && (line.flowCounts.forward !== (aligned ? candidateFlows.forward : candidateFlows.reverse)
          || line.flowCounts.reverse !== (aligned ? candidateFlows.reverse : candidateFlows.forward))) break
        if (candidate.count !== line.count || candidate.flowSign * (aligned ? 1 : -1) !== line.flowSign
          || candidate.mainline !== line.mainline || candidate.firstClassRoad !== line.firstClassRoad
          || candidate.roadClass !== line.roadClass || candidate.sourceIds.join('|') !== line.sourceIds.join('|')) break
        let joinedPassages = passages
        if (passages && candidate.passages) {
          const remaining = new Set(candidate.passages)
          joinedPassages = []
          for (const p of passages) {
            const q = [...remaining].find(q => q.source === p.source && q.direction * (aligned ? 1 : -1) === p.direction
              && Math.min(Math.abs(p.end - q.start), Math.abs(q.end - p.start)) < EPS)
            if (!q) break
            remaining.delete(q)
            joinedPassages.push({ ...p, start: Math.min(p.start, q.start), end: Math.max(p.end, q.end) })
          }
          if (remaining.size) break
        }
        const candidateDirections = candidate.directions
        if (Boolean(directions) !== Boolean(candidateDirections) || candidate.routeRef !== line.routeRef
          || candidate.directionReferenceKey !== line.directionReferenceKey) break
        if (directions && candidateDirections) {
          const a = aligned ? candidateDirections.forward : candidateDirections.reverse
          const b = aligned ? candidateDirections.reverse : candidateDirections.forward
          if (candidateDirections.manualOverride !== directions.manualOverride || a.count !== directions.forward.count || b.count !== directions.reverse.count
            || a.destination !== directions.forward.destination || b.destination !== directions.reverse.destination
            || candidateDirections.nameSource !== directions.nameSource
            || candidateDirections.anchors?.join('|') !== directions.anchors?.join('|')
            || candidateDirections.conflictingNames !== directions.conflictingNames) break
          // Retain actual carriageway geometry and do not bridge discontinuous samples.
          const canJoin = [a, b].every((d, j) => {
            if (!d.count) return true
            const current = j === 0 ? directions.forward.positions : directions.reverse.positions
            const p = current[forward ? current.length - 1 : 0]
            const q = d.positions[sharesStart ? 0 : 1]
            return distance(project(...p), project(...q)) < scaleAt(repEdge(p, q))
          })
          if (!canJoin) break
          for (const [dest, source] of [[directions.forward, a], [directions.reverse, b]]) {
            const p = source.positions[sharesStart ? 1 : 0]
            if (forward) dest.positions.push(p)
            else dest.positions.unshift(p)
          }
        }
        used.add(next)
        passages = joinedPassages
        const p = candidate.positions[key(candidate.positions[0]) === key(end) ? 1 : 0]
        if (forward) positions.push(p)
        else positions.unshift(p)
      }
    }
    result.push({ ...line, passages, positions: simplifyDisplay(positions), ...(directions ? { directions } : {}) })
  })
  return result
}

function repEdge(a: [number, number], b: [number, number]): Edge {
  const p = project(...a), q = project(...b)
  return { a: p, b: q, length: distance(p, q) }
}

/** One-metre display simplification AFTER matching; count/class/fork endpoints are retained. */
function simplifyDisplay(positions: Array<[number, number]>): Array<[number, number]> {
  if (positions.length < 3) return positions
  const points = positions.map(([lat, lon]) => project(lat, lon))
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    const edge = { a: points[start], b: points[end], length: distance(points[start], points[end]) }
    let furthest = -1, maximum = scaleAt(edge)
    for (let i = start + 1; i < end; i++) {
      const t = edge.length > EPS ? Math.max(0, Math.min(1, fraction(points[i], edge))) : 0
      const d = distance(points[i], lerp(edge.a, edge.b, t))
      if (d > maximum) { maximum = d; furthest = i }
    }
    if (furthest >= 0) { keep.add(furthest); stack.push([start, furthest], [furthest, end]) }
  }
  return [...keep].sort((a, b) => a - b).map((i) => positions[i])
}

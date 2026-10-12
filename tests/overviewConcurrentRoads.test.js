import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateOverviewTracks, createOverviewPassageIndex } from '../src/components/map/overviewAggregation.ts'

const point = (x, y = 0) => [34 + y / 111319.49, 109 + x / (111319.49 * Math.cos(34 * Math.PI / 180))]
const road = (routeRef, roadClass = 'EXPRESSWAY', provinceCode) => ({ roadClass, routeRef, ...(provinceCode ? { provinceCode } : {}) })
const part = (coordinates, primary, concurrentRoads = [], extra = {}) => ({ ...primary, concurrentRoads,
  source: 'MANUAL', confidence: 'HIGH', distanceMeters: 1000, polyline: coordinates.map(([x, y]) => point(x, y)), ...extra })
const track = (id, parts) => ({ segmentId: id, segmentName: id, points: [], roadParts: parts,
  line: parts.flatMap(p => p.polyline.map(([lat, lon]) => ({ lat, lon }))) })
const atSource = (lines, sourceId, x, y = 0) => {
  const position = point(x, y)
  const line = lines.find(l => l.sourceIds.includes(sourceId)
    && Math.min(...l.positions.map(p => p[1])) <= position[1] + 1e-9
    && Math.max(...l.positions.map(p => p[1])) >= position[1] - 1e-9)
  assert.ok(line, `missing ${sourceId} at ${x}`)
  return createOverviewPassageIndex(lines)(line, position)
}

test('swapped primary and concurrent identities retain asymmetric bidirectional totals at all separations', () => {
  for (const [roadClass, a, b] of [['EXPRESSWAY', 'G22', 'G70'], ['NATIONAL_ROAD', 'G210', 'G316']]) {
    for (const offset of [0, 12, 35, 120]) for (const includeDirections of [false, true]) {
      const tracks = [
        ...Array.from({ length: 3 }, (_, i) => track(`a${i}`, [part([[0, 0], [1000, 0]], road(a, roadClass), [road(b, roadClass)])])),
        ...Array.from({ length: 2 }, (_, i) => track(`b${i}`, [part([[1000, offset], [0, offset]], road(b, roadClass), [road(a, roadClass)])])),
      ]
      const before = structuredClone(tracks), lines = aggregateOverviewTracks(tracks, includeDirections)
      for (const [id, y] of [['a0', 0], ['b0', offset]]) {
        assert.deepEqual(atSource(lines, id, 500, y), { count: 5, sourceIds: ['a0', 'a1', 'a2', 'b0', 'b1'] }, `${a}/${b} ${offset}`)
      }
      assert.ok(lines.every(l => l.routeRef && l.roadName))
      assert.deepEqual(tracks, before)
      assert.deepEqual(aggregateOverviewTracks([...tracks].reverse(), includeDirections), lines)
    }
  }
})

test('one marked direction is sufficient and membership order does not matter', () => {
  for (const otherRoads of [[road('G70')], [road('G5'), road('G70')], [road('G70'), road('G5'), road('G70')]]) {
    const lines = aggregateOverviewTracks([
      track('a', [part([[0, 0], [1000, 0]], road('G22'), otherRoads)]),
      track('b', [part([[1000, 35], [0, 35]], road('G70'))]),
    ], false)
    for (const [id, y] of [['a', 0], ['b', 35]]) assert.equal(atSource(lines, id, 500, y).count, 2)
  }
})

test('concurrent membership remains confined to the annotated interval after aggregation and joining', () => {
  const lines = aggregateOverviewTracks([
    track('a', [part([[0, 0], [300, 0]], road('G22')),
      part([[300, 0], [700, 0]], road('G22'), [road('G70')]),
      part([[700, 0], [1000, 0]], road('G22'))]),
    track('b', [part([[1000, 35], [0, 35]], road('G70'))]),
  ], false)
  for (const [x, expected] of [[100, 1], [500, 2], [900, 1]]) {
    for (const [id, y] of [['a', 0], ['b', 35]]) assert.equal(atSource(lines, id, x, y).count, expected, `${id} at ${x}`)
  }
})

test('primary swaps among repeated same-direction recordings do not lose physical passages', () => {
  const tracks = [
    track('a0', [part([[0, 0], [1000, 0]], road('G22'), [road('G70')])]),
    track('a1', [part([[0, 0], [1000, 0]], road('G70'), [road('G22')])]),
    track('b0', [part([[1000, 35], [0, 35]], road('G70'), [road('G22')])]),
    track('b1', [part([[1000, 35], [0, 35]], road('G22'), [road('G70')])]),
  ]
  const lines = aggregateOverviewTracks(tracks, false)
  for (const [id, y] of [['a0', 0], ['a1', 0], ['b0', 35], ['b1', 35]]) assert.equal(atSource(lines, id, 500, y).count, 4)
})

test('one recording with a swapped-primary return counts two genuine passages, not memberships', () => {
  for (const offset of [0, 12, 35]) {
    const lines = aggregateOverviewTracks([track('round-trip', [
      part([[0, 0], [1000, 0]], road('G22'), [road('G70'), road('G5')]),
      part([[1000, offset], [0, offset]], road('G70'), [road('G5'), road('G22')]),
    ])], false)
    assert.equal(atSource(lines, 'round-trip', 500).count, 2)
    assert.deepEqual(atSource(lines, 'round-trip', 500).sourceIds, ['round-trip'])
  }
})

test('shared membership retains mainline, opposite-flow, coverage and continuous-corridor safeguards', () => {
  for (const [coordinates, extra] of [
    [[[0, 35], [1000, 35]], {}],
    [[[500, -500], [500, 500]], {}],
    [[[510, 35], [500, 35]], {}],
    [[[200, 35], [0, 35]], {}],
    [[[1000, 35], [0, 35]], { roadName: 'G70 高速出口匝道' }],
    [[[1000, 250], [0, 250]], {}],
  ]) {
    const lines = aggregateOverviewTracks([
      track('a', [part([[0, 0], [1000, 0]], road('G22'), [road('G70')])]),
      track('b', [part(coordinates, road('G70'), [road('G22')], extra)]),
    ], false)
    assert.equal(atSource(lines, 'a', 500).count, 1, JSON.stringify([coordinates, extra]))
  }
})

test('unmarked roads and different provinces do not acquire a shared identity', () => {
  for (const [primaryA, otherA, primaryB, otherB] of [
    [road('G22'), [], road('G70'), []],
    [road('S12', 'EXPRESSWAY', '610000'), [], road('S12', 'EXPRESSWAY', '620000'), []],
    [road('G22'), [road('S12', 'EXPRESSWAY', '610000')], road('G70'), [road('S12', 'EXPRESSWAY', '620000')]],
  ]) {
    const lines = aggregateOverviewTracks([
      track('a', [part([[0, 0], [1000, 0]], primaryA, otherA)]),
      track('b', [part([[1000, 35], [0, 35]], primaryB, otherB)]),
    ], false)
    for (const [id, y] of [['a', 0], ['b', 35]]) assert.equal(atSource(lines, id, 500, y).count, 1)
  }
})

test('nearby overlapping membership pairs never become a transitive road group', () => {
  const lines = aggregateOverviewTracks([
    track('a', [part([[0, 0], [1000, 0]], road('G22'), [road('G70')])]),
    track('b', [part([[1000, 35], [0, 35]], road('G70'), [road('G5')])]),
    track('c', [part([[1000, -35], [0, -35]], road('G5'))]),
  ], false)
  assert.deepEqual(atSource(lines, 'a', 500), { count: 2, sourceIds: ['a', 'b'] })
  assert.deepEqual(atSource(lines, 'c', 500, -35), { count: 1, sourceIds: ['c'] })
})

test('numbered first-class roads keep their existing matching when concurrent identities are unavailable', () => {
  const primary = { roadClass: 'OTHER', routeRef: 'G210' }
  const lines = aggregateOverviewTracks([
    track('a', [part([[0, 0], [1000, 0]], primary, [], { roadName: '河谷一级公路' })]),
    track('b', [part([[1000, 35], [0, 35]], primary, [], { roadName: '河谷一级公路' })]),
  ], false)
  for (const [id, y] of [['a', 0], ['b', 35]]) assert.equal(atSource(lines, id, 500, y).count, 2)
})

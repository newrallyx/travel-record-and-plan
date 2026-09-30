import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateOverviewTracks, createOverviewHoverIndex } from '../src/components/map/overviewAggregation.ts'

const point = (x, y = 0, latitude = 34) => [latitude + y / 111319.49,
  109 + x / (111319.49 * Math.cos(latitude * Math.PI / 180))]

const line = (id, coordinates, overrides = {}) => ({
  id, positions: coordinates.map(([x, y]) => point(x, y)), count: 1, flowSign: 1,
  mainline: true, firstClassRoad: false, roadClass: 'EXPRESSWAY', routeRef: 'G5',
  sourceIds: ['shared'], passages: [{ source: 'shared', start: 0, end: 1000, direction: 1 }],
  ...overrides,
})

test('shared recording does not lend counts across a crossing or beyond an endpoint', () => {
  for (const coordinates of [
    [[500, -500], [500, 500]],
    [[480, 15], [0, 15]],
  ]) {
    const a = line('a', [[0, 0], [1000, 0]])
    const b = line('b', coordinates, {
      passages: [{ source: 'shared', start: 2000, end: 3000, direction: 1 }],
    })
    assert.equal(createOverviewHoverIndex([a, b])(a, point(500)), 1)
  }
})

test('wide corridor rejects same-direction traffic and gaps beyond 200 metres', () => {
  for (const [offset, reverse] of [[80, false], [150, false], [220, true]]) {
    const a = line('a', [[0, 0], [1000, 0]])
    const coordinates = [[0, offset], [1000, offset]]
    const b = line('b', reverse ? coordinates.reverse() : coordinates, {
      sourceIds: ['other'], passages: [{ source: 'other', start: 0, end: 1000, direction: 1 }],
    })
    const at = createOverviewHoverIndex([a, b])
    assert.equal(at(a, point(500)), 1)
    assert.equal(at(b, point(500, offset)), 1)
  }
})

test('wide bent carriageways retain asymmetric totals across latitude, sampling and input order', () => {
  let scenarios = 0
  for (const latitude of [20, 34, 50]) for (const offset of [55, 80, 150]) {
    for (const roadClass of ['EXPRESSWAY', 'NATIONAL_ROAD']) for (const dense of [false, true]) {
      for (const reverseInput of [false, true]) {
        const vertices = [[0, 0], [500, 0], [1000, 100]]
        const coordinates = dense ? vertices.slice(1).flatMap((b, i) => {
          const a = vertices[i]
          return Array.from({ length: 50 }, (_, j) => a.map((v, axis) => v + (b[axis] - v) * j / 50))
        }).concat([vertices.at(-1)]) : vertices
        const tracks = ['a0', 'a1', 'b0', 'b1', 'b2'].map(segmentId => {
          const reverse = segmentId.startsWith('b')
          const positions = coordinates.map(([x, y]) => point(x, y + (reverse ? offset : 0), latitude))
          if (reverse) positions.reverse()
          return { segmentId, segmentName: segmentId, points: [],
            line: positions.map(([lat, lon]) => ({ lat, lon })),
            roadParts: [{ roadClass, routeRef: roadClass === 'EXPRESSWAY' ? 'G5' : 'G210',
              source: 'ROAD_CODE', confidence: 'HIGH', polyline: positions, distanceMeters: 1010 }] }
        })
        if (reverseInput) tracks.reverse()
        const before = JSON.stringify(tracks)
        const lines = aggregateOverviewTracks(tracks, false), at = createOverviewHoverIndex(lines)
        for (const prefix of ['a', 'b']) {
          const own = lines.find(l => l.sourceIds.includes(`${prefix}0`))
          assert.ok(own)
          assert.equal(own.count, prefix === 'a' ? 2 : 3)
          for (const [x, y] of [[250, 0], [750, 50]]) {
            assert.equal(at(own, point(x, y + (prefix === 'b' ? offset : 0), latitude)), 5,
              JSON.stringify({ latitude, offset, roadClass, dense, reverseInput, prefix, x }))
          }
        }
        assert.equal(JSON.stringify(tracks), before)
        scenarios++
      }
    }
  }
  assert.equal(scenarios, 72)
})

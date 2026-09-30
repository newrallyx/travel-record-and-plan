import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateOverviewTracks, createOverviewHoverIndex, overviewLineWeight } from '../src/components/map/overviewAggregation.ts'

// Local metre coordinates near Xi'an, projected to geographic coordinates.
const point = (x, y = 0) => ({ lat: 34 + y / 111319.49, lon: 109 + x / (111319.49 * Math.cos(34 * Math.PI / 180)) })
const track = (id, coordinates, roadClass, overrides = {}) => {
  const line = coordinates.map(([x, y]) => point(x, y))
  return { segmentId: id, segmentName: id, points: [], line, ...(roadClass ? { roadParts: [{ roadClass, source: 'ROAD_CODE', confidence: 'HIGH', routeRef: 'G5', polyline: line.map((p) => [p.lat, p.lon]), distanceMeters: 1000, ...overrides }] } : {}) }
}
const length = (line) => line.positions.slice(1).reduce((n, p, i) => {
  const q = line.positions[i]
  return n + Math.hypot((p[0] - q[0]) * 111319.49, (p[1] - q[1]) * 111319.49 * Math.cos(34 * Math.PI / 180))
}, 0)
const total = (lines, count) => lines.filter((l) => l.count === count).reduce((sum, l) => sum + length(l), 0)
const close = (a, b, tolerance = 0.05) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)

test('numbered highways display their road name even when raw evidence names an interchange or service area', () => {
  for (const [routeRef, roadName, expected] of [
    ['G30', '北站互通式立交', '连霍高速'],
    ['G65', '镇安服务区', '包茂高速'],
    ['G5', '某互通式立交', '京昆高速'],
  ]) {
    const input = track('name', [[0, 0], [1000, 0]], 'EXPRESSWAY', { routeRef, roadName })
    const before = structuredClone(input)
    const lines = aggregateOverviewTracks([input])
    assert.ok(lines.length > 0)
    assert.ok(lines.every((line) => line.routeRef === routeRef && line.roadName === expected))
    if (roadName.includes('服务区')) assert.ok(lines.every((line) => !line.directions))
    assert.deepEqual(input, before)
  }
})

test('national road tooltips use the published short name for each road class', () => {
  for (const [routeRef, roadClass, expected] of [
    ['G20', 'EXPRESSWAY', '青银高速'],
    ['G59', 'EXPRESSWAY', '呼北高速'],
    ['G30', 'EXPRESSWAY', '连霍高速'],
    ['G210', 'NATIONAL_ROAD', '满防线'],
    ['G312', 'NATIONAL_ROAD', '沪霍线'],
  ]) {
    const input = track(routeRef, [[0, 0], [1000, 0]], roadClass, { routeRef, roadName: '原始路段名称' })
    assert.ok(aggregateOverviewTracks([input]).every((line) => line.roadName === expected))
  }
})

test('same geometry merges independently recorded tracks without mutating input', () => {
  const tracks = [track('a', [[0, 0], [1000, 0]]), track('b', [[0, 0], [1000, 0]])]
  const before = structuredClone(tracks)
  const lines = aggregateOverviewTracks(tracks)
  close(total(lines, 2), 1000)
  close(total(lines, 1), 0)
  assert.deepEqual(tracks, before)
  assert.deepEqual(aggregateOverviewTracks([...tracks].reverse()), lines)
})

test('sampling density and reverse direction do not inflate passage counts', () => {
  const tracks = [track('a', [[0, 0], [1000, 0]]), track('b', Array.from({ length: 101 }, (_, i) => [1000 - i * 10, 0]))]
  const lines = aggregateOverviewTracks(tracks)
  close(total(lines, 2), 1000)
  close(total(lines, 1), 0)
  assert.ok(lines.every((l) => l.count === 2))
})

test('partial overlaps split at their actual endpoints', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]]), track('b', [[250, 0], [750, 0]])])
  close(total(lines, 2), 500)
  close(total(lines, 1), 500)
})

test('a round trip inside one record counts twice', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0], [0, 0]])])
  close(total(lines, 2), 1000)
  assert.ok(lines.every((l) => l.count === 2))
})

test('later same-direction passage around a loop counts again', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [500, 0], [500, 500], [0, 500], [0, 0], [500, 0]])])
  close(total(lines, 2), 500)
  close(total(lines, 1), 1500)
})

test('crossings, parallel roads and ramps do not merge on proximity alone', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY'),
    track('b', [[0, 12], [1000, 12]], 'EXPRESSWAY', { roadName: '出口匝道' }),
    track('c', [[500, -500], [500, 500]], 'EXPRESSWAY')])
  assert.ok(lines.every((l) => l.count === 1))
})

test('matching numbered expressway carriageways can merge, other parallel roads remain separate', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY'), track('b', [[1000, 12], [0, 12]], 'EXPRESSWAY')])
  close(total(lines, 2), 1000)
  const unknown = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]]), track('b', [[0, 12], [1000, 12]])])
  assert.ok(unknown.every((l) => l.count === 1))
})

test('class conflicts remain unknown; manual evidence takes priority only where covered', () => {
  const a = track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY')
  const b = track('b', [[250, 0], [750, 0]], 'NATIONAL_ROAD')
  const lines = aggregateOverviewTracks([a, b])
  assert.ok(lines.filter((l) => l.count === 2).every((l) => l.roadClass === 'UNKNOWN'))
  b.roadParts[0].source = 'MANUAL'
  const manual = aggregateOverviewTracks([a, b])
  assert.ok(manual.filter((l) => l.count === 2).every((l) => l.roadClass === 'NATIONAL_ROAD'))
  assert.ok(manual.filter((l) => l.count === 1).every((l) => l.roadClass === 'EXPRESSWAY'))
})

test('uncovered geometry remains visible and analysis steps do not increase counts', () => {
  const a = track('a', [[0, 0], [500, 0], [1000, 0]], 'EXPRESSWAY')
  a.roadParts[0].polyline = [point(0), point(500)].map((p) => [p.lat, p.lon])
  a.roadParts.push(structuredClone(a.roadParts[0]))
  const lines = aggregateOverviewTracks([a])
  assert.ok(lines.every((l) => l.count === 1))
  close(lines.filter((l) => l.roadClass === 'EXPRESSWAY').reduce((sum, l) => sum + length(l), 0), 500)
  close(lines.filter((l) => l.roadClass === 'UNKNOWN').reduce((sum, l) => sum + length(l), 0), 500)
})

test('invalid coordinates split lines without bridging gaps', () => {
  const a = track('a', [[0, 0], [100, 0], [NaN, NaN], [900, 0], [1000, 0]])
  close(total(aggregateOverviewTracks([a]), 1), 200)
})

test('scope input controls counts, adjacent business segments add no extra passage', () => {
  const a = track('a', [[0, 0], [500, 0]])
  const b = track('b', [[500, 0], [1000, 0]])
  const c = track('c', [[0, 0], [1000, 0]])
  close(total(aggregateOverviewTracks([a, b]), 1), 1000)
  close(total(aggregateOverviewTracks([a, b, c]), 2), 1000)
  close(total(aggregateOverviewTracks([c]), 1), 1000)
})

test('frequency widths increase monotonically and remain capped', () => {
  const widths = [1, 2, 4, 8, 16].map((n) => overviewLineWeight(n, 10))
  assert.ok(widths.every((w, i) => i === 0 || w > widths[i - 1]))
  assert.equal(overviewLineWeight(16, 10), overviewLineWeight(500, 10))
  assert.equal(overviewLineWeight(16, 20), overviewLineWeight(16, 30))
})

test('hover on either separated expressway or national-road carriageway shows both passage counts', () => {
  for (const [roadClass, overrides] of [
    ['EXPRESSWAY', { routeRef: 'G5' }],
    ['NATIONAL_ROAD', { routeRef: 'G210' }],
    ['OTHER', { routeRef: '', roadName: '河谷一级公路' }],
  ]) {
    const tracks = [
      ...Array.from({ length: 8 }, (_, i) => track(`east-${i}`, [[0, 0], [1000, 0]], roadClass, overrides)),
      ...Array.from({ length: 9 }, (_, i) => track(`west-${i}`, [[1000, 35], [0, 35]], roadClass, overrides)),
    ]
    const lines = aggregateOverviewTracks(tracks, false)
    assert.ok(lines.some((line) => line.count === 8))
    assert.ok(lines.some((line) => line.count === 9))
    const hoverCountAt = createOverviewHoverIndex(lines)
    assert.ok(lines.every((line) => hoverCountAt(line, line.positions[Math.floor(line.positions.length / 2)]) === 17))
  }
})

test('hover totals do not combine same-flow, different-number or non-mainline roads', () => {
  for (const other of [
    track('b', [[0, 35], [1000, 35]], 'EXPRESSWAY'),
    track('b', [[1000, 35], [0, 35]], 'EXPRESSWAY', { routeRef: 'G30' }),
    track('b', [[1000, 35], [0, 35]], 'EXPRESSWAY', { roadName: '出口匝道' }),
  ]) {
    const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY'), other], false)
    const hoverCountAt = createOverviewHoverIndex(lines)
    assert.ok(lines.every((line) => hoverCountAt(line, line.positions[Math.floor(line.positions.length / 2)]) === 1))
  }
})

// Real divided highways keep their carriageways tens of metres apart, well past the local
// cursor window, while still being the same driven road for every recorded range.
test('hover totals add the mutual opposite carriageway across a wide corridor gap', () => {
  for (const offset of [35, 80, 150]) {
    const tracks = [
      ...Array.from({ length: 3 }, (_, i) => track(`a-${i}`, [[0, 0], [1000, 0]], 'EXPRESSWAY', { routeRef: 'G65' })),
      ...Array.from({ length: 4 }, (_, i) => track(`b-${i}`, [[1000, offset], [0, offset]], 'EXPRESSWAY', { routeRef: 'G65' })),
    ]
    const lines = aggregateOverviewTracks(tracks, false), at = createOverviewHoverIndex(lines)
    assert.ok(lines.some((line) => line.count === 3), `offset ${offset}`)
    assert.ok(lines.some((line) => line.count === 4), `offset ${offset}`)
    for (const line of lines) assert.equal(at(line, [point(500, offset / 2).lat, point(500, offset / 2).lon]), 7, `offset ${offset}`)
  }
})

// One recorded route can stay on two representatives of the same geometry; the tooltip must
// still report one cumulative total instead of either fragment's own count.
test('hover totals merge two representatives of one recorded route on shared geometry', () => {
  const positions = [point(0), point(1000)].map((p) => [p.lat, p.lon])
  const shared = { positions, mainline: true, firstClassRoad: false, roadClass: 'EXPRESSWAY', routeRef: 'G65' }
  const lines = [
    { ...shared, id: 'a', count: 4, flowSign: 1, flowCounts: { forward: 4, reverse: 0 }, sourceIds: ['s1', 's2'],
      passages: [1, 2, 3, 4].map((n) => ({ source: `p${n}`, start: 0, end: 1000, direction: 1 })) },
    { ...shared, id: 'b', count: 2, flowSign: 1, flowCounts: { forward: 2, reverse: 0 }, sourceIds: ['s1'],
      passages: [1, 2].map((n) => ({ source: `p${n}`, start: 0, end: 1000, direction: 1 })) },
  ]
  const at = createOverviewHoverIndex(lines)
  for (const id of ['a', 'b']) {
    const line = lines.find((l) => l.id === id)
    assert.equal(at(line, [point(500).lat, point(500).lon]), 4, id)
  }
})

test('hover totals survive dense bends and short count-boundary fragments', () => {
  for (const fragment of [false, true]) {
    const coordinates = Array.from({ length: 101 }, (_, i) => [i * 10, 100 * Math.sin(i / 100 * Math.PI)])
    const tracks = []
    for (const [prefix, offset, reverse] of [['east', 0, false], ['west', 35, true]]) {
      const pieces = fragment ? coordinates.slice(1).map((p, i) => [coordinates[i], p]) : [coordinates]
      pieces.forEach((piece, i) => {
        const points = piece.map(([x, y]) => [x, y + offset])
        tracks.push(track(`${prefix}-${i}`, reverse ? points.reverse() : points, 'EXPRESSWAY'))
      })
    }
    const lines = aggregateOverviewTracks(tracks, false)
    const countAt = createOverviewHoverIndex(lines)
    for (const line of lines) {
      const a = line.positions[0], b = line.positions.at(-1)
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      if (mid[1] > point(100).lon && mid[1] < point(900).lon) assert.equal(countAt(line, mid), 2)
    }
  }
})

test('hover does not borrow counts beyond the opposite carriageway endpoint or from a short near pass', () => {
  for (const points of [[[250, 35], [0, 35]], [[510, 35], [500, 35]]]) {
    const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY'),
      track('b', points, 'EXPRESSWAY')], false)
    const countAt = createOverviewHoverIndex(lines)
    const line = lines.find(l => l.sourceIds.includes('a'))
    assert.equal(countAt(line, [point(500).lat, point(500).lon]), 1)
  }
})

test('hover pairs opposite traffic at the cursor even when line lengths and endpoints differ', () => {
  const tracks = [
    ...Array.from({ length: 8 }, (_, i) => track(`east-${i}`, [[0, 0], [1000, 0]], 'EXPRESSWAY', { routeRef: 'G30' })),
    ...Array.from({ length: 9 }, (_, i) => track(`west-${i}`, [[1500, 30], [250, 30]], 'EXPRESSWAY', { routeRef: 'G30' })),
  ]
  const lines = aggregateOverviewTracks(tracks, false)
  const hoverCountAt = createOverviewHoverIndex(lines)
  const east = lines.find((line) => line.count === 8)
  const west = lines.find((line) => line.count === 9)
  assert.ok(east && west)
  assert.equal(hoverCountAt(east, [point(500).lat, point(500).lon]), 17)
  assert.equal(hoverCountAt(west, [point(500, 30).lat, point(500, 30).lon]), 17)
  assert.equal(hoverCountAt(west, [point(1400, 30).lat, point(1400, 30).lon]), 9)
})

test('one service-area road name does not hide the opposite mainline passage total', () => {
  const east = Array.from({ length: 8 }, (_, i) => track(`east-${i}`, [[0, 0], [1000, 0]], 'EXPRESSWAY',
    { routeRef: 'G30', roadName: i === 0 ? '连霍高速服务区' : '连霍高速' }))
  const west = Array.from({ length: 9 }, (_, i) => track(`west-${i}`, [[1250, 35], [0, 35]], 'EXPRESSWAY',
    { routeRef: 'G30', roadName: '连霍高速' }))
  const lines = aggregateOverviewTracks([...east, ...west], false)
  const hoverCountAt = createOverviewHoverIndex(lines)
  const atEast = [point(500).lat, point(500).lon]
  const atWest = [point(500, 35).lat, point(500, 35).lon]
  assert.ok(lines.some((line) => line.count === 8 && hoverCountAt(line, atEast) === 17))
  assert.ok(lines.some((line) => line.count === 9 && hoverCountAt(line, atWest) === 17))
})

test('count-only overview keeps opposite carriageway totals without direction labels', () => {
  const tracks = [track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY', { roadName: '京昆高速（昆明方向）' }),
    track('b', [[1000, 12], [0, 12]], 'EXPRESSWAY', { roadName: '京昆高速（北京方向）' })]
  const before = structuredClone(tracks)
  const lines = aggregateOverviewTracks(tracks, false)
  close(total(lines, 2), 1000)
  assert.ok(lines.every((line) => line.directions === undefined))
  assert.deepEqual(tracks, before)
})

test('dense carriageway samples still have continuous overlap support', () => {
  const lines = aggregateOverviewTracks([track('a', Array.from({ length: 101 }, (_, i) => [i * 10, 0]), 'EXPRESSWAY'),
    track('b', Array.from({ length: 101 }, (_, i) => [1000 - i * 10, 12]), 'EXPRESSWAY')])
  close(total(lines, 2), 1000)
  assert.ok(lines.every((l) => l.count === 2))
})

test('offset matching does not chain across a series of parallel routes', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY'),
    track('b', [[0, 20], [1000, 20]], 'EXPRESSWAY'), track('c', [[0, 40], [1000, 40]], 'EXPRESSWAY')])
  close(total(lines, 2), 1000)
  close(total(lines, 1), 1000)
  assert.ok(lines.every((l) => l.count < 3))
})

test('opposite carriageways within a single recorded round trip also merge', () => {
  const a = track('a', [[0, 0], [1000, 0], [1000, 12], [0, 12]], 'EXPRESSWAY')
  const lines = aggregateOverviewTracks([a])
  close(total(lines, 2), 1000)
  close(total(lines, 1), 12)
})

// Direction display is derived from original records and must not change their content.
test('expressway directions keep asymmetric counts and actual carriageway positions', () => {
  const tracks = [0, 1, 2, 3].map((i) => track(`a${i}`, [[0, 0], [1000, 0]], 'EXPRESSWAY', { roadName: '京昆高速（昆明方向）' }))
  tracks.push(...[0, 1].map((i) => track(`b${i}`, [[1000, 12], [0, 12]], 'EXPRESSWAY', { roadName: '京昆高速（北京方向）' })))
  const before = structuredClone(tracks), lines = aggregateOverviewTracks(tracks)
  close(total(lines, 6), 1000)
  assert.ok(lines.every((l) => l.directions.forward.count === 4 && l.directions.reverse.count === 2))
  assert.ok(lines.every((l) => l.directions.forward.destination === '昆明' && l.directions.reverse.destination === '北京'))
  assert.ok(lines.every((l) => l.directions.reverse.positions[0][0] > l.directions.forward.positions[0][0]))
  assert.deepEqual(tracks, before)
  assert.deepEqual(aggregateOverviewTracks([...tracks].reverse()), lines)
})

test('national roads support opposite directions on one centerline or divided carriageways', () => {
  for (const offset of [0, 12]) {
    const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'NATIONAL_ROAD', { routeRef: 'G210' }),
      track('b', [[1000, offset], [0, offset]], 'NATIONAL_ROAD', { routeRef: 'G210' })])
    close(total(lines, 2), 1000)
    assert.ok(lines.every((l) => l.directions.forward.count === 1 && l.directions.reverse.count === 1))
    assert.ok(lines.every((l) => !l.directions.forward.destination && !l.directions.reverse.destination))
  }
})

test('provincial roads and ramps keep existing non-directional display', () => {
  for (const [roadClass, overrides] of [['PROVINCIAL_ROAD', { routeRef: 'S101' }], ['EXPRESSWAY', { roadName: '京昆高速出口匝道' }]]) {
    const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], roadClass, overrides)])
    assert.ok(lines.every((l) => !l.directions))
  }
})

test('a named anchor propagates along a connected bend without using compass heading', () => {
  const a = track('a', [[0, 0], [500, 0], [500, 500]], 'EXPRESSWAY')
  a.roadParts = [
    { ...a.roadParts[0], roadName: '京昆高速（昆明方向）', polyline: [point(0), point(500)].map((p) => [p.lat, p.lon]) },
    { ...a.roadParts[0], roadName: '京昆高速', polyline: [point(500), point(500, 500)].map((p) => [p.lat, p.lon]) },
  ]
  const lines = aggregateOverviewTracks([a])
  assert.ok(lines.every((l) => l.directions.forward.destination === '昆明'))
})

test('direction labels do not propagate over gaps or forks', () => {
  const tracks = [track('a', [[0, 0], [500, 0]], 'EXPRESSWAY', { roadName: '京昆高速（昆明方向）' }),
    track('b', [[500, 0], [1000, 0]], 'EXPRESSWAY'), track('c', [[500, 0], [500, 500]], 'EXPRESSWAY'),
    track('d', [[1500, 0], [2000, 0]], 'EXPRESSWAY')]
  const lines = aggregateOverviewTracks(tracks)
  assert.ok(lines.filter((l) => l.sourceIds.includes('a')).every((l) => l.directions.forward.destination === '昆明'))
  assert.ok(lines.filter((l) => !l.sourceIds.includes('a')).every((l) => !l.directions.forward.destination))
})

test('conflicting direction text stays unnamed rather than selecting one claim', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY', { roadName: '京昆高速（北京方向）' }),
    track('b', [[0, 0], [1000, 0]], 'EXPRESSWAY', { roadName: '京昆高速（昆明方向）' })])
  assert.ok(lines.every((l) => l.directions.conflictingNames && !l.directions.forward.destination))
})

test('joining reverses direction counts and labels when representative orientation changes', () => {
  const lines = aggregateOverviewTracks([
    track('a', [[0, 0], [500, 0]], 'EXPRESSWAY', { roadName: '京昆高速（昆明方向）' }),
    track('b', [[1000, 0], [500, 0]], 'EXPRESSWAY', { roadName: '京昆高速（北京方向）' }),
    track('c', [[0, 0], [1000, 0]], 'EXPRESSWAY'),
  ])
  for (const line of lines) {
    const forwardEast = line.positions.at(-1)[1] > line.positions[0][1]
    assert.equal(line.directions.forward.destination, forwardEast ? '昆明' : '北京')
    assert.equal(line.directions.forward.count + line.directions.reverse.count, line.count)
  }
})

test('same-geometry roads with different known numbers do not become one directional road', () => {
  const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'NATIONAL_ROAD', { routeRef: 'G210' }),
    track('b', [[0, 0], [1000, 0]], 'NATIONAL_ROAD', { routeRef: 'G242' })])
  assert.ok(lines.every((l) => l.count === 1))
})

test('opposite representative orientations join without reversing actual carriageways', () => {
  const lines = aggregateOverviewTracks([track('a', [[500, 0], [0, 0], [500, 0], [1000, 0], [500, 0]], 'EXPRESSWAY')])
  close(total(lines, 2), 1000)
  for (const side of ['forward', 'reverse']) {
    assert.equal(lines[0].directions[side].count, 1)
    assert.deepEqual(lines[0].directions[side].positions[0], lines[0].positions[0])
    assert.deepEqual(lines[0].directions[side].positions.at(-1), lines[0].positions.at(-1))
  }
})


test('mainline instructions mentioning future exits or service areas retain directions and common names', () => {
  for (const instruction of ['沿G22行驶，经过服务区', '沿G22行驶，从下一出口驶出']) {
    const lines = aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY', { routeRef: 'G22', roadName: '青兰高速', instruction })])
    assert.ok(lines.every(l => l.directions && l.roadClass === 'EXPRESSWAY' && l.roadName === '青兰高速'))
  }
  for (const [ref, roadClass, expected] of [['G40', 'EXPRESSWAY', '沪陕高速'], ['G242', 'NATIONAL_ROAD', '甘钦线']]) {
    assert.ok(aggregateOverviewTracks([track('a', [[0, 0], [1000, 0]], roadClass, {routeRef: ref})]).every(l => l.roadName === expected))
  }
  const ramp = aggregateOverviewTracks([track('r', [[0, 0], [1000, 0]], 'EXPRESSWAY', {roadName:'京昆高速出口匝道'})])
  assert.ok(ramp.every(l => !l.directions && l.roadClass === 'EXPRESSWAY' && l.roadName))
})

test('manual endpoint applies to recorded travel, overrides inference and never leaks to adjacent intervals', () => {
  const manual = track('a', [[0, 0], [500, 0]], 'EXPRESSWAY', {source:'MANUAL', routeRef:'G22', manualDirection:'兰州'})
  const tail = track('b', [[500, 0], [1000, 0]], 'EXPRESSWAY', {routeRef:'G22'})
  const lines = aggregateOverviewTracks([manual, tail])
  assert.ok(lines.filter(l => l.sourceIds.includes('a')).every(l => l.directions.forward.destination === '兰州' && l.directions.nameSource === 'manual'))
  assert.ok(lines.filter(l => l.sourceIds.includes('b')).every(l => !l.directions.forward.destination))
  const reverse = track('b', [[500, 0], [0, 0]], 'EXPRESSWAY', {source:'MANUAL', routeRef:'G22', manualDirection:'青岛'})
  assert.ok(aggregateOverviewTracks([manual, reverse]).every(l => l.count === 2 && l.directions.forward.count === 1 && l.directions.reverse.count === 1 && !l.directions.conflictingNames))
  reverse.roadParts[0].manualDirection = '兰州'
  assert.ok(aggregateOverviewTracks([manual, reverse]).every(l => !l.directions.forward.destination && l.directions.conflictingNames))
  manual.roadParts[0].manualDirection = 'pending'
  assert.ok(aggregateOverviewTracks([manual]).every(l => !l.directions.forward.destination && l.directions.manualOverride))
})

test('hover includes a remaining carriageway when the representative already contains both directions', () => {
  for (const forward of [2, 3, 4]) {
    const tracks = [
      ...Array.from({ length: forward }, (_, i) => track(`a-${i}`, [[0, 0], [1000, 0]], 'EXPRESSWAY', { routeRef: 'G65' })),
      ...Array.from({ length: 3 }, (_, i) => track(`b-${i}`, [[1000, 12], [0, 12]], 'EXPRESSWAY', { routeRef: 'G65' })),
      track('c', [[1000, 35], [0, 35]], 'EXPRESSWAY', { routeRef: 'G65' }),
    ];
    const lines = aggregateOverviewTracks(tracks, false);
    const at = createOverviewHoverIndex(lines);
    for (const line of lines) {
      const a = line.positions[0], b = line.positions.at(-1);
      assert.equal(at(line, a.map((v, i) => (v + b[i]) / 2)), forward + 4);
    }
  }
});

test('hover support survives transitions from merged to separated carriageways', () => {
  const tracks = [track('a', [[0, 0], [1000, 0]], 'EXPRESSWAY'),
    track('b', [[1000, 20], [560, 20], [500, 26], [440, 20], [0, 20]], 'EXPRESSWAY')];
  const lines = aggregateOverviewTracks(tracks, false), at = createOverviewHoverIndex(lines);
  const side = lines.find(l => l.count === 1 && l.sourceIds.includes('b') && l.positions.some(p => p[0] > point(0, 25).lat));
  assert.ok(side);
  assert.equal(at(side, [point(500, 26).lat, point(500, 26).lon]), 2);
});


test('long merged highway parts with an entrance or service-area label still pair locally', () => {
  for (const roadName of ['镇安服务区', 'G65包茂高速入口']) {
    const tracks = [
      ...Array.from({ length: 6 }, (_, i) => track(`a-${i}`, [[0, 0], [12000, 0]], 'EXPRESSWAY', { routeRef: 'G65', roadName, instruction: '沿入口行驶200米直行进入高速' })),
      track('b', [[12000, 35], [0, 35]], 'EXPRESSWAY', { routeRef: 'G65', roadName: '包茂高速' }),
    ];
    const lines = aggregateOverviewTracks(tracks, false), at = createOverviewHoverIndex(lines);
    for (const line of lines) {
      const a = line.positions[0], b = line.positions.at(-1);
      assert.equal(at(line, a.map((v, i) => (v + b[i]) / 2)), line.mainline ? 7 : line.count);
    }
    tracks[0].roadParts[0].roadName = '包茂高速连接线入口';
    const connector = aggregateOverviewTracks([tracks[0], tracks.at(-1)], false);
    assert.ok(connector.some(l => !l.mainline));
    const short = tracks.map(t => ({ ...t, line: t.line.map(p => ({ ...p, lon: 109 + (p.lon - 109) / 100 })),
      roadParts: t.roadParts.map(p => ({ ...p, polyline: p.polyline.map(([lat, lon]) => [lat, 109 + (lon - 109) / 100]) })) }));
    const shortLines = aggregateOverviewTracks(short, false), shortAt = createOverviewHoverIndex(shortLines);
    assert.ok(shortLines.every(l => shortAt(l, l.positions[0]) === l.count));
  }
});


test('hover deduplicates overlapping passage intervals but retains real returns in one record', () => {
  const p = (x, y) => { const v = point(x, y); return [v.lat, v.lon] };
  const a = { id: 'a', positions: [p(0, 0), p(1000, 0)], count: 5, flowSign: -1,
    flowCounts: { forward: 1, reverse: 4 }, mainline: true, firstClassRoad: false, roadClass: 'EXPRESSWAY', routeRef: 'G3023',
    sourceIds: ['out', 'r1', 'r2', 'r3', 'r4'],
    passages: ['out', 'r1', 'r2', 'r3', 'r4'].map(source => ({source, start: 0, end: 1000, direction: source === 'out' ? 1 : -1})) };
  const b = { ...a, id: 'b', positions: [p(1000, 18), p(0, 18)], count: 4, flowSign: 1,
    flowCounts: { forward: 4, reverse: 0 }, sourceIds: ['r1', 'r2', 'r3', 'r4'],
    passages: ['r1', 'r2', 'r3', 'r4'].map(source => ({source, start: 200, end: 800, direction: 1})) };
  let at = createOverviewHoverIndex([a, b]);
  assert.equal(at(a, p(500, 0)), 5);
  assert.equal(at(b, p(500, 18)), 5);
  // The same record returns later: it is a new event, not a duplicate source ID.
  b.passages[0] = { ...b.passages[0], start: 2000, end: 3000 };
  at = createOverviewHoverIndex([a, b]);
  assert.equal(at(a, p(500, 0)), 6);
  assert.equal(at(b, p(500, 18)), 6);
});

test('shared recordings do not combine different numbered roads', () => {
  const source = track('a', [[0, 0], [1000, 0], [1000, 15], [0, 15]], 'EXPRESSWAY');
  source.roadParts = [
    track('out', [[0, 0], [1000, 0]], 'EXPRESSWAY').roadParts[0],
    track('back', [[1000, 15], [0, 15]], 'EXPRESSWAY', { routeRef: 'G30' }).roadParts[0],
  ];
  const lines = aggregateOverviewTracks([source,
    track('b', [[1000, 15], [0, 15]], 'EXPRESSWAY', { routeRef: 'G30' })], false);
  const at = createOverviewHoverIndex(lines);
  for (const ref of ['G5', 'G30']) {
    const line = lines.find(l => l.routeRef === ref);
    assert.ok(line);
    const p = point(500, ref === 'G5' ? 0 : 15);
    assert.equal(at(line, [p.lat, p.lon]), ref === 'G5' ? 1 : 2);
  }
});

test('wide opposite carriageways pair at each edge of a bend', () => {
  for (const offset of [80, 150]) {
    const coordinates = [[0, 0], [500, 0], [1000, 100]];
    const lines = aggregateOverviewTracks([
      track('a', coordinates, 'EXPRESSWAY'),
      track('b', coordinates.map(([x, y]) => [x, y + offset]).reverse(), 'EXPRESSWAY'),
    ], false);
    const at = createOverviewHoverIndex(lines);
    for (const id of ['a', 'b']) {
      const line = lines.find(l => l.sourceIds.includes(id));
      assert.ok(line);
      for (const [x, y] of [[250, 0], [750, 50]]) {
        const p = point(x, y + (id === 'b' ? offset : 0));
        assert.equal(at(line, [p.lat, p.lon]), 2, `${offset} m, ${id}, x=${x}`);
      }
    }
  }
});

test('legacy merged connector instructions apply only to their documented first step', () => {
  const source = track('a', [[0, 0], [100, 0], [200, 0], [3000, 0]], 'EXPRESSWAY',
    { routeRef: 'G30', roadName: '官厅立交', instruction: '沿匝道向东行驶100米靠左' });
  const other = track('b', [[3000, 35], [0, 35]], 'EXPRESSWAY', { routeRef: 'G30' });
  const lines = aggregateOverviewTracks([source, other], false), at = createOverviewHoverIndex(lines);
  const entry = lines.find(l => l.sourceIds.includes('a') && !l.mainline);
  const tail = lines.find(l => l.sourceIds.includes('a') && l.mainline);
  assert.ok(entry && tail);
  assert.equal(at(entry, entry.positions[0]), 1);
  assert.equal(at(tail, [point(1000).lat, point(1000).lon]), 2);
});


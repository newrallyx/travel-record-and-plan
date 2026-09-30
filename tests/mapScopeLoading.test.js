import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as routeKeys from '../src/utils/routeBuildKey.ts'
import * as durations from '../src/utils/durations.ts'
import * as tolls from '../src/utils/tolls.ts'
import * as waypoints from '../src/utils/waypointValidation.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(file, modules) {
  const slots = []
  let index, effects
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = initial
      return [slots[i], value => { slots[i] = value }]
    },
    useRef(initial) { return slots[index++] ??= { current: initial } },
    useMemo(fn, deps) {
      const i = index++, previous = slots[i]
      if (!previous || deps.some((v, j) => v !== previous.deps[j])) slots[i] = { deps, value: fn() }
      return slots[i].value
    },
    useEffect(fn, deps) {
      const i = index++, previous = slots[i]
      if (!previous || deps.some((v, j) => v !== previous.deps[j])) effects.push(() => {
        previous?.cleanup?.()
        slots[i] = { deps, cleanup: fn() }
      })
    },
  }
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, window: modules.window, require: id => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    assert.ok(modules[id], id)
    return modules[id]
  } })
  return {
    render(name, props) {
      index = 0; effects = []
      const result = exports[name](props)
      effects.forEach(effect => effect())
      return result
    },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('overview to detail filters old tracks before async cache reads and ignores obsolete reads', async () => {
  const segments = ['a', 'b', 'c'].map(id => {
    const segment = { id, name: id, startPoint: 'start', endPoint: 'end', preference: 'FASTEST',
      startCoord: { lat: 34, lon: 109 }, endCoord: { lat: 35, lon: 110 },
      points: [{ lat: 34, lon: 109 }, { lat: 35, lon: 110 }] }
    return { ...segment, routeBuildKey: routeKeys.buildSegmentRouteKey(segment) }
  })
  let delayed = false, networkCalls = 0
  const reads = []
  const h = harness('../src/components/map/useMapTracks.ts', {
    '../../utils/routeBuildKey': routeKeys, '../../utils/durations': durations,
    '../../utils/tolls': tolls, '../../utils/waypointValidation': waypoints,
    '../../services/routeCacheDb': { getSegmentRouteCache: async () => {
      if (delayed) await new Promise(resolve => reads.push(resolve))
      return null
    } },
    '../../services/amap': { planDrivingRoute: () => { networkCalls++; return {} } },
    './resolvedRoutePatch': {}, './trackUtils': {},
  })
  const props = { filteredSegments: segments, allowAutoBuild: false, isReadonlyMode: false,
    onRouteResolved() {}, routeServiceRevision: 0, routeRefreshRequest: { revision: 0, segmentId: null } }
  const render = filteredSegments => h.render('useMapTracks', { ...props, filteredSegments, allowAutoBuild: filteredSegments.length === 1 })
  render(segments); await tick()
  assert.equal(render(segments).tracks.length, 3)
  delayed = true
  const first = [segments[0]], second = [segments[1]]
  assert.deepEqual(Array.from(render(first).tracks, t => t.segmentId), ['a'])
  assert.deepEqual(Array.from(render(second).tracks, t => t.segmentId), ['b'])
  reads[0](); await tick()
  assert.deepEqual(Array.from(render(second).tracks, t => t.segmentId), ['b'])
  reads[1](); await tick()
  assert.equal(render(second).loading, false)
  assert.equal(networkCalls, 0)
  assert.equal(render([]).tracks.length, 0)
  h.cleanup()
})

test('map legend does not reread the full database on scope switches; committed changes coalesce', async () => {
  let reads = 0, listener, tracks = [], historicalCalls = 0
  const timers = new Map()
  let timerId = 0
  const h = harness('../src/components/MapPanel.tsx', {
    window: { setTimeout(fn) { timers.set(++timerId, fn); return timerId }, clearTimeout(id) { timers.delete(id) } },
    '../services/routeCacheDb': { getAllSegmentRouteCache: async () => { reads++; return [] },
      subscribeRouteCacheChanges(fn) { listener = fn; return () => { listener = undefined } } },
    './map/MapCanvas': { MapCanvas() {} },
    './map/useMapTracks': { useMapTracks: () => ({ tracks, loading: false, message: '' }) },
    './map/useTrackEditing': { useTrackEditing: () => ({ renderedTracks: tracks }) },
    './map/useOverviewAggregation': { useOverviewAggregation: () => ({}) },
    './map/roadTypeVisualization': { DEFAULT_ROAD_TYPE_VISIBILITY: {},
      summarizeCurrentRoadTypeDistances: () => ({}),
      summarizeHistoricalRoadTypeDistances: () => { historicalCalls++; return {} } },
  })
  const props = { filteredSegments: [], allTrips: [], photos: [], onRouteLoadingChange() {} }
  h.render('default', props); await tick()
  h.render('default', props)
  const initialHistoricalCalls = historicalCalls
  for (const id of ['a', 'b', 'c']) {
    tracks = [{ segmentId: id }]
    h.render('default', { ...props, filteredSegments: [{ id }], selectedTripId: id })
  }
  assert.equal(reads, 1)
  assert.equal(timers.size, 0)
  assert.equal(historicalCalls, initialHistoricalCalls)
  listener(); listener(); listener()
  assert.equal(timers.size, 1)
  const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn())
  await tick()
  assert.equal(reads, 2)
  listener(); h.cleanup()
  assert.equal(timers.size, 0)
  assert.equal(listener, undefined)
})

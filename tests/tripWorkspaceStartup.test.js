import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

test('startup and asynchronous trip loading retain overview until the user selects a trip', () => {
  const states = [], refs = []
  let stateIndex, refIndex, effects
  const react = {
    useState(initial) {
      const i = stateIndex++
      if (!(i in states)) states[i] = initial
      return [states[i], value => { states[i] = value }]
    },
    useRef(initial) {
      const i = refIndex++
      return refs[i] ??= { current: initial }
    },
    useMemo: fn => fn(),
    useEffect: fn => effects.push(fn),
  }
  const helpers = new Proxy({
    sortTripsByOrder: trips => trips,
    filterTripsByYear: trips => trips,
    getSelectedYear: () => '',
    useFilteredSegments: (trips, filters) => trips.filter(trip => !filters.tripId || trip.id === filters.tripId)
      .flatMap(trip => trip.days.flatMap(day => day.routeSegments)),
  }, { get: (target, key) => target[key] ?? (() => '') })
  const source = readFileSync(new URL('../src/hooks/useTripWorkspace.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: id => id === 'react' ? react : helpers })
  const render = trips => {
    stateIndex = refIndex = 0; effects = []
    const result = exports.useTripWorkspace({ trips, editingSegmentId: null, resetEditingState() {} })
    effects.forEach(fn => fn())
    return result
  }
  const trips = [{ id: 'first', category: 'review', days: [{ id: 'day', routeSegments: [{ id: 'segment' }] }] }]
  assert.equal(render([]).isAllTripsSelected, true)
  render(trips)
  const overview = render(trips)
  assert.equal(overview.filters.tripId, '')
  assert.equal(overview.activeSegmentId, null)
  overview.setFilters({ tripId: 'first', dayId: '', segmentId: '' })
  render(trips)
  assert.equal(render(trips).filters.segmentId, 'segment')
  overview.setFilters({ tripId: '', dayId: '', segmentId: '' })
  render(trips)
  assert.equal(render(trips).isAllTripsSelected, true)
})

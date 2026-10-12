import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { IDBFactory } from 'fake-indexeddb'
import { getAllSegmentRouteCacheStrict, savePlannedSegmentRouteCache } from '../src/services/routeCacheDb.ts'
import { summarizeRoadStatisticsComparison } from '../src/utils/roadStatisticsComparison.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))

function createHarness(readCache = getAllSegmentRouteCacheStrict) {
  const slots = []
  const pendingReads = []
  let index = 0, effects = []
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = initial
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect(fn, deps) {
      const i = index++, previous = slots[i]
      if (!previous || deps.some((value, j) => value !== previous.deps[j])) effects.push(() => {
        previous?.cleanup?.()
        slots[i] = { deps, cleanup: fn() }
      })
    },
  }
  const source = readFileSync(new URL('../src/hooks/useTripStatistics.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react') return react
    if (id === '../services/routeCacheDb.ts') return { getAllSegmentRouteCacheStrict: () => {
      const request = readCache()
      pendingReads.push(request)
      return request
    } }
    if (id === '../utils/roadStatisticsComparison.ts') return { summarizeRoadStatisticsComparison }
    throw new Error(`Unexpected module: ${id}`)
  } })
  const trips = [{ id: 'trip', title: '旅程', category: 'review', startDate: '2026-10-01', endDate: '2026-10-01',
    days: [{ id: 'day', date: '2026-10-01', routeSegments: [{ id: 'segment', name: '路段', startPoint: '甲',
      endPoint: '乙', preference: 'HIGHWAY_FIRST', distanceMeters: 1000, scenicScore: 8 }] }] }]
  return {
    render(revision = 0) {
      index = 0; effects = []
      const result = exports.useTripStatistics(trips, trips, revision)
      effects.forEach(effect => effect())
      return result
    },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()) },
    async settle() { await Promise.allSettled(pendingReads); await tick() },
  }
}

test('statistics distinguishes failed cache reads and retries successfully without losing trip metrics', async () => {
  const previous = globalThis.indexedDB
  const db = new IDBFactory()
  globalThis.indexedDB = db
  await savePlannedSegmentRouteCache({ segmentId: 'segment', routeBuildKey: 'key',
    points: [{ lat: 34, lon: 109 }, { lat: 35, lon: 110 }] })
  globalThis.indexedDB = { open() { throw new Error('storage unavailable') } }
  const h = createHarness()
  try {
    assert.equal(h.render().cacheStatus, 'loading')
    await h.settle()
    const failed = h.render()
    assert.equal(failed.cacheStatus, 'unavailable')
    assert.equal(failed.routeCaches.length, 0)
    assert.equal(failed.statistics.current.tripCount, 1)
    assert.equal(failed.statistics.current.plannedDistanceMeters.value, 1000)
    assert.equal(failed.statistics.current.scenicScoreDistribution.ratedSegmentCount, 1)
    globalThis.indexedDB = db
    failed.retryCacheLoad()
    assert.equal(h.render().cacheStatus, 'loading')
    await h.settle()
    const restored = h.render()
    assert.equal(restored.cacheStatus, 'ready')
    assert.equal(restored.routeCaches.length, 1)
    assert.equal(restored.routeCaches[0].segmentId, 'segment')
  } finally { h.cleanup(); globalThis.indexedDB = previous }
})

test('an empty cache is a successful read, distinct from unavailable storage', async () => {
  const previous = globalThis.indexedDB
  globalThis.indexedDB = new IDBFactory()
  const h = createHarness()
  try {
    h.render(); await h.settle()
    assert.equal(h.render().cacheStatus, 'ready')
    assert.equal(h.render().routeCaches.length, 0)
  } finally { h.cleanup(); globalThis.indexedDB = previous }
})

test('obsolete cache requests cannot replace successful newer data or update an unmounted hook', async () => {
  const requests = []
  const h = createHarness(() => new Promise((resolve, reject) => requests.push({ resolve, reject })))
  try {
    h.render()
    h.render(1)
    const records = [{ segmentId: 'latest' }]
    requests[1].resolve(records); await tick()
    assert.equal(h.render(1).cacheStatus, 'ready')
    requests[0].reject(new Error('obsolete failure')); await tick()
    assert.equal(h.render(1).cacheStatus, 'ready')
    assert.equal(h.render(1).routeCaches, records)
    h.render(2)
    h.cleanup()
    requests[2].reject(new Error('unmounted failure')); await tick()
    assert.equal(h.render(2).cacheStatus, 'loading')
  } finally { h.cleanup() }
})

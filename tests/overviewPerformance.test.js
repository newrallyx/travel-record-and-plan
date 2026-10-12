import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { IDBFactory } from 'fake-indexeddb'
import { createHash } from 'node:crypto'
import { createOverviewCache, createPersistentOverviewCache, overviewCacheKey } from '../src/components/map/overviewCache.ts'
import { aggregateOverviewTracks, createOverviewHoverIndex, overviewLineWeight } from '../src/components/map/overviewAggregation.ts'
import { overviewDirectionMode, offsetScreenLine, screenDirectionArrows } from '../src/components/map/overviewDirectionDisplay.ts'
import * as roadTypes from '../src/components/map/roadTypeVisualization.ts'

const tracks = [{ segmentId: 'a', line: [{ lat: 34, lon: 109 }, { lat: 35, lon: 110 }], roadParts: [{ roadClass: 'EXPRESSWAY', manualDirection: '昆明', polyline: [[34, 109], [35, 110]] }] }]
test('overview cache reuses cloned scope and invalidates geometry, road class and direction edits', async () => {
  const cache = createOverviewCache()
  const key = await overviewCacheKey(tracks), result = [{ count: 2 }]
  assert.match(key, /^sha256:[0-9a-f]{64}$/)
  // Preserve the existing disk identity; deploying this fix must not invalidate saved overviews.
  const oldContent = JSON.stringify([3, tracks.map(({ segmentId, line, roadParts }) => [segmentId, line, roadParts])])
  assert.equal(key, `sha256:${createHash('sha256').update(oldContent).digest('hex')}`)
  cache.set(key, result)
  assert.equal(cache.get(await overviewCacheKey(structuredClone(tracks))), result)
  for (const edit of [t => t[0].line[0].lat++, t => t[0].roadParts[0].roadClass = 'NATIONAL_ROAD', t => t[0].roadParts[0].manualDirection = '北京',
    t => t[0].roadParts[0].concurrentRoads = [{ roadClass: 'EXPRESSWAY', routeRef: 'G70' }],
    t => t[0].roadParts[0].polyline[0][0]++,
    t => t[0].roadParts[0].provinceCandidates = ['610000', '620000']]) {
    const copy = structuredClone(tracks); edit(copy)
    assert.equal(cache.get(await overviewCacheKey(copy)), undefined)
  }
  const other = { ...tracks[0], segmentId: 'b' }
  assert.equal(await overviewCacheKey([...tracks, other]), await overviewCacheKey([other, ...tracks]))
  assert.notEqual(key, await overviewCacheKey([...tracks, other]))
})
test('overview cache retains recently revisited scopes and bounds memory', () => {
  const cache = createOverviewCache(2), first = []
  cache.set('all', first); cache.set('2025', [])
  assert.equal(cache.get('all'), first)
  cache.set('2026', [])
  assert.equal(cache.get('2025'), undefined)
  assert.equal(cache.get('all'), first)
})

test('actual overview layer keeps count-only paths even with stale direction data', () => {
  let zoom = 6, visible = true, cleanup, created = 0
  const handlers = {}, paths = []
  const group = () => ({ items: new Set(), addTo(parent) { parent.addLayer?.(this); return this }, addLayer(p) { this.items.add(p) }, removeLayer(p) { this.items.delete(p) }, clearLayers() { this.items.clear() }, remove() {} })
  const map = { getZoom: () => zoom, getBounds: () => ({ pad: () => ({ intersects: () => visible }) }), getSize: () => ({ x: 1000, y: 1000 }),
    latLngToContainerPoint: p => ({ x: p[1], y: p[0] }), containerPointToLatLng: p => ({ lat: p[1], lng: p[0] }),
    on: (events, fn) => events.split(' ').forEach(e => handlers[e] = fn), off: events => events.split(' ').forEach(e => delete handlers[e]) }
  const L = { canvas: () => ({ remove() {} }), layerGroup: group, latLngBounds: p => p,
    polyline: (positions, options) => {
      created++
      const p = { positions, options, addTo(g) { g.addLayer(this); return this }, setLatLngs(v) { this.positions = v; return this },
        setStyle(v) { Object.assign(this.options, v); return this }, bindTooltip() { return this },
        setTooltipContent(value) { this.tooltipContent = value; return this },
        on(name, fn) { this.events ??= {}; this.events[name] = fn; return this } }
      paths.push(p); return p
    } }
  const modules = {
    react: { useEffect: fn => { cleanup = fn() } }, 'react-leaflet': { useMap: () => map }, leaflet: { default: L },
    '../../config/roadStatistics': { ROAD_CLASS_LABELS: {} },
    './overviewAggregation': { createOverviewHoverIndex, overviewLineWeight }, './overviewDirectionDisplay': { overviewDirectionMode, offsetScreenLine, screenDirectionArrows },
    './roadTypeVisualization': roadTypes,
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/components/map/OverviewRouteLayer.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: id => { assert.ok(modules[id], id); return modules[id] },
    document: { createElement: () => ({ children: [], appendChild(child) { this.children.push(child) } }) } })
  const positions = [[50, 50], [50, 300]]
  exports.OverviewRouteLayer({ lines: [{ id: '1', positions, count: 3, roadClass: 'EXPRESSWAY', directions: { forward: { count: 2, positions }, reverse: { count: 1, positions } } }], routeColorMode: 'default', visibility: {} })
  assert.equal(created, 1)
  paths[0].events.mousemove({ latlng: { lat: 50, lng: 100 } })
  assert.match(paths[0].tooltipContent.children[1].textContent, /3 次/)
  zoom = 8
  handlers.zoomend?.(); handlers.moveend()
  assert.equal(created, 1, 'zoom reuses the same centerline')
  assert.equal(paths[0].options.weight, overviewLineWeight(3, 8))
  handlers.moveend(); assert.equal(created, 1, 'pan reuses visible path')
  assert.deepEqual(Object.keys(handlers), ['moveend'], 'one draw per completed zoom')
  zoom = 14; handlers.moveend()
  const detailedCount = created
  assert.equal(detailedCount, 1, 'stale direction data does not draw arrows')
  handlers.moveend(); assert.equal(created, detailedCount, 'the count-only path is reused')
  visible = false; handlers.moveend()
  visible = true; zoom = 6; handlers.moveend()
  assert.equal(created, detailedCount + 1, 'reentering view restores the line')
  cleanup(); assert.deepEqual(Object.keys(handlers), [])

  const east = [[34, 109], [34, 109.01]], west = [[34.0003, 109.01], [34.0003, 109]]
  exports.OverviewRouteLayer({ lines: [
    { id: 'east', positions: east, count: 8, roadClass: 'EXPRESSWAY', routeRef: 'G30', flowSign: 1, mainline: true, firstClassRoad: false },
    { id: 'west', positions: west, count: 9, roadClass: 'EXPRESSWAY', routeRef: 'G30', flowSign: 1, mainline: true, firstClassRoad: false },
  ], routeColorMode: 'default', visibility: {} })
  const [eastPath, westPath] = paths.slice(-2)
  eastPath.events.mousemove({ latlng: { lat: 34, lng: 109.005 } })
  westPath.events.mousemove({ latlng: { lat: 34.0003, lng: 109.005 } })
  assert.match(eastPath.tooltipContent.children[1].textContent, /17 次（双向合计/)
  assert.match(westPath.tooltipContent.children[1].textContent, /17 次（双向合计/)
  cleanup()

  const concurrentTracks = [
    ...Array.from({ length: 3 }, (_, i) => ({ segmentId: `east-${i}`, positions: east, routeRef: 'G22', concurrentRef: 'G70' })),
    ...Array.from({ length: 2 }, (_, i) => ({ segmentId: `west-${i}`, positions: west, routeRef: 'G70', concurrentRef: 'G22' })),
  ].map(({ segmentId, positions, routeRef, concurrentRef }) => ({ segmentId, segmentName: segmentId, points: [],
    line: positions.map(([lat, lon]) => ({ lat, lon })), roadParts: [{ roadClass: 'EXPRESSWAY', routeRef,
      concurrentRoads: [{ roadClass: 'EXPRESSWAY', routeRef: concurrentRef }], source: 'MANUAL', confidence: 'HIGH',
      polyline: positions, distanceMeters: 1000 }] }))
  const concurrentLines = aggregateOverviewTracks(concurrentTracks, false)
  exports.OverviewRouteLayer({ lines: concurrentLines, routeColorMode: 'default', visibility: {} })
  const concurrentPaths = paths.slice(-concurrentLines.length)
  for (const level of [6, 10, 14]) {
    zoom = level; handlers.moveend()
    concurrentPaths.forEach((path, i) => {
      const line = concurrentLines[i], lat = line.positions[0][0]
      for (const event of ['mouseover', 'mousemove']) path.events[event]({ latlng: { lat, lng: 109.005 } })
      assert.match(path.tooltipContent.children[0].textContent, /G22|G70/)
      assert.match(path.tooltipContent.children[1].textContent, /5 次（双向合计/)
    })
  }
  cleanup()

  const visibility = { ...roadTypes.DEFAULT_ROAD_TYPE_VISIBILITY, UNKNOWN: false }
  const lines = ['EXPRESSWAY', 'UNKNOWN'].map((roadClass, index) => ({
    id: `filter-${index}`, positions, count: 1, roadClass,
  }))
  for (const [routeColorMode, filters, expectedClasses] of [
    ['roadType', visibility, ['EXPRESSWAY']],
    ['roadType', { ...visibility, EXPRESSWAY: false, UNKNOWN: true }, ['UNKNOWN']],
    ['roadType', Object.fromEntries(roadTypes.ROAD_TYPE_VISIBILITY_CATEGORIES.map(key => [key, false])), []],
    ['default', visibility, ['EXPRESSWAY', 'UNKNOWN']],
  ]) {
    const before = paths.length
    exports.OverviewRouteLayer({ lines, routeColorMode, visibility: filters })
    assert.deepEqual(paths.slice(before).map(path => path.options.color), expectedClasses.map(roadClass =>
      routeColorMode === 'roadType' ? roadTypes.roadTypeColorForClass(roadClass) : '#4f46e5'))
    cleanup()
  }
})

test('hook hashes off-render, reuses caches, cancels obsolete work and reports failures', async () => {
  const cache = createOverviewCache(), disk = new Map(), workers = []
  let state, effectDeps, pendingEffect, cleanup, pendingRead
  const persistentOverviewCache = {
    get: key => pendingRead ?? Promise.resolve(disk.get(key)),
    set: async (key, lines) => disk.set(key, lines),
  }
  class Worker {
    constructor() { workers.push(this); this.messages = [] }
    postMessage(message) { this.messages.push(message) }
    terminate() { this.terminated = true }
  }
  const react = {
    useState: () => [state, value => { state = value }],
    useEffect: (fn, deps) => {
      if (!effectDeps || deps.some((v, i) => v !== effectDeps[i])) {
        pendingEffect = fn; effectDeps = deps
      }
    },
  }
  const source = readFileSync(new URL('../src/components/map/useOverviewAggregation.ts', import.meta.url), 'utf8').replace('import.meta.url', "'file:///overview.js'")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, URL, Worker, require: id => id === 'react' ? react : {
    overviewCache: cache, persistentOverviewCache,
    overviewCacheKey: () => { throw new Error('must never hash on the UI thread') },
  } })
  const render = (input, enabled) => {
    const value = exports.useOverviewAggregation(input, enabled)
    if (pendingEffect) { cleanup?.(); cleanup = pendingEffect(); pendingEffect = undefined }
    return value
  }
  const sendKey = async (worker, input) => worker.onmessage({ data: { type: 'key', key: await overviewCacheKey(input) } })
  // A render must not inspect even one coordinate or road-part field.
  const unreadable = [{ segmentId: 'guard', get line() { throw new Error('geometry read during render') } }]
  assert.equal(render(unreadable, true).pending, true)
  assert.equal(workers.at(-1).messages[0].tracks, unreadable)
  assert.equal(render(tracks, true).pending, true)
  const first = workers.at(-1), lines = [{ count: 2 }]
  await sendKey(first, tracks)
  assert.equal(first.messages[1].type, 'aggregate')
  assert.equal(first.messages.length, 2, 'geometry is sent only once')
  await first.onmessage({ data: { type: 'result', lines } })
  assert.equal(disk.get(await overviewCacheKey(tracks)), lines)
  assert.equal(first.terminated, true)
  assert.equal(render(tracks, true).lines, lines)
  render([], false)
  const count = workers.length
  assert.equal(render(tracks, true).lines, lines)
  assert.equal(workers.length, count, 'same snapshot is an immediate hit')
  const clone = structuredClone(tracks)
  assert.equal(render(clone, true).pending, true)
  const cloneWorker = workers.at(-1)
  await sendKey(cloneWorker, clone)
  assert.equal(render(clone, true).lines, lines)
  assert.equal(cloneWorker.messages.length, 1, 'cloned content skips aggregation')
  assert.equal(cloneWorker.terminated, true)
  const edited = structuredClone(tracks); edited[0].line[0].lat++
  render(edited, true)
  const obsolete = workers.at(-1)
  await sendKey(obsolete, edited)
  render(tracks, true)
  await obsolete.onmessage({ data: { type: 'result', lines: [{ count: 999 }] } })
  assert.equal(cache.get(await overviewCacheKey(edited)), undefined)
  assert.equal(render(tracks, true).lines, lines)
  const restored = structuredClone(tracks); restored[0].segmentId = 'restored'
  disk.set(await overviewCacheKey(restored), lines)
  render(restored, true)
  const restoreWorker = workers.at(-1)
  await sendKey(restoreWorker, restored)
  assert.equal(render(restored, true).lines, lines)
  assert.equal(restoreWorker.messages.length, 1, 'persistent hit skips aggregation')
  let resolveRead
  pendingRead = new Promise(resolve => { resolveRead = resolve })
  render(edited, true)
  const cancelled = workers.at(-1)
  const reading = sendKey(cancelled, edited)
  // Wait until the key callback is actually awaiting the database.
  await new Promise(resolve => setImmediate(resolve))
  render(tracks, true)
  resolveRead(undefined)
  await reading
  pendingRead = undefined
  assert.equal(cancelled.messages.length, 1, 'cancelled reads must not start aggregation')
  assert.equal(cancelled.terminated, true)
  render(edited, true)
  await workers.at(-1).onmessage({ data: { type: 'error' } })
  assert.equal(render(edited, true).error, true)
  assert.equal(render(edited, true).pending, false)
  render([], false)
  assert.equal(render(edited, true).pending, false)
  workers.at(-1).onerror()
  assert.equal(workers.at(-1).terminated, true)
  cleanup?.()
})

test('worker returns a compact key before aggregating the retained geometry', async () => {
  const messages = [], self = { postMessage: message => messages.push(message) }
  let aggregations = 0
  const source = readFileSync(new URL('../src/components/map/overviewAggregation.worker.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, { exports: {}, self, require: id => id === './overviewCache' ? { overviewCacheKey } : {
    aggregateOverviewTracks: (input, simplified) => { aggregations++; assert.equal(input, tracks); assert.equal(simplified, false); return [] },
  } })
  await self.onmessage({ data: { type: 'prepare', tracks } })
  assert.equal(messages[0].type, 'key')
  assert.match(messages[0].key, /^sha256:[0-9a-f]{64}$/)
  assert.equal(aggregations, 0)
  await self.onmessage({ data: { type: 'aggregate' } })
  assert.equal(aggregations, 1)
  assert.equal(messages[1].type, 'result')
  await self.onmessage({ data: { type: 'prepare', tracks: [{ get segmentId() { throw new Error('bad input') } }] } })
  assert.equal(messages.at(-1).type, 'error')
})

test('persistent overview cache survives new instances, rejects changed input and bounds saved scopes', async () => {
  const factory = new IDBFactory()
  const cache = createPersistentOverviewCache(factory)
  const key = await overviewCacheKey(tracks), lines = [{ count: 2, positions: [[34, 109], [35, 110]] }]
  await cache.set(key, lines)
  const db = await new Promise((resolve, reject) => {
    const request = factory.open('trip-overview-cache', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const savedKeys = await new Promise(resolve => {
    const request = db.transaction('results').objectStore('results').getAllKeys()
    request.onsuccess = () => resolve(request.result)
  })
  db.close()
  assert.match(savedKeys[0], /^sha256:[0-9a-f]{64}$/)
  const restarted = createPersistentOverviewCache(factory)
  assert.deepEqual(await restarted.get(key), lines)
  const edited = structuredClone(tracks); edited[0].line[0].lat++
  assert.equal(await restarted.get(await overviewCacheKey(edited)), undefined)
  // Fixed timestamps avoid timing-dependent eviction assertions.
  const originalNow = Date.now
  let now = originalNow()
  try {
    Date.now = () => ++now
    for (const scope of ['a', 'b', 'c']) await restarted.set(scope, [])
  } finally { Date.now = originalNow }
  assert.equal(await restarted.get(key), undefined)
  assert.deepEqual(await restarted.get('c'), [])
  const unavailable = createPersistentOverviewCache({ open() { throw new Error('blocked') } })
  assert.equal(await unavailable.get(key), undefined)
  await unavailable.set(key, lines)
})

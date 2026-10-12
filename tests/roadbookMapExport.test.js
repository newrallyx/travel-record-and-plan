import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRoadbookMapModel, buildRoadbookMapSvg, getExportMapTiles, projectExportMapPoint } from '../src/utils/roadbookMapExport.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'
import { ROAD_TYPE_MAP_COLORS } from '../src/components/map/roadTypeVisualization.ts'
import { createRoadbookTileHandler } from '../backend/src/roadbookTileProxy.js'

const points = [{ lat: 34.2, lon: 108.9 }, { lat: 33.9, lon: 108.5 }, { lat: 33.2, lon: 108.3 }, { lat: 32.8, lon: 108.7 }]
const segment = { id: 's', name: '当天路线', startPoint: '西安', endPoint: '安康', preference: 'HIGHWAY_FIRST', points,
  waypoints: [{ id: 'w1', name: '<宁陕>', lat: 33.2, lng: 108.3 }, { id: 'w2', name: '坐标待补充' }] }
segment.routeBuildKey = buildSegmentRouteKey(segment)
const cache = { segmentId: 's', routeBuildKey: segment.routeBuildKey, points,
  roadAnalysis: { routeBuildKey: segment.routeBuildKey, classifierVersion: ROAD_CLASSIFIER_VERSION, status: 'complete' },
  roadParts: ['EXPRESSWAY', 'NATIONAL_ROAD', 'URBAN_ROAD'].map((roadClass, i) => ({ roadClass, polyline: [[points[i].lat, points[i].lon], [points[i + 1].lat, points[i + 1].lon]] })) }
test('daily export reuses road-type colors and separate parts with a gray coverage underlay, without mutating data', () => {
  const before = JSON.stringify({ segment, cache })
  const model = buildRoadbookMapModel([segment], [cache])
  assert.deepEqual(model.lines.map(line => line.color), [ROAD_TYPE_MAP_COLORS.UNKNOWN, ROAD_TYPE_MAP_COLORS.EXPRESSWAY, ROAD_TYPE_MAP_COLORS.NATIONAL_ROAD, ROAD_TYPE_MAP_COLORS.OTHER])
  assert.equal(model.lines[1].points.length, 2)
  assert.equal(JSON.stringify({ segment, cache }), before)
  assert.deepEqual(model.unpositionedWaypoints, ['坐标待补充'])
  const svg = buildRoadbookMapSvg(model, { dataUrl: 'data:image/jpeg;base64,AAAA' })
  for (const label of ['高速公路', '国道', '省道', '其他道路', '未知道路', '起点：西安', '终点：安康', '&lt;宁陕&gt;', 'route-direction', '底图 © 高德地图', '底图已嵌入']) assert.ok(svg.includes(label), label)
  assert.doesNotMatch(svg, /<宁陕>|hsl\(/)
})
test('stale and missing classifications stay gray and failed basemaps have an explicit fallback', () => {
  const model = buildRoadbookMapModel([segment], [{ ...cache, roadAnalysis: { ...cache.roadAnalysis, classifierVersion: 'old' } }])
  assert.equal(model.lines.length, 1)
  assert.equal(model.unclassifiedSegmentCount, 1)
  const html = buildRoadbookMapSvg(model, { failure: '<网络断开>', dataUrl: 'https://external.example/map.png' })
  assert.match(html, /底图获取失败：&lt;网络断开&gt;/)
  assert.match(html, /无底图路线示意图/)
  assert.doesNotMatch(html, /<image|https:\/\//)
})
test('basemap tiles share the route projection and fully cover the viewport', () => {
  const model = buildRoadbookMapModel([segment], [cache]), viewport = model.viewport
  const tiles = getExportMapTiles(viewport)
  for (const point of points) {
    const [worldX, worldY] = projectExportMapPoint(point, viewport.zoom)
    const [tileX, tileY] = projectExportMapPoint(point, tiles[0].z)
    const tile = tiles.find(tile => tile.x === Math.floor(tileX / 256) && tile.y === Math.floor(tileY / 256))
    assert.ok(tile)
    assert.ok(Number.isInteger(tile.z))
    assert.ok(Math.abs(tile.left + (tileX % 256) * tile.size / 256 - (worldX - viewport.left)) < .000001)
    assert.ok(Math.abs(tile.top + (tileY % 256) * tile.size / 256 - (worldY - viewport.top)) < .000001)
    assert.ok(worldX - viewport.left > 0 && worldX - viewport.left < viewport.width)
  }
  assert.ok(Math.min(...tiles.map(tile => tile.left)) <= 0)
  assert.ok(Math.max(...tiles.map(tile => tile.left + tile.size)) >= viewport.width)
  assert.ok(Math.min(...tiles.map(tile => tile.top)) <= 0)
  assert.ok(Math.max(...tiles.map(tile => tile.top + tile.size)) >= viewport.height)
})
test('route tightly fits the available map space for tall and wide tracks without clipping', () => {
  for (const points of [segment.points, [{ lat: 30, lon: 105 }, { lat: 30.1, lon: 112 }]]) {
    const route = { ...segment, points, waypoints: [] }
    route.routeBuildKey = buildSegmentRouteKey(route)
    const viewport = buildRoadbookMapModel([route], []).viewport
    const pixels = points.map(point => projectExportMapPoint(point, viewport.zoom))
    const spanX = Math.max(...pixels.map(p => p[0])) - Math.min(...pixels.map(p => p[0]))
    const spanY = Math.max(...pixels.map(p => p[1])) - Math.min(...pixels.map(p => p[1]))
    assert.ok(Math.abs(Math.max(spanX / (viewport.width - 96), spanY / (viewport.height - 96)) - 1) < 1e-9)
    for (const [x, y] of pixels) {
      assert.ok(x - viewport.left >= 48 - 1e-9 && x - viewport.left <= viewport.width - 48 + 1e-9)
      assert.ok(y - viewport.top >= 48 - 1e-9 && y - viewport.top <= viewport.height - 48 + 1e-9)
    }
  }
})
test('daily waypoints include intermediate segment ends in travel order, with coordinate and saved-route fallbacks', () => {
  const segments = Array.from({ length: 6 }, (_, i) => {
    const route = { id: `day-${i}`, name: `路段${i}`, startPoint: `地点${i}`, endPoint: `地点${i + 1}`, preference: 'HIGHWAY_FIRST',
      points: [{ lat: 32 - i * .1, lon: 108 + i * .1 }, { lat: 31.9 - i * .1, lon: 108.1 + i * .1 }],
      waypoints: i === 0 ? [{ name: '段内途经点', lat: 31.95, lng: 108.05 }] : [] }
    route.routeBuildKey = buildSegmentRouteKey(route)
    return route
  })
  const cached = { segmentId: segments[1].id, routeBuildKey: segments[1].routeBuildKey, points: segments[1].points }
  segments[1].points = undefined
  segments[2].endCoord = { lat: 31.71, lon: 108.31 }
  const before = JSON.stringify(segments)
  const model = buildRoadbookMapModel(segments, [cached])
  const via = model.markers.filter(marker => marker.kind === 'waypoint')
  assert.deepEqual(via.map(marker => marker.label), ['段内途经点', '地点1', '地点2', '地点3', '地点4', '地点5'])
  assert.deepEqual(via[2].point, cached.points.at(-1))
  assert.deepEqual(via[3].point, segments[2].endCoord)
  assert.equal(model.markers.filter(marker => marker.kind === 'end').length, 1)
  assert.equal(JSON.stringify(segments), before)
  segments[0].waypoints.push({ name: '地点1', lat: via[1].point.lat, lng: via[1].point.lon })
  assert.equal(buildRoadbookMapModel(segments, [cached]).markers.filter(marker => marker.label === '地点1').length, 1)
  segments[3].points = undefined
  const missing = buildRoadbookMapModel(segments, [cached])
  assert.ok(missing.unpositionedWaypoints.includes('地点4'))
  assert.ok(!missing.markers.some(marker => marker.label === '地点4'))
})
test('missing boundary geometry is not relabeled as a start or end of a different segment', () => {
  const missing = { ...segment, id: 'missing', points: undefined, waypoints: [] }
  const model = buildRoadbookMapModel([missing, segment, missing], [cache])
  assert.equal(model.markers.filter(marker => marker.kind !== 'waypoint').length, 0)
  assert.equal(model.missingRouteCount, 2)
  assert.equal(buildRoadbookMapModel([], []).viewport, null)
})
test('separate route sections are not connected and large tracks do not overflow spread limits', () => {
  const second = { ...segment, id: 'second', points: [{ lat: 35, lon: 110 }, { lat: 35.5, lon: 111 }] }
  const model = buildRoadbookMapModel([segment, second], [])
  assert.equal(model.lines.length, 2)
  assert.equal(model.directions.length, 2)
  const large = { ...segment, points: Array.from({ length: 150000 }, (_, i) => ({ lat: 30 + i / 1500000, lon: 108 })) }
  assert.ok(buildRoadbookMapModel([large], []).viewport)
})
function response() { return { code: 200, headers: {}, status(code) { this.code = code; return this }, json(body) { this.body = body }, send(body) { this.body = body }, setHeader(key, value) { this.headers[key] = value } } }
test('tile proxy only accepts bounded integer tiles and the fixed AMap endpoint', async () => {
  let requests = 0
  const handler = createRoadbookTileHandler({ fetchImpl: async (url, options) => {
    requests++
    assert.equal(new URL(url).hostname, 'webrd01.is.autonavi.com')
    assert.equal(options.redirect, 'error')
    return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
  } })
  for (const query of [{ x: '-1', y: '1', z: '5' }, { x: '32', y: '1', z: '5' }, { x: '1', y: '1', z: '19' }, { x: 'https://bad', y: '1', z: '5' }, { x: '1.2', y: '1', z: '5' }]) {
    const res = response(); await handler({ query }, res); assert.equal(res.code, 400)
  }
  assert.equal(requests, 0)
  const res = response(); await handler({ query: { x: '1', y: '1', z: '5' } }, res)
  assert.equal(res.code, 200); assert.equal(res.headers['Content-Type'], 'image/png')
})
test('failed or non-image upstream tiles return a controlled error', async () => {
  for (const fetchImpl of [async () => { throw new Error('offline') }, async () => new Response('<html>Error</html>', { headers: { 'content-type': 'text/html' } })]) {
    const res = response(); await createRoadbookTileHandler({ fetchImpl })({ query: { x: '1', y: '1', z: '5' } }, res)
    assert.equal(res.code, 502)
  }
})

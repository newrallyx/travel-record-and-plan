import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRoadbookHtml, createRoadbookFilename } from '../src/utils/roadbookExport.ts'
import { buildSegmentRouteKey } from '../src/utils/routeBuildKey.ts'
import { validateRoadbookPdfPayload, saveRoadbookPdf, renderRoadbookPdf } from '../electron/roadbookExport.mjs'
import { ROAD_CLASSIFIER_VERSION } from '../src/config/roadStatistics.ts'

const segment = { id: 's1', name: '川西路段', startPoint: '成都', endPoint: '康定', preference: 'HIGHWAY_FIRST', note: '<script>alert(1)</script>',
  waypoints: [{ id: 'w', name: '折多山' }], distanceMeters: 1000, photoIds: ['p1'], reviewFacts: { actual: { distanceMeters: 0 } } }
segment.routeBuildKey = buildSegmentRouteKey(segment)
const trip = { id: 't1', title: '秋游 <img onerror=alert(1)>', category: 'review', startDate: '2026-10-01', endDate: '2026-10-02',
  travelogue: '**雪山**', days: [{ id: 'd2', date: '2026-10-02', routeSegments: [] }, { id: 'd1', date: '2026-10-01', routeSegments: [segment] }] }
const caches = [{ segmentId: 's1', routeBuildKey: segment.routeBuildKey, points: [{ lat: 30, lon: 102 }, { lat: 31, lon: 103 }] }]
test('roadbook includes chronological days, routes, notes, statistics and embedded selected photos without scripts or paths', () => {
  const photo = { id: 'p1', segmentId: 's1', filename: '雪山.jpg', note: '<雪山日出>', dataUrl: 'data:image/png;base64,AAAA' }
  const html = buildRoadbookHtml(trip, caches, [photo], photo)
  for (const value of ['旅程路线总览', '折多山', '道路统计', '实际记录：0.0 公里', '雪山.jpg', '&lt;雪山日出&gt;', '**雪山**']) assert.ok(html.includes(value), value)
  assert.ok(html.indexOf('第 1 天 · 2026-10-01') < html.indexOf('第 2 天 · 2026-10-02'))
  assert.match(html, /<svg/)
  assert.match(html, /data:image\/png;base64,AAAA/)
  assert.doesNotMatch(html, /<script>|<img onerror/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /实际里程<strong>0.0 公里<\/strong>/)
})
test('missing data remains missing, invalid cached routes are not drawn and sources are preserved', () => {
  const missing = { ...segment, distanceMeters: undefined, reviewFacts: undefined, photoIds: [] }
  const source = { ...trip, days: [{ id: 'd', date: '2026-10-01', routeSegments: [missing] }] }
  const before = JSON.stringify(source)
  const html = buildRoadbookHtml(source, [{ ...caches[0], routeBuildKey: 'stale' }])
  assert.match(html, /待补全/)
  assert.match(html, /1 条路段缺少匹配路线/)
  assert.doesNotMatch(html, /<polyline/)
  assert.equal(JSON.stringify(source), before)
})
test('photo URLs and ownership are constrained and unavailable images retain captions', () => {
  const html = buildRoadbookHtml(trip, caches, [
    { id: 'p1', segmentId: 's1', filename: 'missing.jpg', dataUrl: 'https://example.com/private.png' },
    { id: 'other', segmentId: 's1', filename: 'not-selected.jpg' },
  ])
  assert.doesNotMatch(html, /https:\/\/|not-selected.jpg/)
  assert.match(html, /missing.jpg/)
  assert.match(html, /照片缩略图不可用/)
})
test('known zero road mileage stays zero instead of pending', () => {
  const cache = { ...caches[0], roadParts: [{ roadClass: 'NATIONAL_ROAD', routeRef: 'G318', distanceMeters: 1000 }],
    roadAnalysis: { routeBuildKey: segment.routeBuildKey, classifierVersion: ROAD_CLASSIFIER_VERSION, status: 'complete' } }
  const html = buildRoadbookHtml(trip, [cache])
  assert.match(html, /高速公路<\/td><td>0.0 公里/)
})

test('planning roadbook exports all days and planning facts without presenting review data', () => {
  const plannedSegment = { ...segment, estimatedDurationSeconds: 3600, estimatedTollYuan: 0 }
  const source = { ...trip, category: 'plan', days: [trip.days[0], { ...trip.days[1], routeSegments: [plannedSegment] }] }
  const before = JSON.stringify(source)
  const html = buildRoadbookHtml(source, caches)
  for (const value of ['旅行路书 · 规划', '逐日规划汇总', '预计路线用时', '高速优先', '本路书为规划快照', '这一天没有规划路段', '不含游览、休息和住宿']) assert.ok(html.includes(value), value)
  assert.match(html, /2026-10-01<\/td><td>1<\/td><td>1.0 公里<\/td><td>1小时<\/td><td>¥0/)
  assert.ok(html.indexOf('第 1 天 · 2026-10-01') < html.indexOf('第 2 天 · 2026-10-02'))
  assert.doesNotMatch(html, /实际记录|实际里程<strong>|实际驾车用时<strong>|风景评分|<h2>游记/)
  assert.equal(createRoadbookFilename(source.title, 'pdf', 'plan'), '秋游 _img onerror=alert(1)_-规划路书.pdf')
  assert.equal(JSON.stringify(source), before)
})

test('planning daily totals label partial and stale estimates instead of filling missing values with zero', () => {
  const known = { ...segment, estimatedDurationSeconds: 3600, estimatedTollYuan: 0 }
  const missing = { ...segment, id: 's2', distanceMeters: undefined, estimatedDurationSeconds: 600, estimatedTollYuan: 20, routeBuildKey: 'stale', reviewFacts: undefined }
  const source = { ...trip, category: 'plan', days: [{ id: 'd', date: '2026-10-01', routeSegments: [known, missing] }] }
  const html = buildRoadbookHtml(source, caches)
  assert.match(html, /2026-10-01<\/td><td>2<\/td><td>已记录 1.0 公里/)
  assert.match(html, /1小时（另有 1 条待计算）/)
  assert.match(html, /¥0（另有 1 条待计算）/)
  assert.match(html, /1 条路段缺少匹配路线/)
  const allMissing = buildRoadbookHtml({ ...source, days: [{ ...source.days[0], routeSegments: [missing] }] }, [])
  assert.match(allMissing, /2026-10-01<\/td><td>1<\/td><td>待补全<\/td><td>待计算<\/td><td>待计算（1 条驾车线路）/)
})
test('filenames and PDF payload reject unsafe or oversized values', () => {
  assert.equal(createRoadbookFilename('成都/康定:秋游', 'pdf'), '成都_康定_秋游-路书.pdf')
  assert.equal(createRoadbookFilename('...', 'html'), '旅行-路书.html')
  assert.deepEqual(validateRoadbookPdfPayload({ html: '<!doctype html><head></head>', filename: '路书.pdf' }).filename, '路书.pdf')
  for (const payload of [{ html: '<script>', filename: 'a.pdf' }, { html: '<!doctype html>', filename: '../a.pdf' },
    { html: '<!doctype html>' + 'a'.repeat(32 * 1024 * 1024), filename: 'a.pdf' }]) assert.throws(() => validateRoadbookPdfPayload(payload))
})
test('cancelled PDF save does not create a render window', async () => {
  const result = await saveRoadbookPdf({ BrowserWindow: class { constructor() { throw new Error('should not render') } },
    dialog: { showSaveDialog: async () => ({ canceled: true }) }, payload: { html: '<!doctype html>', filename: '旅行.pdf' } })
  assert.deepEqual(result, { cancelled: true })
})
test('native PDF renderer isolates content, waits for assets, prints A4 and always closes its window', async () => {
  let instance
  class Window {
    constructor(options) {
      instance = this; this.options = options; this.destroyed = false
      this.webContents = {
        setWindowOpenHandler: handler => { this.openHandler = handler }, on: () => {},
        session: { webRequest: { onBeforeRequest: handler => { this.requestHandler = handler } } },
        executeJavaScript: async code => { this.waitCode = code },
        printToPDF: async options => { this.printOptions = options; return Buffer.from('%PDF-test') },
      }
    }
    async loadFile(path) { this.path = path; this.html = await readFile(path, 'utf8') }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  const largeContent = '路书'.repeat(600000)
  const pdf = await renderRoadbookPdf(Window, `<!doctype html><script>bad()</script><!--${largeContent}-->`)
  assert.equal(pdf.toString(), '%PDF-test')
  assert.equal(instance.options.webPreferences.sandbox, true)
  assert.equal(instance.options.webPreferences.nodeIntegration, false)
  assert.equal(instance.options.webPreferences.preload, undefined)
  assert.match(instance.options.webPreferences.partition, /^roadbook-export-/)
  const html = instance.html
  assert.ok(Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024)
  assert.ok(html.includes(largeContent))
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'))
  for (const url of ['https://example.com', 'file:///private.txt']) instance.requestHandler({ url }, response => assert.equal(response.cancel, true))
  instance.requestHandler({ url: 'data:image/png;base64,AAAA' }, response => assert.equal(response.cancel, false))
  instance.requestHandler({ url: pathToFileURL(instance.path).href, resourceType: 'mainFrame' }, response => assert.equal(response.cancel, false))
  instance.requestHandler({ url: pathToFileURL(instance.path).href, resourceType: 'subFrame' }, response => assert.equal(response.cancel, true))
  instance.requestHandler({ url: pathToFileURL(join(dirname(instance.path), 'other.html')).href, resourceType: 'mainFrame' }, response => assert.equal(response.cancel, true))
  assert.deepEqual(instance.openHandler(), { action: 'deny' })
  assert.match(instance.waitCode, /document.fonts.ready/)
  assert.equal(instance.printOptions.pageSize, 'A4')
  assert.equal(instance.destroyed, true)
  await assert.rejects(readFile(instance.path), { code: 'ENOENT' })
  await assert.rejects(readFile(dirname(instance.path)), { code: 'ENOENT' })
})
test('PDF renderer destroys its window on load failure', async () => {
  let destroyed = false
  let htmlPath
  class Window {
    webContents = { setWindowOpenHandler() {}, on() {}, session: { webRequest: { onBeforeRequest() {} } } }
    async loadFile(path) { htmlPath = path; throw new Error('load failed') }
    isDestroyed() { return false }
    destroy() { destroyed = true }
  }
  await assert.rejects(() => renderRoadbookPdf(Window, '<!doctype html>'), /load failed/)
  assert.equal(destroyed, true)
  await assert.rejects(readFile(htmlPath), { code: 'ENOENT' })
})

test('PDF replacement writes the rendered PDF and preserves the old file when rendering fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roadbook-save-test-'))
  const filePath = join(directory, '旅行.pdf')
  class Window {
    webContents = {
      setWindowOpenHandler() {}, on() {}, session: { webRequest: { onBeforeRequest() {} } },
      executeJavaScript: async () => true, printToPDF: async () => Buffer.from('%PDF-new'),
    }
    async loadFile() {}
    isDestroyed() { return false }
    destroy() {}
  }
  class FailingWindow extends Window { async loadFile() { throw new Error('load failed') } }
  const options = { dialog: { showSaveDialog: async () => ({ canceled: false, filePath }) },
    payload: { html: '<!doctype html><p>旅行路书</p>', filename: '旅行.pdf' } }
  try {
    await writeFile(filePath, '%PDF-old')
    await assert.rejects(saveRoadbookPdf({ ...options, BrowserWindow: FailingWindow }), /load failed/)
    assert.equal(await readFile(filePath, 'utf8'), '%PDF-old')
    assert.deepEqual(await saveRoadbookPdf({ ...options, BrowserWindow: Window }), { cancelled: false, filename: '旅行.pdf' })
    assert.equal(await readFile(filePath, 'utf8'), '%PDF-new')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

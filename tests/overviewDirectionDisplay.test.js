import assert from 'node:assert/strict'
import test from 'node:test'
import { readRoadDestination } from '../src/components/map/roadDirectionNames.ts'
import { offsetScreenLine, screenDirectionArrows, overviewDirectionMode } from '../src/components/map/overviewDirectionDisplay.ts'

test('only current-road explicit endpoint text is accepted; exits and compass guesses are rejected', () => {
  const part = { source: 'ROAD_CODE', roadName: '京昆高速', instruction: '沿京昆高速向昆明方向行驶2公里' }
  assert.equal(readRoadDestination(part, 'G5'), '昆明')
  assert.equal(readRoadDestination({ ...part, instruction: '沿京昆高速行驶2公里，朝北京方向驶入匝道' }, 'G5'), undefined)
  assert.equal(readRoadDestination({ ...part, instruction: '沿京昆高速向南行驶2公里' }, 'G5'), undefined)
  assert.equal(readRoadDestination({ ...part, source: 'MANUAL' }, 'G5'), undefined)
  assert.equal(readRoadDestination({ ...part, roadName: '甘钦线（钦州方向）', instruction: '' }, 'G242'), '钦州')
  assert.equal(readRoadDestination({ ...part, roadName: '甘钦线', instruction: '沿甘钦线向钦州方向行驶2公里' }, 'G242'), '钦州')
  assert.equal(readRoadDestination({ ...part, instruction: '沿G50向昆明方向行驶2公里' }, 'G5'), undefined)
  assert.equal(readRoadDestination({ ...part, roadName: '京昆高速（北京方向、昆明方向）' }, 'G5'), undefined)
})

test('screen separation uses opposite sides, remains finite through bends and does not mutate geometry', () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
  const before = structuredClone(line)
  assert.equal(offsetScreenLine(line, 5)[0].y, 5)
  assert.equal(offsetScreenLine(line, -5)[0].y, -5)
  assert.ok(offsetScreenLine(line, 5).every((p) => Number.isFinite(p.x + p.y)))
  assert.deepEqual(line, before)
})

test('chevrons reverse travel direction and are restricted to viewport', () => {
  const a = { x: 0, y: 100 }, b = { x: 600, y: 100 }
  const east = screenDirectionArrows([a, b], 500, 300), west = screenDirectionArrows([b, a], 500, 300)
  assert.ok(east.length > 0 && west.length > 0)
  assert.ok(east.every((arrow) => arrow[1].x > arrow[0].x))
  assert.ok(west.every((arrow) => arrow[1].x < arrow[0].x))
  assert.ok([...east, ...west].every((arrow) => arrow[1].x <= 500))
  assert.equal(overviewDirectionMode(9), 'total')
  assert.equal(overviewDirectionMode(12), 'focus')
  assert.equal(overviewDirectionMode(14), 'directions')
})

test('a short densely sampled line still gets a direction arrow', () => {
  const line = Array.from({ length: 21 }, (_, i) => ({ x: 100 + i, y: 100 }))
  assert.equal(screenDirectionArrows(line, 300, 300).length, 1)
})

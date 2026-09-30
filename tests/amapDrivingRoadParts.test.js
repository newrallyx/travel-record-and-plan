import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseDrivingPath } from '../src/services/amap/routeApi.ts'
import { buildDrivingRouteResult } from '../src/services/amap/routePlanner.ts'

const FIXTURE_URL = new URL('./fixtures/amap-driving-path.json', import.meta.url)

function loadDrivingPathFixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, 'utf8'))
}

test('realistic AMap driving path keeps route totals and emits unmerged road parts', () => {
  const result = parseDrivingPath(loadDrivingPathFixture())

  assert.equal(result.distanceMeters, 17682)
  assert.equal(result.durationSeconds, 1342)
  assert.equal(result.estimatedTollYuan, 8.5)
  assert.equal(result.tollDistanceMeters, 8200)
  assert.equal(result.distanceText, '17682 米')
  assert.equal(result.durationText, '1342 秒')

  assert.equal(result.roadParts?.length, 4)
  assert.deepEqual(result.roadParts?.map((part) => part.distanceMeters), [5200, 3000, 480, 9002])
  assert.equal(result.roadParts?.reduce((sum, part) => sum + part.distanceMeters, 0), 17682)

  assert.deepEqual(result.roadParts?.slice(0, 2).map((part) => ({
    roadClass: part.roadClass,
    routeRef: part.routeRef,
  })), [
    { roadClass: 'EXPRESSWAY', routeRef: 'G65' },
    { roadClass: 'EXPRESSWAY', routeRef: 'G65' },
  ])
})

test('road parts retain step metadata and preserve an empty road name as missing', () => {
  const result = parseDrivingPath(loadDrivingPathFixture())
  const [first, , unnamed, national] = result.roadParts ?? []

  assert.equal(first.roadName, 'G65 包茂高速')
  assert.equal(first.tollRoad, '包茂高速')
  assert.equal(first.instruction, '沿G65包茂高速向北行驶5.2公里')
  assert.deepEqual(first.polyline, [
    [34.2, 108.9],
    [34.21, 108.91],
    [34.22, 108.92],
  ])

  assert.equal(unnamed.roadClass, 'UNKNOWN')
  assert.equal(unnamed.roadName, undefined)
  assert.equal(Object.hasOwn(unnamed, 'roadName'), false)
  assert.equal(unnamed.routeRef, undefined)
  assert.equal(unnamed.tollRoad, undefined)
  assert.equal(unnamed.instruction, '进入匝道并行驶480米')

  assert.equal(national.roadClass, 'NATIONAL_ROAD')
  assert.equal(national.routeRef, 'G210')
  assert.equal(national.distanceMeters, 9002)
})

test('whole-route polyline preserves step order and removes adjacent step joins once', () => {
  const result = parseDrivingPath(loadDrivingPathFixture())

  assert.deepEqual(result.polyline, [
    [34.2, 108.9],
    [34.21, 108.91],
    [34.22, 108.92],
    [34.23, 108.93],
    [34.24, 108.94],
    [34.245, 108.945],
    [34.25, 108.95],
    [34.26, 108.96],
  ])
})

test('G65 toll-road tunnels remain expressway parts while the city approach stays urban', () => {
  const result = parseDrivingPath({
    distance: '29175',
    duration: '1200',
    toll_distance: '24721',
    steps: [
      {
        road: '曲江路',
        distance: '4454',
        toll_distance: '0',
        instruction: '沿曲江路途径G65包茂高速入口向南行驶到达收费站',
        polyline: '108.9,34.2;108.91,34.19',
      },
      {
        road: 'G65包茂高速',
        toll_road: 'G65包茂高速',
        distance: '220',
        toll_distance: '220',
        instruction: '沿G65包茂高速向南行驶220米',
        polyline: '108.91,34.19;108.92,34.18',
      },
      {
        road: '秦岭终南山公路隧道',
        toll_road: '秦岭终南山公路隧道',
        distance: '23844',
        toll_distance: '23844',
        instruction: '沿秦岭终南山公路隧道途径G65包茂高速向南行驶',
        polyline: '108.92,34.18;109.0,33.8',
      },
      {
        road: '营盘立交',
        toll_road: '营盘立交',
        distance: '657',
        toll_distance: '657',
        instruction: '沿营盘立交向东行驶657米到达目的地',
        polyline: '109.0,33.8;109.04,33.78',
      },
    ],
  })

  assert.deepEqual(result.roadParts?.map((part) => [part.roadClass, part.routeRef]), [
    ['URBAN_ROAD', undefined],
    ['EXPRESSWAY', 'G65'],
    ['EXPRESSWAY', 'G65'],
    ['EXPRESSWAY', 'G65'],
  ])
})

test('a G211 corridor ends before the following Huling Road steps', () => {
  const path = {
    distance: '24754',
    duration: '1800',
    steps: [
      {
        road: 'G65包茂高速出口',
        distance: '198',
        instruction: '沿G65包茂高速出口向东南行驶198米右转',
        polyline: '109.172060,33.432236;109.173599,33.431053',
      },
      {
        road: '211国道',
        distance: '1267',
        instruction: '沿211国道向西南行驶1.3千米向左前方行驶',
        polyline: '109.173599,33.431053;109.18,33.40',
      },
      {
        road: '锦湖大桥',
        distance: '185',
        instruction: '沿锦湖大桥向西南行驶185米左转',
        polyline: '109.18,33.40;109.18,33.39',
      },
      {
        road: '211国道',
        distance: '9757',
        instruction: '沿211国道途径东米路、户冷路向南行驶9.8千米向左前方行驶',
        polyline: '109.18,33.39;109.20,33.30',
      },
      {
        road: '户冷路',
        distance: '4925',
        instruction: '沿户冷路向东北行驶4.9千米向右前方行驶',
        polyline: '109.20,33.30;109.24,33.31',
      },
      {
        road: '户冷路',
        distance: '8422',
        instruction: '沿户冷路途径铁湖路向东行驶8.4千米到达途经地',
        polyline: '109.24,33.31;109.29,33.30',
      },
    ],
  }

  const parsed = parseDrivingPath(path)
  const route = buildDrivingRouteResult(parsed, 'g211-huling-route', '2026-09-03T03:00:00.000Z')
  assert.deepEqual(route.roadParts?.map((part) => [part.roadClass, part.routeRef, part.distanceMeters]), [
    ['EXPRESSWAY', 'G65', 198],
    ['NATIONAL_ROAD', 'G211', 11209],
    ['URBAN_ROAD', undefined, 4925],
    ['URBAN_ROAD', undefined, 8422],
  ])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyRoad,
  classifyRoadPartEvidence,
  extractRouteRef,
  mergeAdjacentRoadParts,
  normalizeRoadText,
  reclassifyRoadParts,
} from '../src/utils/roadClassifier.ts'

test('road text normalization converts full-width text, folds spaces and uppercases letters', () => {
  assert.equal(normalizeRoadText('  ｇ  ６５　包茂高速  '), 'G 65 包茂高速')
  assert.equal(extractRouteRef('  ｇ  ６５　包茂高速  '), 'G65')
  assert.equal(extractRouteRef('经 G210／S101 前往目的地'), 'G210')
  assert.equal(extractRouteRef('沿345国道向西行驶'), 'G345')
  assert.equal(extractRouteRef('沿310县道向西行驶'), 'X310')
  assert.equal(extractRouteRef('AG65 测试道路'), undefined)
})

test('G65 包茂高速 is classified by its expressway keyword and keeps its route ref', () => {
  assert.deepEqual(classifyRoad('G65 包茂高速'), {
    normalizedRoadName: 'G65 包茂高速',
    roadClass: 'EXPRESSWAY',
    routeRef: 'G65',
    confidence: 'HIGH',
    source: 'ROAD_NAME',
  })
})

test('unnumbered expressway stays an expressway without inventing a route ref', () => {
  const result = classifyRoad('包茂高速')
  assert.equal(result.roadClass, 'EXPRESSWAY')
  assert.equal(result.confidence, 'HIGH')
  assert.equal(result.routeRef, undefined)
  assert.equal(Object.hasOwn(result, 'routeRef'), false)
})

test('national and provincial road keywords classify three-digit refs explicitly', () => {
  assert.deepEqual(classifyRoad('G210 国道'), {
    normalizedRoadName: 'G210 国道',
    roadClass: 'NATIONAL_ROAD',
    routeRef: 'G210',
    confidence: 'HIGH',
    source: 'ROAD_NAME',
  })
  assert.deepEqual(classifyRoad('S101 省道'), {
    normalizedRoadName: 'S101 省道',
    roadClass: 'PROVINCIAL_ROAD',
    routeRef: 'S101',
    confidence: 'HIGH',
    source: 'ROAD_NAME',
  })
})

test('city roads and unnamed roads use distinct fallback semantics', () => {
  assert.equal(classifyRoad('城市道路').roadClass, 'URBAN_ROAD')
  assert.equal(classifyRoad('人民大道').roadClass, 'URBAN_ROAD')
  assert.deepEqual(classifyRoad('无名道路'), {
    normalizedRoadName: '无名道路',
    roadClass: 'UNKNOWN',
    confidence: 'LOW',
    source: 'FALLBACK',
  })
  assert.equal(classifyRoad('').roadClass, 'UNKNOWN')
})

test('explicit keywords win over digit-count conventions and conflicting refs lower confidence', () => {
  const expresswayWithNationalStyleRef = classifyRoad('G210 包茂高速')
  assert.equal(expresswayWithNationalStyleRef.roadClass, 'EXPRESSWAY')
  assert.equal(expresswayWithNationalStyleRef.routeRef, 'G210')
  assert.equal(expresswayWithNationalStyleRef.confidence, 'MEDIUM')

  const expresswayWithProvincialStyleRef = classifyRoad('S101 机场高速')
  assert.equal(expresswayWithProvincialStyleRef.roadClass, 'EXPRESSWAY')
  assert.equal(expresswayWithProvincialStyleRef.confidence, 'MEDIUM')

  const nationalWithExpresswayStyleRef = classifyRoad('G65 国道')
  assert.equal(nationalWithExpresswayStyleRef.roadClass, 'NATIONAL_ROAD')
  assert.equal(nationalWithExpresswayStyleRef.confidence, 'MEDIUM')

  assert.equal(classifyRoad('高速铁路').roadClass, 'OTHER')
})

test('road refs provide a medium-confidence fallback when names have no class keyword', () => {
  assert.deepEqual(classifyRoad('G65'), {
    normalizedRoadName: 'G65',
    roadClass: 'EXPRESSWAY',
    routeRef: 'G65',
    confidence: 'MEDIUM',
    source: 'ROAD_CODE',
  })
  assert.equal(classifyRoad('G210').roadClass, 'NATIONAL_ROAD')
  assert.equal(classifyRoad('S101').roadClass, 'PROVINCIAL_ROAD')
})

test('AMap infrastructure names use expressway evidence without reclassifying an approach road', () => {
  assert.deepEqual(classifyRoadPartEvidence({
    roadName: '秦岭终南山公路隧道',
    tollRoad: '秦岭终南山公路隧道',
    instruction: '沿秦岭终南山公路隧道途径G65包茂高速、乾佑河特大桥向南行驶',
  }), {
    normalizedRoadName: '秦岭终南山公路隧道',
    roadClass: 'EXPRESSWAY',
    routeRef: 'G65',
    confidence: 'HIGH',
    source: 'MIXED',
  })

  assert.equal(classifyRoadPartEvidence({
    roadName: '曲江路',
    instruction: '沿曲江路途径G65包茂高速入口向南行驶到达收费站',
  }).roadClass, 'URBAN_ROAD')
})

test('AMap route traversal evidence recognizes a higher-class numbered road behind its local alias', () => {
  assert.deepEqual(classifyRoadPartEvidence({
    roadName: '310县道',
    instruction: '沿310县道途径345国道向西行驶7.0千米左转',
  }), {
    normalizedRoadName: '310县道',
    roadClass: 'NATIONAL_ROAD',
    routeRef: 'G345',
    confidence: 'HIGH',
    source: 'MIXED',
  })

  assert.equal(classifyRoadPartEvidence({
    roadName: '曲江路',
    instruction: '沿曲江路途径G65包茂高速入口向南行驶到达收费站',
  }).roadClass, 'URBAN_ROAD')
})

test('continuous G345 corridor propagates only between matching anchors and never past the last anchor', () => {
  const common = { distanceMeters: 100, confidence: 'LOW', source: 'FALLBACK' }
  const corridor = reclassifyRoadParts([
    { ...common, roadClass: 'COUNTY_ROAD', roadName: '310县道', instruction: '沿310县道途径345国道向西行驶' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '镇东路', instruction: '沿镇东路向西行驶' },
    { ...common, roadClass: 'NATIONAL_ROAD', roadName: '345国道', instruction: '沿345国道向西行驶' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '黄杨路', instruction: '沿黄杨路向西行驶' },
    { ...common, roadClass: 'NATIONAL_ROAD', roadName: '345国道', instruction: '沿345国道向南行驶' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '长新路', instruction: '沿长新路向西南行驶到达目的地' },
  ])
  assert.deepEqual(corridor.map((part) => [part.roadClass, part.routeRef]), [
    ['NATIONAL_ROAD', 'G345'],
    ['NATIONAL_ROAD', 'G345'],
    ['NATIONAL_ROAD', 'G345'],
    ['NATIONAL_ROAD', 'G345'],
    ['NATIONAL_ROAD', 'G345'],
    ['URBAN_ROAD', undefined],
  ])

  const exited = reclassifyRoadParts([
    { ...common, roadClass: 'EXPRESSWAY', roadName: 'G65包茂高速', instruction: '沿G65包茂高速向南行驶' },
    { ...common, roadClass: 'EXPRESSWAY', roadName: 'G65包茂高速', instruction: '沿G65包茂高速驶出高速' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '曲江路', instruction: '沿曲江路向北行驶到达目的地' },
  ])
  assert.equal(exited[2].roadClass, 'URBAN_ROAD')
  assert.equal(exited[2].routeRef, undefined)
})

test('G211 must not propagate into S314 aliases or the later Huling local road', () => {
  const common = { distanceMeters: 100, confidence: 'LOW', source: 'FALLBACK' }
  const result = reclassifyRoadParts([
    { ...common, roadClass: 'NATIONAL_ROAD', roadName: '211国道', instruction: '沿211国道向南行驶' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '东米路', instruction: '沿东米路向东行驶' },
    { ...common, roadClass: 'NATIONAL_ROAD', roadName: '211国道', instruction: '沿211国道向南行驶向左前方行驶' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '户冷路', instruction: '沿户冷路向东行驶' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '户冷路', instruction: '沿户冷路向东行驶到达目的地' },
  ])

  assert.deepEqual(result.map((part) => [part.roadClass, part.routeRef]), [
    ['NATIONAL_ROAD', 'G211'],
    ['NATIONAL_ROAD', 'G211'],
    ['NATIONAL_ROAD', 'G211'],
    ['URBAN_ROAD', undefined],
    ['URBAN_ROAD', undefined],
  ])
})

test('ambiguous infrastructure inherits one continuous G65 context', () => {
  const common = { distanceMeters: 100, confidence: 'LOW', source: 'FALLBACK' }
  const result = reclassifyRoadParts([
    { ...common, roadClass: 'EXPRESSWAY', routeRef: 'G65', roadName: 'G65包茂高速', source: 'ROAD_NAME' },
    { ...common, roadClass: 'URBAN_ROAD', roadName: '青岔隧道' },
    { ...common, roadClass: 'EXPRESSWAY', routeRef: 'G65', roadName: 'G65包茂高速', source: 'ROAD_NAME' },
    { ...common, roadClass: 'OTHER', roadName: '营盘立交' },
  ])

  assert.deepEqual(result.map((part) => [part.roadClass, part.routeRef]), [
    ['EXPRESSWAY', 'G65'],
    ['EXPRESSWAY', 'G65'],
    ['EXPRESSWAY', 'G65'],
    ['EXPRESSWAY', 'G65'],
  ])
  assert.equal(result[1].source, 'MIXED')
  assert.equal(result[3].confidence, 'MEDIUM')
})

test('adjacent parts merge only when road class and normalized route ref both match', () => {
  const source = [
    {
      roadClass: 'EXPRESSWAY',
      routeRef: 'ｇ６５',
      roadName: '包茂高速',
      distanceMeters: 1200,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
    },
    {
      roadClass: 'EXPRESSWAY',
      routeRef: 'G 65',
      roadName: 'G65 包茂高速',
      distanceMeters: 800,
      confidence: 'MEDIUM',
      source: 'ROAD_CODE',
    },
    {
      roadClass: 'EXPRESSWAY',
      routeRef: 'G75',
      roadName: '兰海高速',
      distanceMeters: 500,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
    },
    {
      roadClass: 'NATIONAL_ROAD',
      routeRef: 'G65',
      roadName: '测试国道',
      distanceMeters: 300,
      confidence: 'LOW',
      source: 'ROAD_NAME',
    },
  ]

  const merged = mergeAdjacentRoadParts(source)
  assert.equal(merged.length, 3)
  assert.deepEqual(merged[0], {
    roadClass: 'EXPRESSWAY',
    routeRef: 'G65',
    roadName: '包茂高速',
    distanceMeters: 2000,
    confidence: 'MEDIUM',
    source: 'MIXED',
  })
  assert.equal(merged[1].routeRef, 'G75')
  assert.equal(merged[2].roadClass, 'NATIONAL_ROAD')
  assert.equal(source[0].routeRef, 'ｇ６５')
  assert.equal(source[0].distanceMeters, 1200)
})

test('unnumbered and non-adjacent parts are not merged by class alone', () => {
  const merged = mergeAdjacentRoadParts([
    {
      roadClass: 'EXPRESSWAY',
      roadName: '包茂高速',
      distanceMeters: 100,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
    },
    {
      roadClass: 'EXPRESSWAY',
      roadName: '机场高速',
      distanceMeters: 200,
      confidence: 'HIGH',
      source: 'ROAD_NAME',
    },
    {
      roadClass: 'EXPRESSWAY',
      routeRef: 'G65',
      distanceMeters: 300,
      confidence: 'MEDIUM',
      source: 'ROAD_CODE',
    },
    {
      roadClass: 'EXPRESSWAY',
      routeRef: 'G75',
      distanceMeters: 400,
      confidence: 'MEDIUM',
      source: 'ROAD_CODE',
    },
    {
      roadClass: 'EXPRESSWAY',
      routeRef: 'G65',
      distanceMeters: 500,
      confidence: 'MEDIUM',
      source: 'ROAD_CODE',
    },
  ])

  assert.equal(merged.length, 5)
})

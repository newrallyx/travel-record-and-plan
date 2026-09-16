import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseDrivingPath } from '../src/services/amap/routeApi.ts'
import { buildDrivingRouteResult } from '../src/services/amap/routePlanner.ts'
import {
  ROAD_CLASSIFIER_VERSION,
  ROAD_DISTANCE_TOLERANCE_MIN_METERS,
} from '../src/config/roadStatistics.ts'
import { buildRouteRoadAnalysis } from '../src/utils/roadAnalysis.ts'

const FIXTURE_URL = new URL('./fixtures/amap-driving-path.json', import.meta.url)
const ANALYZED_AT = '2026-09-01T08:00:00.000Z'

function loadDrivingPathFixture() {
  return JSON.parse(readFileSync(FIXTURE_URL, 'utf8'))
}

function createPart(distanceMeters) {
  return {
    roadClass: 'UNKNOWN',
    distanceMeters,
    confidence: 'LOW',
    source: 'FALLBACK',
    polyline: [[34.2, 108.9], [34.21, 108.91]],
  }
}

test('driving route result merges adjacent numbered parts and records complete analysis metadata', () => {
  const parsed = parseDrivingPath(loadDrivingPathFixture())
  const route = buildDrivingRouteResult(parsed, 'fixture-route-key', ANALYZED_AT)

  assert.equal(route.roadParts?.length, 3)
  assert.deepEqual(route.roadParts?.map((part) => part.distanceMeters), [8200, 480, 9002])
  assert.deepEqual(route.roadParts?.[0].polyline, [
    [34.2, 108.9],
    [34.21, 108.91],
    [34.22, 108.92],
    [34.23, 108.93],
    [34.24, 108.94],
  ])

  assert.deepEqual(route.roadAnalysis, {
    schemaVersion: 1,
    classifierVersion: ROAD_CLASSIFIER_VERSION,
    analyzedAt: ANALYZED_AT,
    routeBuildKey: 'fixture-route-key',
    coverageMeters: 17682,
    routeDistanceMeters: 17682,
    coverageRatio: 1,
    distanceErrorMeters: 0,
    distanceToleranceMeters: 176.82,
    status: 'complete',
  })
})

test('unnamed road part contributes coverage and retains its own polyline', () => {
  const parsed = parseDrivingPath(loadDrivingPathFixture())
  const route = buildDrivingRouteResult(parsed, 'fixture-route-key', ANALYZED_AT)
  const unnamed = route.roadParts?.[1]

  assert.equal(unnamed?.roadClass, 'UNKNOWN')
  assert.equal(unnamed?.roadName, undefined)
  assert.equal(unnamed?.distanceMeters, 480)
  assert.deepEqual(unnamed?.polyline, [
    [34.24, 108.94],
    [34.245, 108.945],
  ])
  assert.equal(route.roadAnalysis?.coverageMeters, 17682)
})

test('distance tolerance accepts its boundary and marks larger mismatches partial', () => {
  const complete = buildRouteRoadAnalysis([createPart(9900)], 10000, ANALYZED_AT)
  assert.equal(complete.meta.distanceToleranceMeters, ROAD_DISTANCE_TOLERANCE_MIN_METERS)
  assert.equal(complete.meta.distanceErrorMeters, 100)
  assert.equal(complete.meta.coverageRatio, 0.99)
  assert.equal(complete.meta.status, 'complete')

  const partial = buildRouteRoadAnalysis([createPart(9899)], 10000, ANALYZED_AT)
  assert.equal(partial.meta.distanceErrorMeters, 101)
  assert.equal(partial.meta.status, 'partial')
})

test('missing route distance remains partial without discarding analyzed parts', () => {
  const result = buildRouteRoadAnalysis([createPart(500)], undefined, ANALYZED_AT)

  assert.equal(result.roadParts.length, 1)
  assert.equal(result.meta.coverageMeters, 500)
  assert.equal(result.meta.routeDistanceMeters, undefined)
  assert.equal(result.meta.coverageRatio, undefined)
  assert.equal(result.meta.status, 'partial')
})

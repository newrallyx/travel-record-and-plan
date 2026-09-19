import assert from 'node:assert/strict'
import test from 'node:test'

import { moveSegmentById, reorderSegmentsById } from '../src/utils/segmentOrder.ts'

function createSegment(id, order) {
  return {
    id,
    order,
    name: id,
    startPoint: `${id}-start`,
    endPoint: `${id}-end`,
    preference: 'HIGHWAY_FIRST',
  }
}

test('reorders every segment in a day and normalizes persisted order values', () => {
  const segments = [createSegment('first', 7), createSegment('second', 3), createSegment('third', 9)]
  const reordered = reorderSegmentsById(segments, ['third', 'first', 'second'])

  assert.deepEqual(reordered.map((segment) => segment.id), ['third', 'first', 'second'])
  assert.deepEqual(reordered.map((segment) => segment.order), [0, 1, 2])
  assert.deepEqual(segments.map((segment) => segment.id), ['first', 'second', 'third'])
})

test('rejects incomplete or duplicated reorder payloads without losing segments', () => {
  const segments = [createSegment('first', 0), createSegment('second', 1)]

  assert.equal(reorderSegmentsById(segments, ['second']), segments)
  assert.equal(reorderSegmentsById(segments, ['second', 'second']), segments)
  assert.equal(reorderSegmentsById(segments, ['second', 'missing']), segments)
})

test('moves one segment only within the provided day list', () => {
  const segments = [createSegment('first', 0), createSegment('second', 1), createSegment('third', 2)]

  assert.deepEqual(moveSegmentById(segments, 'second', 'up').map((segment) => segment.id), [
    'second',
    'first',
    'third',
  ])
  assert.equal(moveSegmentById(segments, 'first', 'up'), segments)
  assert.equal(moveSegmentById(segments, 'missing', 'down'), segments)
})

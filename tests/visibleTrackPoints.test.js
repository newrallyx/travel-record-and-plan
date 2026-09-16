import assert from 'node:assert/strict'
import test from 'node:test'
import { getVisibleTrackPoints } from '../src/components/map/visibleTrackPoints.ts'

function track(id, offset) {
  return {
    segmentId: id,
    segmentName: id,
    line: [],
    points: ['start', 'via', 'end'].map((type, index) => ({
      type, name: `${id}-${type}`, lat: 30 + offset + index, lon: 100 + offset + index,
    })),
  }
}

const tracks = [track('day1-a', 0), track('day1-b', 2), track('day2-a', 4), track('day2-b', 6)]
const segments = tracks.map(({ segmentId }) => ({ id: segmentId }))
const endpoints = (items) => items.filter(({ point }) => point.type !== 'via')
  .map(({ track, point }) => `${track.segmentId}:${point.type}`)

test('whole trip shows only the first start and last end, preserving via points', () => {
  const visible = getVisibleTrackPoints(segments, [...tracks].reverse())
  assert.deepEqual(endpoints(visible).sort(), ['day1-a:start', 'day2-b:end'])
  assert.equal(visible.filter(({ point }) => point.type === 'via').length, 4)
})

test('daily selection uses that day boundaries and excludes tracks left over from another filter', () => {
  assert.deepEqual(endpoints(getVisibleTrackPoints(segments.slice(2), tracks)), ['day2-a:start', 'day2-b:end'])
})

test('one segment keeps both endpoints and the current editable point objects', () => {
  const draft = track('day1-b', 20)
  const visible = getVisibleTrackPoints([segments[1]], [draft])
  assert.deepEqual(endpoints(visible), ['day1-b:start', 'day1-b:end'])
  assert.equal(visible[0].point, draft.points[0])
  assert.equal(visible[2].point, draft.points[2])
})

test('missing boundary tracks never relabel intermediate segments as trip endpoints', () => {
  assert.deepEqual(endpoints(getVisibleTrackPoints(segments, tracks.slice(1, -1))), [])
  assert.deepEqual(getVisibleTrackPoints([], tracks), [])
  assert.deepEqual(getVisibleTrackPoints(segments, []), [])
})

test('a round trip keeps both start and end even at the same coordinate', () => {
  const loop = track('loop', 0)
  loop.points[2] = { ...loop.points[2], lat: loop.points[0].lat, lon: loop.points[0].lon }
  assert.deepEqual(endpoints(getVisibleTrackPoints([{ id: 'loop' }], [loop])), ['loop:start', 'loop:end'])
})

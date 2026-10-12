import assert from 'node:assert/strict'
import test from 'node:test'
import { DIFFICULTY_SCORE_COLOR_RAMPS, getScoreGradient, getSegmentDisplayColor, scoreToColor, UNRATED_SEGMENT_COLOR } from '../src/utils/segmentScores.ts'

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

test('difficulty uses four distinct hues with exact inclusive/exclusive score boundaries', () => {
  const expected = [
    [1, '#10a38c'], [4.9, '#005a50'],
    [5, '#b56fe4'], [6.9, '#5a247d'],
    [7, '#f05ca6'], [8.9, '#cd1981'],
    [9, '#701827'], [10, '#2b070f'],
  ]
  for (const [score, color] of expected) assert.equal(scoreToColor(score, 'difficulty'), color, `score ${score}`)
  assert.equal(new Set([1, 5, 7, 9].map(score => scoreToColor(score, 'difficulty'))).size, 4)
  assert.notEqual(scoreToColor(5.1, 'difficulty'), scoreToColor(6.8, 'difficulty'))
})

test('scores darken gradually within each band without losing their band hue', () => {
  const rgb = score => scoreToColor(score, 'difficulty').slice(1).match(/../g).map(value => parseInt(value, 16))
  for (const [min, max] of [[1, 4.9], [5, 6.9], [7, 8.9], [9, 10]]) {
    let previous = [Infinity, Infinity, Infinity]
    const reference = rgb(min)
    const colors = new Set()
    for (let tenth = min * 10; tenth <= max * 10; tenth++) {
      const current = rgb(tenth / 10)
      assert.ok(current.every((channel, i) => channel <= previous[i]))
      colors.add(scoreToColor(tenth / 10, 'difficulty'))
      for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
        assert.equal(Math.sign(current[a] - current[b]), Math.sign(reference[a] - reference[b]))
      }
      previous = current
    }
    // 每档保持丰富的中间色，不退回同档同色。
    assert.ok(colors.size >= 10)
    assert.notDeepEqual(previous, reference)
  }
})

test('within-band gradients have a visible brightness range while their light end remains readable', () => {
  for (const [key, { start, end }] of Object.entries(DIFFICULTY_SCORE_COLOR_RAMPS)) {
    const light = luminance(start), dark = luminance(end)
    // 红色两档优先留出档间明暗差，不能为了扩大档内范围让色带重叠。
    const minimumRange = key === 'HIGH' || key === 'TOP' ? 1.5 : 2.4
    assert.ok((light + 0.05) / (dark + 0.05) >= minimumRange, `${key}: gradient too subtle`)
    assert.ok(1.05 / (light + 0.05) >= 3, `${key}: light end too pale for the map`)
  }
})

test('all high scores remain visibly brighter and more magenta than the top band, including 8.9 / 9', () => {
  const highColors = Array.from({ length: 20 }, (_, i) => scoreToColor(7 + i / 10, 'difficulty'))
  const topColors = Array.from({ length: 11 }, (_, i) => scoreToColor(9 + i / 10, 'difficulty'))
  const darkestHigh = Math.min(...highColors.map(luminance))
  const lightestTop = Math.max(...topColors.map(luminance))
  assert.ok((darkestHigh + 0.05) / (lightestTop + 0.05) >= 2, 'high/top brightness ranges overlap')
  const blueRedRatio = color => parseInt(color.slice(5, 7), 16) / parseInt(color.slice(1, 3), 16)
  assert.ok(highColors.every(color => blueRedRatio(color) >= 0.6), 'high band drifts into dark red')
  assert.ok(topColors.every(color => blueRedRatio(color) <= 0.4), 'top band drifts into rose pink')
})

test('difficulty legend changes color abruptly at the same numeric thresholds as the routes', () => {
  const gradient = getScoreGradient('difficulty')
  assert.ok(gradient.includes(`${scoreToColor(1, 'difficulty')} 0%`))
  for (const [key, boundary] of [['LOW', 5], ['MEDIUM', 7], ['HIGH', 9]]) {
    const position = `${(boundary - 1) / 9 * 100}%`
    assert.ok(gradient.includes(`${DIFFICULTY_SCORE_COLOR_RAMPS[key].end} ${position}, ${scoreToColor(boundary, 'difficulty')} ${position}`))
  }
  assert.ok(gradient.includes(`${scoreToColor(10, 'difficulty')} 100%`))
})

test('coloring preserves unrated states, source scores, and other modes', () => {
  for (const difficultyScore of [null, undefined, NaN]) {
    assert.equal(getSegmentDisplayColor({ difficultyScore }, 'difficulty', '#123456'), UNRATED_SEGMENT_COLOR)
  }
  const segment = { scenicScore: 7, difficultyScore: 6.4 }
  const original = { ...segment }
  assert.equal(getSegmentDisplayColor(segment, 'difficulty', '#123456'), scoreToColor(6.4, 'difficulty'))
  assert.equal(getSegmentDisplayColor(segment, 'scenic', '#123456'), '#00b8b0')
  assert.equal(getSegmentDisplayColor(segment, 'default', '#123456'), '#123456')
  assert.equal(getSegmentDisplayColor(segment, 'roadType', '#123456'), '#123456')
  assert.deepEqual(segment, original)
})

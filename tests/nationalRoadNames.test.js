import assert from 'node:assert/strict'
import test from 'node:test'
import { NATIONAL_EXPRESSWAY_NAMES, NATIONAL_HIGHWAY_NAMES } from '../src/config/nationalRoadNames.ts'
import { roadDisplayName } from '../src/components/map/roadDirectionNames.ts'
import { presentRoadNames } from '../src/utils/roadNamePresentation.ts'

test('all numbered national roads with published short names use their class-specific name', () => {
  assert.equal(Object.keys(NATIONAL_EXPRESSWAY_NAMES).length, 285)
  assert.equal(Object.keys(NATIONAL_HIGHWAY_NAMES).length, 301)
  for (const [ref, name] of Object.entries(NATIONAL_EXPRESSWAY_NAMES)) {
    assert.match(ref, /^G\d{1,4}$/)
    assert.match(name, /高速$/)
    assert.equal(roadDisplayName(ref, 'EXPRESSWAY', '原始路段名称'), name)
    assert.equal(presentRoadNames(['原始路段名称'], ref, 'EXPRESSWAY').summary, name)
  }
  for (const [ref, name] of Object.entries(NATIONAL_HIGHWAY_NAMES)) {
    assert.match(ref, /^G\d{3}$/)
    assert.match(name, /(?:线|连接线)$/)
    assert.equal(roadDisplayName(ref, 'NATIONAL_ROAD', '原始路段名称'), name)
    assert.equal(presentRoadNames(['原始路段名称'], ref, 'NATIONAL_ROAD').summary, name)
  }
  assert.equal(NATIONAL_HIGHWAY_NAMES.G226, undefined)
  assert.equal(NATIONAL_HIGHWAY_NAMES.G313, undefined)
  assert.equal(NATIONAL_EXPRESSWAY_NAMES.G3022, '渭南过境高速')
  assert.equal(NATIONAL_EXPRESSWAY_NAMES.G3023, '西兴高速')
  assert.equal(NATIONAL_EXPRESSWAY_NAMES.G3024, '宝鸡过境高速')
})

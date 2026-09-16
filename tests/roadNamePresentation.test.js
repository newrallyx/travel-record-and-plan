import assert from 'node:assert/strict'
import test from 'node:test'
import { presentRoadNames } from '../src/utils/roadNamePresentation.ts'

test('road name summaries collapse entrances and preserve conflicting source names', () => {
  const original = ['灞桥立交', 'G30连霍高速', 'G30连霍高速入口', 'G30连霍高速出口', 'G3024宝鸡过境高速']
  assert.deepEqual(presentRoadNames(original, 'G30'), {
    summary: '连霍高速', conflicts: ['G3024宝鸡过境高速'],
  })
  assert.equal(original.length, 5)
})

test('numeric road names and full width refs are checked without hiding normal bridge-named roads', () => {
  assert.deepEqual(presentRoadNames(['Ｇ２１０包南线', '210国道', 'S210大青山隧道', '201省道'], 'G210'), {
    summary: '包南线、210国道', conflicts: ['S210大青山隧道', '201省道'],
  })
  assert.equal(presentRoadNames(['桥北街', '秦岭隧道', '某枢纽', '某服务区'], null).summary, '桥北街')
  assert.equal(presentRoadNames(['某立交', '城市道路'], 'G30').summary, '')
})

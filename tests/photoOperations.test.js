import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhotoOperationQueue, PendingBackupImports } from '../electron/photoOperations.mjs'

test('photo operations serialize restore and background writes, and continue after a failure', async () => {
  const queue = createPhotoOperationQueue()
  const order = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const restore = queue.run(async () => { order.push('restore-start'); await gate; order.push('restore-end') })
  const write = queue.run(async () => { order.push('write'); throw new Error('disk failure') })
  const writeFailure = assert.rejects(write, /disk failure/)
  const next = queue.run(() => { order.push('next') })
  await Promise.resolve()
  assert.deepEqual(order, ['restore-start'])
  release()
  await Promise.all([restore, writeFailure, next, queue.idle()])
  assert.deepEqual(order, ['restore-start', 'restore-end', 'write', 'next'])
})

test('prepared imports enforce ownership, single use, size count, expiry and explicit cancellation', async () => {
  let now = 0
  let disposed = 0
  const pending = new PendingBackupImports({ now: () => now, ttlMs: 60000 })
  const prepared = { dispose: async () => { disposed++ } }
  const token = pending.add(prepared, 1)
  assert.throws(() => pending.add(prepared, 1), /等待恢复/)
  await assert.rejects(pending.take(token, 2), /不存在/)
  assert.equal(await pending.take(token, 1), prepared)
  await assert.rejects(pending.take(token, 1), /不存在/)
  assert.equal(disposed, 0)
  const expired = pending.add(prepared, 1)
  now = 60001
  await assert.rejects(pending.take(expired, 1), /过期/)
  assert.equal(disposed, 1)
  const cancelled = pending.add(prepared, 1)
  await pending.cancel(cancelled, 2)
  assert.equal(disposed, 1)
  await pending.cancel(cancelled, 1)
  await pending.cancel(cancelled, 1)
  assert.equal(disposed, 2)
  pending.add(prepared, 1)
  await pending.clear()
  assert.equal(disposed, 3)
})

test('expiry timer releases staging without another request', async () => {
  let disposed = 0
  const pending = new PendingBackupImports({ ttlMs: 10 })
  pending.add({ dispose: async () => { disposed++ } }, 1)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(disposed, 1)
  assert.equal(pending.entries.size, 0)
})

test('window invalidation rejects a preparation that finishes after the window was cleared', async () => {
  const pending = new PendingBackupImports()
  const generation = pending.generation
  await pending.clear()
  assert.throws(() => pending.add({}, 1, generation), /已取消/)
  assert.equal(pending.entries.size, 0)
})

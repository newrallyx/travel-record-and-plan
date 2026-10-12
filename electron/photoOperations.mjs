import { randomUUID } from 'node:crypto'

export function createPhotoOperationQueue() {
  let tail = Promise.resolve()
  return {
    run(operation) {
      const result = tail.then(operation)
      tail = result.then(() => undefined, () => undefined)
      return result
    },
    idle: () => tail,
  }
}

export class PendingBackupImports {
  constructor({ ttlMs = 15 * 60 * 1000, maxEntries = 1, now = Date.now } = {}) {
    this.entries = new Map()
    this.generation = 0
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.now = now
  }

  add(prepared, ownerId, generation = this.generation) {
    if (generation !== this.generation) throw new Error('备份准备已取消，请重新选择备份。')
    if (this.entries.size >= this.maxEntries) throw new Error('已有备份等待恢复，请先完成或取消。')
    const token = randomUUID()
    const timer = setTimeout(() => {
      void this.cancel(token, ownerId).catch((error) => {
        console.warn('[backup] Expired import cleanup failed.', { code: error?.code })
      })
    }, this.ttlMs)
    timer.unref?.()
    this.entries.set(token, { prepared, ownerId, expiresAt: this.now() + this.ttlMs, timer })
    return token
  }

  async take(token, ownerId) {
    const entry = this.entries.get(token)
    if (!entry || entry.ownerId !== ownerId) throw new Error('备份恢复请求不存在或已过期，请重新选择备份。')
    this.entries.delete(token)
    clearTimeout(entry.timer)
    if (entry.expiresAt <= this.now()) {
      await entry.prepared.dispose?.()
      throw new Error('备份恢复请求已过期，请重新选择备份。')
    }
    return entry.prepared
  }

  async cancel(token, ownerId) {
    const entry = this.entries.get(token)
    if (!entry || entry.ownerId !== ownerId) return
    this.entries.delete(token)
    clearTimeout(entry.timer)
    await entry.prepared.dispose?.()
  }

  async clear() {
    this.generation++
    const entries = [...this.entries.entries()]
    const results = await Promise.allSettled(entries.map(([token, entry]) => this.cancel(token, entry.ownerId)))
    for (const result of results) {
      if (result.status === 'rejected') console.warn('[backup] Import cleanup failed.', { code: result.reason?.code })
    }
  }
}

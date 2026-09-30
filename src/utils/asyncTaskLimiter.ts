export type AsyncTaskLimiter = <T>(task: () => Promise<T>) => Promise<T>

export function createAsyncTaskLimiter(maxConcurrency: number): AsyncTaskLimiter {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('Task concurrency must be a positive integer.')
  }
  let activeCount = 0
  const queue: Array<() => void> = []

  const drain = () => {
    while (activeCount < maxConcurrency && queue.length > 0) {
      const run = queue.shift()
      if (!run) return
      activeCount += 1
      run()
    }
  }

  return <T>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      task().then(resolve, reject).finally(() => {
        activeCount -= 1
        drain()
      })
    })
    drain()
  })
}

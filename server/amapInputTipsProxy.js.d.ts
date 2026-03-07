export function createInputTipsProxyHandler(options: {
  amapKey: string
  fetchImpl?: typeof fetch
  now?: () => number
  cacheTtlMs?: number
  maxCacheEntries?: number
  rateLimitPerMinute?: number
  requestTimeoutMs?: number
}): (req: any, res: any) => Promise<void>

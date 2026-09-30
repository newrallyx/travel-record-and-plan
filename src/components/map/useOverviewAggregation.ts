import { useEffect, useMemo, useState } from 'react'
import type { SegmentTrack } from './types'
import type { OverviewLine } from './overviewAggregation'
import { overviewCache, overviewCacheKey, persistentOverviewCache } from './overviewCache'

/** Compute full-resolution geometry off the UI thread. Scope changes cancel obsolete work. */
export function useOverviewAggregation(tracks: SegmentTrack[], enabled: boolean) {
  const key = useMemo(() => enabled ? overviewCacheKey(tracks) : '', [tracks, enabled])
  const cached = enabled ? overviewCache.get(key) : undefined
  const [result, setResult] = useState<{ key: string; lines?: OverviewLine[]; error?: boolean }>()
  useEffect(() => {
    if (!enabled || overviewCache.get(key)) return
    let active = true
    let worker: Worker | undefined
    async function load() {
      const saved = await persistentOverviewCache.get(key)
      if (!active) return
      if (saved) {
        overviewCache.set(key, saved)
        setResult({ key, lines: saved })
        return
      }
      try {
        worker = new Worker(new URL('./overviewAggregation.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<OverviewLine[]>) => {
          if (!active) return
          overviewCache.set(key, event.data)
          void persistentOverviewCache.set(key, event.data)
          setResult({ key, lines: event.data })
          worker?.terminate()
        }
        worker.onerror = () => {
          if (!active) return
          setResult({ key, error: true })
          worker?.terminate()
        }
        worker.postMessage(tracks)
      } catch {
        worker?.terminate()
        setResult({ key, error: true })
      }
    }
    void load()
    return () => { active = false; worker?.terminate() }
  }, [tracks, enabled, key])
  const current = enabled && result?.key === key ? result : undefined
  return { lines: cached ?? current?.lines, error: !cached && (current?.error ?? false), pending: enabled && !cached && !current }
}

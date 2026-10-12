import { useEffect, useState } from 'react'
import type { SegmentTrack } from './types'
import type { OverviewLine } from './overviewAggregation'
import type { OverviewWorkerRequest, OverviewWorkerResponse } from './overviewAggregation.worker'
import { overviewCache, persistentOverviewCache } from './overviewCache'

// useMapTracks replaces its immutable snapshot when route data changes. Weak keys
// let unchanged snapshots revisit cached scopes without scanning coordinates.
const scopeKeys = new WeakMap<SegmentTrack[], string>()

/** Compute full-resolution geometry off the UI thread. Scope changes cancel obsolete work. */
export function useOverviewAggregation(tracks: SegmentTrack[], enabled: boolean) {
  const key = enabled ? scopeKeys.get(tracks) : undefined
  const cached = key ? overviewCache.get(key) : undefined
  const [result, setResult] = useState<{ tracks: SegmentTrack[]; lines?: OverviewLine[]; error?: boolean }>()
  useEffect(() => {
    if (!enabled) return
    const knownKey = scopeKeys.get(tracks)
    if (knownKey && overviewCache.get(knownKey)) return
    let active = true
    let worker: Worker | undefined
    let contentKey: string | undefined
    const fail = () => {
      if (!active) return
      setResult({ tracks, error: true })
      worker?.terminate()
    }
    try {
      worker = new Worker(new URL('./overviewAggregation.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = async (event: MessageEvent<OverviewWorkerResponse>) => {
        if (!active) return
        try {
          if (event.data.type === 'key') {
            contentKey = event.data.key
            scopeKeys.set(tracks, contentKey)
            const saved = overviewCache.get(contentKey) ?? await persistentOverviewCache.get(contentKey)
            if (!active) return
            if (saved) {
              overviewCache.set(contentKey, saved)
              setResult({ tracks, lines: saved })
              worker?.terminate()
            } else {
              worker?.postMessage({ type: 'aggregate' } satisfies OverviewWorkerRequest)
            }
          } else if (event.data.type === 'result' && contentKey) {
            overviewCache.set(contentKey, event.data.lines)
            void persistentOverviewCache.set(contentKey, event.data.lines)
            setResult({ tracks, lines: event.data.lines })
            worker?.terminate()
          } else {
            fail()
          }
        } catch { fail() }
      }
      worker.onerror = fail
      worker.onmessageerror = fail
      worker.postMessage({ type: 'prepare', tracks } satisfies OverviewWorkerRequest)
    } catch { fail() }
    return () => { active = false; worker?.terminate() }
  }, [tracks, enabled])
  const current = enabled && result?.tracks === tracks ? result : undefined
  return { lines: cached ?? current?.lines, error: !cached && (current?.error ?? false), pending: enabled && !cached && !current }
}

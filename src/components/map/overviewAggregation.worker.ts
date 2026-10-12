import { aggregateOverviewTracks } from './overviewAggregation'
import type { SegmentTrack } from './types'
import type { OverviewLine } from './overviewAggregation'
import { overviewCacheKey } from './overviewCache'

export type OverviewWorkerRequest = { type: 'prepare'; tracks: SegmentTrack[] } | { type: 'aggregate' }
export type OverviewWorkerResponse = { type: 'key'; key: string } | { type: 'result'; lines: OverviewLine[] } | { type: 'error' }

let tracks: SegmentTrack[] = []
self.onmessage = async (event: MessageEvent<OverviewWorkerRequest>) => {
  try {
    if (event.data.type === 'prepare') {
      tracks = event.data.tracks
      self.postMessage({ type: 'key', key: await overviewCacheKey(tracks) } satisfies OverviewWorkerResponse)
    } else {
      self.postMessage({ type: 'result', lines: aggregateOverviewTracks(tracks, false) } satisfies OverviewWorkerResponse)
    }
  } catch {
    self.postMessage({ type: 'error' } satisfies OverviewWorkerResponse)
  }
}

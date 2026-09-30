import { aggregateOverviewTracks } from './overviewAggregation'
import type { SegmentTrack } from './types'

self.onmessage = (event: MessageEvent<SegmentTrack[]>) => {
  self.postMessage(aggregateOverviewTracks(event.data, false))
}

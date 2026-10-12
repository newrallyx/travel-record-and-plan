import { aggregateOverviewTracks, buildRoadFootprintLines } from './overviewAggregation'
import type { SegmentTrack } from './types'

self.onmessage = (event: MessageEvent<{ tracks: SegmentTrack[]; passageTracks: SegmentTrack[] }>) => {
  self.postMessage(buildRoadFootprintLines(
    aggregateOverviewTracks(event.data.passageTracks, false),
    aggregateOverviewTracks(event.data.tracks, false),
  ))
}

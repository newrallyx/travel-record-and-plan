import type { RouteSegment } from '../../types/trip'
import type { SegmentTrack } from './types'

/** 筛选结果已按旅程内日期、路段顺序排列；只标记当前范围的首尾。 */
export function getVisibleTrackPoints(segments: RouteSegment[], tracks: SegmentTrack[]) {
  const firstSegmentId = segments[0]?.id
  const lastSegmentId = segments[segments.length - 1]?.id
  const segmentIds = new Set(segments.map((segment) => segment.id))

  return tracks.filter((track) => segmentIds.has(track.segmentId)).flatMap((track) =>
    track.points.flatMap((point, index) => {
      const visible = point.type === 'via'
        || (point.type === 'start' && track.segmentId === firstSegmentId)
        || (point.type === 'end' && track.segmentId === lastSegmentId)
      return visible ? [{ track, point, index }] : []
    }),
  )
}

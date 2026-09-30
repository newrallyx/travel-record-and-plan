import type { RouteSegment } from '../types/trip'

export function reorderSegmentsById(segments: RouteSegment[], orderedSegmentIds: string[]): RouteSegment[] {
  if (segments.length !== orderedSegmentIds.length) return segments

  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  if (segmentById.size !== segments.length || new Set(orderedSegmentIds).size !== orderedSegmentIds.length) {
    return segments
  }

  const reordered = orderedSegmentIds.map((segmentId, order) => {
    const segment = segmentById.get(segmentId)
    return segment ? { ...segment, order } : null
  })

  if (reordered.some((segment) => segment === null)) return segments
  return reordered as RouteSegment[]
}

export function moveSegmentById(
  segments: RouteSegment[],
  segmentId: string,
  direction: 'up' | 'down',
): RouteSegment[] {
  const orderedSegmentIds = segments.map((segment) => segment.id)
  const currentIndex = orderedSegmentIds.indexOf(segmentId)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedSegmentIds.length) return segments

  const [movedId] = orderedSegmentIds.splice(currentIndex, 1)
  orderedSegmentIds.splice(targetIndex, 0, movedId)
  return reorderSegmentsById(segments, orderedSegmentIds)
}

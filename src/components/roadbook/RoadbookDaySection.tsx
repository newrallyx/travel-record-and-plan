import type { LinkedPhotoRecord } from '../../types/photo'
import type { TripDay } from '../../types/trip'
import { formatDistance, getDayDistanceMeters, getTrackDistanceMeters } from '../../utils/distance'
import { formatDurationSummary, formatSegmentEstimatedDuration, summarizeEstimatedDurations } from '../../utils/durations'
import { formatSegmentEstimatedToll } from '../../utils/tolls'
import {
  formatActualSummaryText,
  formatSegmentActualDistance,
  formatSegmentActualDuration,
  formatSegmentActualToll,
  summarizeActualResults,
} from '../../utils/reviewFacts'
import { getReviewTagLabel } from '../../utils/reviewTags'
import SegmentPhotoThumbnail from '../SegmentPhotoThumbnail'

interface RoadbookDaySectionProps {
  dayIndex: number
  day: TripDay
  photosBySegment: Map<string, LinkedPhotoRecord[]>
  onOpenPhoto: (photoId: string) => void
}

function RoadbookDaySection({ dayIndex, day, photosBySegment, onOpenPhoto }: RoadbookDaySectionProps) {
  const segments = day.routeSegments
  const dayDistanceText = formatDistance(getDayDistanceMeters(segments))
  const dayDurationText = formatDurationSummary(summarizeEstimatedDurations(segments))
  const dayActualText = formatActualSummaryText(summarizeActualResults(segments))

  return (
    <section className="roadbook-day" aria-label={`第 ${dayIndex + 1} 天`}>
      <header className="roadbook-day-header">
        <h3>第 {dayIndex + 1} 天</h3>
        <span className="roadbook-day-date">{day.date}</span>
        <span className="roadbook-day-stats">{dayDistanceText} · 预计 {dayDurationText}</span>
        {dayActualText && <span className="roadbook-day-actual">{dayActualText}</span>}
      </header>

      {segments.length === 0 ? (
        <p className="hint-text">这一天没有记录路段。</p>
      ) : (
        <ul className="roadbook-segment-list">
          {segments.map((segment) => {
            const note = segment.note?.trim()
            const segmentPhotos = photosBySegment.get(segment.id) ?? []
            const tags = segment.reviewFacts?.tags ?? []
            const actualParts = [
              formatSegmentActualDistance(segment),
              formatSegmentActualDuration(segment),
              formatSegmentActualToll(segment),
            ].filter((part): part is string => Boolean(part))
            return (
              <li key={segment.id} className="roadbook-segment">
                <div className="roadbook-segment-row">
                  <strong>{segment.name}</strong>
                  <span className="roadbook-segment-route">
                    {segment.startPoint} → {segment.endPoint}
                  </span>
                  <span className="roadbook-segment-meta">
                    {formatDistance(getTrackDistanceMeters(segment))}
                    {' ｜ '}预计 {formatSegmentEstimatedDuration(segment)}
                    {' ｜ '}过路费 {formatSegmentEstimatedToll(segment)}
                  </span>
                </div>
                {actualParts.length > 0 && (
                  <p className="roadbook-segment-actual">
                    {actualParts.map((part) => `实际 ${part}`).join(' ｜ ')}
                  </p>
                )}
                {tags.length > 0 && (
                  <div className="segment-review-tag-options roadbook-tags-readonly">
                    {tags.map((tag) => (
                      <span key={tag} className="review-tag-chip selected">{getReviewTagLabel(tag)}</span>
                    ))}
                  </div>
                )}
                {note && <p className="roadbook-segment-note">{note}</p>}
                {segmentPhotos.length > 0 && (
                  <div className="roadbook-photo-grid">
                    {segmentPhotos.map((photo) => (
                      <SegmentPhotoThumbnail key={photo.id} photo={photo} onOpen={onOpenPhoto} />
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default RoadbookDaySection

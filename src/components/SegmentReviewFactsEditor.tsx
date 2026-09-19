import type { ReviewTag } from '../types/trip'
import { REVIEW_TAG_GROUPS, getReviewTagLabel } from '../utils/reviewTags'
import type { ReviewFactsDraftInput } from '../utils/reviewFacts'

interface SegmentReviewFactsEditorProps {
  draft: ReviewFactsDraftInput
  onDraftChange: (patch: Partial<ReviewFactsDraftInput>) => void
  disabled?: boolean
  hintText?: string
}

function SegmentReviewFactsEditor({ draft, onDraftChange, disabled = false, hintText }: SegmentReviewFactsEditorProps) {
  const toggleTag = (code: ReviewTag) => {
    const tags = draft.tags.includes(code)
      ? draft.tags.filter((item) => item !== code)
      : [...draft.tags, code]
    onDraftChange({ tags })
  }

  return (
    <div className="segment-review-facts-section">
      <div className="segment-review-facts-head">
        <span>实际记录</span>
        <small>全部可选，不强迫填写</small>
      </div>

      {REVIEW_TAG_GROUPS.map((group) => (
        <div key={group.key} className="segment-review-tag-group">
          <span className="segment-review-tag-group-label">{group.label}</span>
          <div className="segment-review-tag-options">
            {group.tags.map((option) => {
              const selected = draft.tags.includes(option.code)
              return (
                <button
                  key={option.code}
                  type="button"
                  className={`review-tag-chip${selected ? ' selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => toggleTag(option.code)}
                  disabled={disabled}
                >
                  {getReviewTagLabel(option.code)}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="segment-actual-form">
        <label className="segment-actual-field">
          <span>实际里程</span>
          <div className="segment-actual-input-row">
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="可选"
              value={draft.distanceText}
              onChange={(event) => onDraftChange({ distanceText: event.target.value })}
              disabled={disabled}
            />
            <small>公里</small>
          </div>
        </label>
        <label className="segment-actual-field">
          <span>实际行驶时间</span>
          <div className="segment-actual-input-row">
            <input
              type="number"
              min="0"
              max="100"
              placeholder="时"
              value={draft.durationHoursText}
              onChange={(event) => onDraftChange({ durationHoursText: event.target.value })}
              disabled={disabled}
            />
            <small>时</small>
            <input
              type="number"
              min="0"
              max="59"
              placeholder="分"
              value={draft.durationMinutesText}
              onChange={(event) => onDraftChange({ durationMinutesText: event.target.value })}
              disabled={disabled}
            />
            <small>分</small>
          </div>
        </label>
        <label className="segment-actual-field">
          <span>实际过路费</span>
          <div className="segment-actual-input-row">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="可选"
              value={draft.tollText}
              onChange={(event) => onDraftChange({ tollText: event.target.value })}
              disabled={disabled}
            />
            <small>元</small>
          </div>
        </label>
      </div>

      {hintText ? <p className="hint-text">{hintText}</p> : null}
    </div>
  )
}

export default SegmentReviewFactsEditor

import {
  formatScoreDisplay,
  getScoreGradient,
  normalizeScore,
  segmentScoreFieldConfigs,
  type SegmentScoreField,
} from '../utils/segmentScores'

interface SegmentScoreFieldsProps {
  values: Partial<Record<SegmentScoreField, number | null | undefined>>
  onChange: (field: SegmentScoreField, value: number | null) => void
  disabled?: boolean
  title?: string
  hintText?: string
}

function SegmentScoreFields({ values, onChange, disabled = false, title, hintText }: SegmentScoreFieldsProps) {
  const handleScoreInput = (field: SegmentScoreField, rawValue: string) => {
    const normalized = normalizeScore(rawValue)
    onChange(field, rawValue === '' ? null : normalized)
  }

  return (
    <div className="segment-score-section">
      {title ? <p>{title}</p> : null}
      {segmentScoreFieldConfigs.map((config) => {
        const value = normalizeScore(values[config.field])
        return (
          <div key={config.field} className="segment-score-row">
            <div className="segment-score-header">
              <span>{config.label}</span>
              <strong>{formatScoreDisplay(value)}</strong>
            </div>
            <div className="segment-score-inputs">
              <input
                type="range"
                min="1"
                max="10"
                step="0.1"
                value={value ?? 1}
                onChange={(event) => handleScoreInput(config.field, event.target.value)}
                disabled={disabled}
                style={{ backgroundImage: getScoreGradient(config.mode) }}
              />
              <input
                type="number"
                min="1"
                max="10"
                step="0.1"
                value={value ?? ''}
                placeholder="未评分"
                onChange={(event) => handleScoreInput(config.field, event.target.value)}
                onBlur={(event) => handleScoreInput(config.field, event.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="segment-score-gradient" style={{ backgroundImage: getScoreGradient(config.mode) }} />
          </div>
        )
      })}
      {hintText ? <p className="hint-text">{hintText}</p> : null}
    </div>
  )
}

export default SegmentScoreFields

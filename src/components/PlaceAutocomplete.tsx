import { useEffect, useMemo, useRef, useState } from 'react'
import { searchAmapInputTips, type AMapPlaceSuggestion } from '../services/amap'

interface PlaceSelectResult {
  label: string
  lat: number
  lng: number
  amapId?: string
  raw: AMapPlaceSuggestion
}

interface PlaceAutocompleteProps {
  valueText: string
  onValueTextChange: (text: string) => void
  onSelect: (result: PlaceSelectResult) => void
  placeholder: string
  disabled?: boolean
}

function isAdministrative(item: AMapPlaceSuggestion): boolean {
  return Boolean(item.isAdministrative)
}

function PlaceAutocomplete({
  valueText,
  onValueTextChange,
  onSelect,
  placeholder,
  disabled,
}: PlaceAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<AMapPlaceSuggestion[]>([])
  const [error, setError] = useState('')
  const [anchorCity, setAnchorCity] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const lastKeywordRef = useRef('')

  const groupedCandidates = useMemo(() => {
    const inScope = candidates.filter((item) => !item.isOutOfScope)
    const outOfScope = candidates.filter((item) => item.isOutOfScope)
    return { inScope, outOfScope }
  }, [candidates])

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setCandidates([])
      return
    }

    const q = valueText.trim()
    if (q.length < 2) {
      setCandidates([])
      setOpen(false)
      setError('')
      return
    }

    const controller = new AbortController()
    const currentId = ++requestIdRef.current
    lastKeywordRef.current = q

    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      const { tips, error: apiError } = await searchAmapInputTips(
        {
          keywords: q,
          city: anchorCity ?? undefined,
          citylimit: Boolean(anchorCity),
        },
        controller.signal,
      )
      if (currentId !== requestIdRef.current || q !== lastKeywordRef.current) return
      setCandidates(tips)
      setOpen(true)
      if (apiError) {
        setError('联想服务暂不可用，点击重试。')
      }
      setLoading(false)
    }, 400)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [disabled, valueText, anchorCity])

  const retrySearch = async () => {
    const q = valueText.trim()
    if (q.length < 2) return

    const controller = new AbortController()
    setLoading(true)
    setError('')
    const { tips, error: apiError } = await searchAmapInputTips(
      {
        keywords: q,
        city: anchorCity ?? undefined,
        citylimit: Boolean(anchorCity),
      },
      controller.signal,
    )
    setCandidates(tips)
    setOpen(true)
    if (apiError) setError('联想服务暂不可用，点击重试。')
    setLoading(false)
  }

  const handleSelect = (candidate: AMapPlaceSuggestion) => {
    if (isAdministrative(candidate)) {
      setAnchorCity(candidate.adcode ?? candidate.name)
    }

    onValueTextChange(candidate.name)
    onSelect({
      label: candidate.name,
      lat: candidate.lat,
      lng: candidate.lng,
      amapId: candidate.id,
      raw: candidate,
    })
    setOpen(false)
    setCandidates([])
  }

  return (
    <div className="autocomplete-field">
      <div className="autocomplete-input-row">
        <input
          value={valueText}
          onFocus={() => {
            if (candidates.length || error) setOpen(true)
          }}
          onChange={(event) => {
            onValueTextChange(event.target.value)
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120)
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        {anchorCity && (
          <button
            type="button"
            className="tiny-btn"
            onMouseDown={() => {
              setAnchorCity(null)
              setCandidates([])
            }}
          >
            清除范围
          </button>
        )}
      </div>

      {open && (
        <div className="autocomplete-dropdown">
          {loading && <div className="autocomplete-item muted">搜索中...</div>}
          {!loading && error && (
            <div className="autocomplete-item muted">
              {error}
              <button type="button" className="tiny-btn" onMouseDown={retrySearch}>
                重试
              </button>
            </div>
          )}
          {!loading && !error && !candidates.length && <div className="autocomplete-item muted">未找到匹配地点</div>}

          {!loading && !error && groupedCandidates.inScope.length > 0 && (
            <div className="autocomplete-group-title">范围内结果</div>
          )}
          {!loading &&
            !error &&
            groupedCandidates.inScope.map((candidate) => (
              <button
                type="button"
                className="autocomplete-item"
                key={`${candidate.id ?? candidate.name}-${candidate.lat}-${candidate.lng}`}
                onMouseDown={() => handleSelect(candidate)}
              >
                <span>
                  {candidate.name}
                  {candidate.isAdministrative ? '（行政区）' : ''}
                </span>
                <small>{candidate.displayName}</small>
              </button>
            ))}

          {!loading && !error && groupedCandidates.outOfScope.length > 0 && (
            <div className="autocomplete-group-title">范围外结果</div>
          )}
          {!loading &&
            !error &&
            groupedCandidates.outOfScope.map((candidate) => (
              <button
                type="button"
                className="autocomplete-item"
                key={`fallback-${candidate.id ?? candidate.name}-${candidate.lat}-${candidate.lng}`}
                onMouseDown={() => handleSelect(candidate)}
              >
                <span>{candidate.name}</span>
                <small>{candidate.displayName}</small>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

export default PlaceAutocomplete

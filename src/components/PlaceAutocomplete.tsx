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
  minChars?: number
  debounceMs?: number
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
  minChars = 2,
  debounceMs = 300,
}: PlaceAutocompleteProps) {
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<AMapPlaceSuggestion[]>([])
  const [error, setError] = useState('')
  const [anchorCity, setAnchorCity] = useState<string | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const [hasUserEdited, setHasUserEdited] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)

  const initialValueRef = useRef(valueText)
  const requestIdRef = useRef(0)
  const activeControllerRef = useRef<AbortController | null>(null)

  const groupedCandidates = useMemo(() => {
    const inScope = candidates.filter((item) => !item.isOutOfScope)
    const outOfScope = candidates.filter((item) => item.isOutOfScope)
    return { inScope, outOfScope }
  }, [candidates])

  useEffect(() => {
    if (!isFocused) {
      initialValueRef.current = valueText
      setHasUserEdited(false)
      setIsComposing(false)
      setShowSuggestions(false)
      setCandidates([])
      setError('')
      setLoading(false)
      activeControllerRef.current?.abort()
    }
  }, [isFocused, valueText])

  useEffect(() => {
    if (disabled) {
      setIsFocused(false)
      setIsComposing(false)
      setHasUserEdited(false)
      setShowSuggestions(false)
      setCandidates([])
      setError('')
      setLoading(false)
      activeControllerRef.current?.abort()
      return
    }

    const q = valueText.trim()
    const initial = initialValueRef.current.trim()
    const shouldSearch = isFocused && hasUserEdited && !isComposing && q.length >= minChars && q !== initial

    if (!shouldSearch) {
      activeControllerRef.current?.abort()
      setLoading(false)
      setCandidates([])
      setShowSuggestions(false)
      setError('')
      return
    }

    if (activeControllerRef.current) {
      activeControllerRef.current.abort()
    }
    const controller = new AbortController()
    activeControllerRef.current = controller
    const currentId = ++requestIdRef.current

    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      const { tips, error: apiError } = await searchAmapInputTips(
        {
          keywords: q,
          city: anchorCity ?? undefined,
          citylimit: Boolean(anchorCity),
          datatype: 'all',
        },
        controller.signal,
      )

      if (controller.signal.aborted || currentId !== requestIdRef.current) return

      setLoading(false)
      setCandidates(tips)
      setError(apiError ? '联想服务暂不可用，点击重试。' : '')
      setShowSuggestions(tips.length > 0)
    }, debounceMs)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [anchorCity, debounceMs, disabled, hasUserEdited, isComposing, isFocused, minChars, valueText])

  const retrySearch = async () => {
    const q = valueText.trim()
    const initial = initialValueRef.current.trim()
    const shouldSearch = isFocused && hasUserEdited && !isComposing && q.length >= minChars && q !== initial
    if (!shouldSearch) return

    activeControllerRef.current?.abort()
    const controller = new AbortController()
    activeControllerRef.current = controller

    setLoading(true)
    setError('')
    const { tips, error: apiError } = await searchAmapInputTips(
      {
        keywords: q,
        city: anchorCity ?? undefined,
        citylimit: Boolean(anchorCity),
        datatype: 'all',
      },
      controller.signal,
    )

    if (!controller.signal.aborted) {
      setCandidates(tips)
      setShowSuggestions(tips.length > 0)
      if (apiError) setError('联想服务暂不可用，点击重试。')
      setLoading(false)
    }
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

    initialValueRef.current = candidate.name
    setHasUserEdited(false)
    setIsComposing(false)
    setShowSuggestions(false)
    setCandidates([])
  }

  return (
    <div className="autocomplete-field">
      <div className="autocomplete-input-row">
        <input
          value={valueText}
          onFocus={() => {
            setIsFocused(true)
          }}
          onChange={(event) => {
            setHasUserEdited(true)
            onValueTextChange(event.target.value)
          }}
          onCompositionStart={() => {
            setIsComposing(true)
          }}
          onCompositionEnd={(event) => {
            setIsComposing(false)
            if (event.currentTarget.value !== valueText) {
              onValueTextChange(event.currentTarget.value)
            }
            setHasUserEdited(true)
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setIsFocused(false)
              setShowSuggestions(false)
            }, 120)
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
              setShowSuggestions(false)
            }}
          >
            清除范围
          </button>
        )}
      </div>

      {showSuggestions && (
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

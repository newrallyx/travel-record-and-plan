import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchAmapInputTips, type AMapPlaceSuggestion } from '../services/amap'

interface PlaceSelectResult {
  label: string
  lat: number
  lng: number
  amapId?: string
  raw: AMapPlaceSuggestion
}

interface PlaceAutocompleteProps {
  inputId?: string
  inputLabel?: string
  valueText: string
  onValueTextChange: (text: string) => void
  onSelect: (result: PlaceSelectResult) => void
  placeholder: string
  disabled?: boolean
  minChars?: number
  debounceMs?: number
}

interface DropdownPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  openAbove: boolean
}

function isAdministrative(item: AMapPlaceSuggestion): boolean {
  return Boolean(item.isAdministrative)
}

function PlaceAutocomplete({
  inputId,
  inputLabel,
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
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null)

  const initialValueRef = useRef(valueText)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const requestIdRef = useRef(0)
  const activeControllerRef = useRef<AbortController | null>(null)

  const groupedCandidates = useMemo(() => {
    const inScope = candidates.filter((item) => !item.isOutOfScope)
    const outOfScope = candidates.filter((item) => item.isOutOfScope)
    return { inScope, outOfScope }
  }, [candidates])

  const updateDropdownPosition = useCallback(() => {
    const field = fieldRef.current
    if (!field) return

    const rect = field.getBoundingClientRect()
    const viewportPadding = 8
    const dropdownGap = 4
    const availableBelow = window.innerHeight - rect.bottom - dropdownGap - viewportPadding
    const availableAbove = rect.top - dropdownGap - viewportPadding
    const openAbove = availableBelow < 160 && availableAbove > availableBelow
    const availableHeight = Math.max(48, openAbove ? availableAbove : availableBelow)
    const maxHeight = Math.min(240, availableHeight)
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - viewportPadding * 2)
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    )
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - dropdownGap)
      : Math.min(rect.bottom + dropdownGap, window.innerHeight - viewportPadding)

    setDropdownPosition({ top, left, width, maxHeight, openAbove })
  }, [])

  useLayoutEffect(() => {
    if (!showSuggestions) {
      setDropdownPosition(null)
      return
    }

    updateDropdownPosition()
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)

    return () => {
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
    }
  }, [showSuggestions, updateDropdownPosition])

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

  const suggestionDropdown = showSuggestions && dropdownPosition ? (
    <div
      className="autocomplete-dropdown autocomplete-dropdown-portal"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        right: 'auto',
        width: dropdownPosition.width,
        maxHeight: dropdownPosition.maxHeight,
        transform: dropdownPosition.openAbove ? 'translateY(-100%)' : undefined,
      }}
    >
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
  ) : null

  return (
    <div className="autocomplete-field" ref={fieldRef}>
      <div className="autocomplete-input-row">
        <input
          id={inputId}
          aria-label={inputLabel}
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

      {suggestionDropdown && createPortal(suggestionDropdown, document.body)}
    </div>
  )
}

export default PlaceAutocomplete

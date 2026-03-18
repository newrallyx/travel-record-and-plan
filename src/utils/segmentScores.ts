import type { RouteColorMode, RouteSegment } from '../types/trip'

export const SCORE_MIN = 1
export const SCORE_MAX = 10
export const UNRATED_SEGMENT_COLOR = '#94a3b8'
export type SegmentScoreField = 'scenicScore' | 'difficultyScore'

export const segmentScoreFieldConfigs: Array<{
  field: SegmentScoreField
  label: string
  mode: Exclude<RouteColorMode, 'default'>
}> = [
  { field: 'scenicScore', label: '风景评分', mode: 'scenic' },
  { field: 'difficultyScore', label: '难度评分', mode: 'difficulty' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseNumericScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeSegmentNote(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function clampScore(value: number): number {
  return clamp(value, SCORE_MIN, SCORE_MAX)
}

export function normalizeScore(value: unknown): number | null {
  const parsed = parseNumericScore(value)
  if (parsed === null) return null
  return Math.round(clampScore(parsed) * 10) / 10
}

function normalizeScoreRatio(score: number | null | undefined): number {
  const normalized = normalizeScore(score)
  if (normalized === null) return 0
  return (normalized - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)
}

function hslToHex(h: number, s: number, l: number): string {
  const saturation = clamp(s, 0, 100) / 100
  const lightness = clamp(l, 0, 100) / 100
  const hue = ((h % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))

  let red = 0
  let green = 0
  let blue = 0

  if (sector >= 0 && sector < 1) {
    red = chroma
    green = x
  } else if (sector < 2) {
    red = x
    green = chroma
  } else if (sector < 3) {
    green = chroma
    blue = x
  } else if (sector < 4) {
    green = x
    blue = chroma
  } else if (sector < 5) {
    red = x
    blue = chroma
  } else {
    red = chroma
    blue = x
  }

  const match = lightness - chroma / 2
  const toHex = (channel: number) => Math.round((channel + match) * 255).toString(16).padStart(2, '0')

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

export function scoreToColor(score: number | null | undefined, mode: Exclude<RouteColorMode, 'default'>): string {
  const ratio = normalizeScoreRatio(score)

  if (mode === 'scenic') {
    const hue = 215 - ratio * 55
    const saturation = 8 + ratio * 62
    const lightness = 88 - ratio * 36
    return hslToHex(hue, saturation, lightness)
  }

  const hue = 130 - ratio * 130
  const saturation = 50 + ratio * 38
  const lightness = 44 + (1 - ratio) * 10
  return hslToHex(hue, saturation, lightness)
}

export function getSegmentScore(segment: RouteSegment, mode: Exclude<RouteColorMode, 'default'>): number | null {
  return mode === 'scenic' ? normalizeScore(segment.scenicScore) : normalizeScore(segment.difficultyScore)
}

export function getSegmentDisplayColor(
  segment: RouteSegment,
  routeColorMode: RouteColorMode,
  fallbackColor: string,
): string {
  if (routeColorMode === 'default') return fallbackColor
  const score = getSegmentScore(segment, routeColorMode)
  if (score === null) return UNRATED_SEGMENT_COLOR
  return scoreToColor(score, routeColorMode)
}

export function getScoreGradient(mode: Exclude<RouteColorMode, 'default'>): string {
  const start = scoreToColor(SCORE_MIN, mode)
  const middle = scoreToColor((SCORE_MIN + SCORE_MAX) / 2, mode)
  const end = scoreToColor(SCORE_MAX, mode)
  return `linear-gradient(90deg, ${start} 0%, ${middle} 50%, ${end} 100%)`
}

export function formatScoreDisplay(value: number | null | undefined, emptyLabel = '未评分'): string {
  const normalized = normalizeScore(value)
  return normalized === null ? emptyLabel : normalized.toFixed(1)
}

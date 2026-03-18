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

export const scenicColorStops: Array<{ score: number; color: string }> = [
  { score: 1, color: '#3f4f67' },
  { score: 3, color: '#295fbf' },
  { score: 5, color: '#0088d1' },
  { score: 7, color: '#00b8b0' },
  { score: 9, color: '#26c95f' },
  { score: 10, color: '#00e676' },
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

function scoreToRatio(score: number): number {
  return (clampScore(score) - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '')
  const safeHex = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized

  return {
    r: Number.parseInt(safeHex.slice(0, 2), 16),
    g: Number.parseInt(safeHex.slice(2, 4), 16),
    b: Number.parseInt(safeHex.slice(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function interpolateHexColor(startHex: string, endHex: string, ratio: number): string {
  const start = hexToRgb(startHex)
  const end = hexToRgb(endHex)
  return rgbToHex(
    start.r + (end.r - start.r) * ratio,
    start.g + (end.g - start.g) * ratio,
    start.b + (end.b - start.b) * ratio,
  )
}

function colorFromAnchors(ratio: number, anchors: Array<{ at: number; color: string }>): string {
  if (ratio <= anchors[0].at) return anchors[0].color

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1]
    const current = anchors[index]
    if (ratio <= current.at) {
      const localRatio = (ratio - previous.at) / Math.max(current.at - previous.at, Number.EPSILON)
      return interpolateHexColor(previous.color, current.color, localRatio)
    }
  }

  return anchors[anchors.length - 1].color
}

export function scoreToColor(score: number | null | undefined, mode: Exclude<RouteColorMode, 'default'>): string {
  const ratio = normalizeScoreRatio(score)

  if (mode === 'scenic') {
    return colorFromAnchors(
      ratio,
      scenicColorStops.map((stop) => ({ at: scoreToRatio(stop.score), color: stop.color })),
    )
  }

  return colorFromAnchors(ratio, [
    { at: 0, color: '#1f9d55' },
    { at: 0.35, color: '#84cc16' },
    { at: 0.6, color: '#f59e0b' },
    { at: 0.78, color: '#f97316' },
    { at: 0.86, color: '#ef4444' },
    { at: 0.93, color: '#c81e1e' },
    { at: 1, color: '#7f1d1d' },
  ])
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

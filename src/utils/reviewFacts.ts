import type { ActualDriveResult, ReviewTag, RouteSegment, SegmentReviewFacts } from '../types/trip'

// 实际行驶结果汇总：只统计已填写字段，未填写绝不显示为 0。

export interface ReviewFactsDraftInput {
  tags: ReviewTag[]
  distanceText: string
  durationHoursText: string
  durationMinutesText: string
  tollText: string
}

const EMPTY_DRAFT: ReviewFactsDraftInput = {
  tags: [],
  distanceText: '',
  durationHoursText: '',
  durationMinutesText: '',
  tollText: '',
}

export function getReviewFactsDraftDefaults(facts: SegmentReviewFacts | undefined): ReviewFactsDraftInput {
  if (!facts) return { ...EMPTY_DRAFT }
  const actual = facts.actual ?? {}
  const durationSeconds = actual.durationSeconds ?? 0
  const totalMinutes = Math.round(durationSeconds / 60)
  return {
    tags: Array.from(new Set(facts.tags ?? [])),
    distanceText: typeof actual.distanceMeters === 'number'
      ? String((actual.distanceMeters / 1000).toFixed(1))
      : '',
    durationHoursText: totalMinutes > 0 ? String(Math.floor(totalMinutes / 60)) : '',
    durationMinutesText: totalMinutes > 0 ? String(totalMinutes % 60) : '',
    tollText: typeof actual.tollYuan === 'number' ? String(actual.tollYuan) : '',
  }
}

/** 把草稿组装成 reviewFacts；没有任何内容时返回 undefined。 */
export function buildReviewFactsFromDraft(draft: ReviewFactsDraftInput): SegmentReviewFacts | undefined {
  const facts: SegmentReviewFacts = {}

  const tags = Array.from(new Set(draft.tags))
  if (tags.length > 0) facts.tags = tags

  const actual: ActualDriveResult = {}
  const distanceKm = parseFloat(draft.distanceText)
  if (Number.isFinite(distanceKm) && distanceKm > 0 && distanceKm <= 10_000) {
    actual.distanceMeters = Math.round(distanceKm * 1000)
  }
  const hours = Number.parseInt(draft.durationHoursText, 10)
  const minutes = Number.parseInt(draft.durationMinutesText, 10)
  const validHours = Number.isFinite(hours) && hours >= 0 && hours <= 100
  const validMinutes = Number.isFinite(minutes) && minutes >= 0 && minutes < 60
  const totalMinutes = (validHours ? hours * 60 : 0) + (validMinutes ? minutes : 0)
  if (totalMinutes > 0) {
    actual.durationSeconds = Math.round(totalMinutes * 60)
  }
  const toll = parseFloat(draft.tollText)
  if (Number.isFinite(toll) && toll > 0 && toll <= 1_000_000) {
    actual.tollYuan = Math.round(toll * 100) / 100
  }
  if (Object.keys(actual).length > 0) facts.actual = actual

  return Object.keys(facts).length > 0 ? facts : undefined
}

export interface ActualSummary {
  distanceMeters: number | null
  durationSeconds: number | null
  tollYuan: number | null
  knownSegmentCount: number
  partial: boolean
}

export function getSegmentActual(segment: RouteSegment): ActualDriveResult | undefined {
  return segment.reviewFacts?.actual
}

export function hasAnyActualResults(segments: RouteSegment[]): boolean {
  return segments.some((segment) => {
    const actual = getSegmentActual(segment)
    return Boolean(actual && (actual.distanceMeters !== undefined
      || actual.durationSeconds !== undefined
      || actual.tollYuan !== undefined))
  })
}

export function summarizeActualResults(segments: RouteSegment[]): ActualSummary {
  let distanceMeters: number | null = null
  let durationSeconds: number | null = null
  let tollYuan: number | null = null
  let knownSegmentCount = 0

  for (const segment of segments) {
    const actual = getSegmentActual(segment)
    if (!actual) continue
    if (actual.distanceMeters === undefined && actual.durationSeconds === undefined && actual.tollYuan === undefined) {
      continue
    }
    knownSegmentCount += 1
    if (actual.distanceMeters !== undefined) {
      distanceMeters = (distanceMeters ?? 0) + actual.distanceMeters
    }
    if (actual.durationSeconds !== undefined) {
      durationSeconds = (durationSeconds ?? 0) + actual.durationSeconds
    }
    if (actual.tollYuan !== undefined) {
      tollYuan = Math.round(((tollYuan ?? 0) + actual.tollYuan) * 100) / 100
    }
  }

  const partial = knownSegmentCount > 0 && knownSegmentCount < segments.length
  return { distanceMeters, durationSeconds, tollYuan, knownSegmentCount, partial }
}

/** 汇总文案：只输出已填写部分，统计不完整时追加“部分路段有实际记录”。 */
export function formatActualSummaryText(summary: ActualSummary): string {
  const parts: string[] = []
  if (summary.distanceMeters !== null) parts.push(`实际里程 ${(summary.distanceMeters / 1000).toFixed(1)} 公里`)
  if (summary.durationSeconds !== null) parts.push(`实际用时 ${formatActualDurationSeconds(summary.durationSeconds)}`)
  if (summary.tollYuan !== null) parts.push(`实际过路费 ¥${summary.tollYuan.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`)
  if (parts.length === 0) return ''
  const text = parts.join(' · ')
  return summary.partial ? `${text}（部分路段有实际记录）` : text
}

export function formatActualDurationSeconds(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${totalMinutes}分钟`
  if (minutes <= 0) return `${hours}小时`
  return `${hours}小时${minutes}分钟`
}

export function formatSegmentActualDistance(segment: RouteSegment): string | null {
  const meters = getSegmentActual(segment)?.distanceMeters
  return typeof meters === 'number' ? `${(meters / 1000).toFixed(1)} 公里` : null
}

export function formatSegmentActualDuration(segment: RouteSegment): string | null {
  const seconds = getSegmentActual(segment)?.durationSeconds
  return typeof seconds === 'number' ? formatActualDurationSeconds(seconds) : null
}

export function formatSegmentActualToll(segment: RouteSegment): string | null {
  const toll = getSegmentActual(segment)?.tollYuan
  return typeof toll === 'number' ? `¥${toll.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}` : null
}

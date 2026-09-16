import type { RouteSegment } from '../types/trip.ts'
import { buildSegmentRouteKey } from './routeBuildKey.ts'

export interface DurationSummary {
  totalSeconds: number
  knownCount: number
  pendingCount: number
}

export function normalizeDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.round(value)
}

export function sumCompleteDurationSeconds(values: Array<number | undefined>): number | undefined {
  let total = 0
  for (const value of values) {
    const normalized = normalizeDurationSeconds(value)
    if (normalized === undefined) return undefined
    total += normalized
  }
  return total
}

export function hasCurrentDurationEstimate(segment: RouteSegment): boolean {
  if (segment.routeBuildKey !== buildSegmentRouteKey(segment)) return false
  return normalizeDurationSeconds(segment.estimatedDurationSeconds) !== undefined
}

export function getSegmentDurationSeconds(segment: RouteSegment): number | null {
  if (!hasCurrentDurationEstimate(segment)) return null
  return normalizeDurationSeconds(segment.estimatedDurationSeconds) ?? null
}

/** 统计“驾驶时间”时排除骑行算路时长；总路线用时仍使用 getSegmentDurationSeconds。 */
export function getSegmentDrivingDurationSeconds(segment: RouteSegment): number | null {
  if ((segment.routeType ?? 'DRIVING') !== 'DRIVING') return null
  return getSegmentDurationSeconds(segment)
}

export function summarizeEstimatedDurations(segments: RouteSegment[]): DurationSummary {
  return segments.reduce<DurationSummary>(
    (summary, segment) => {
      const seconds = getSegmentDurationSeconds(segment)
      if (seconds === null) {
        summary.pendingCount += 1
      } else {
        summary.totalSeconds += seconds
        summary.knownCount += 1
      }
      return summary
    },
    { totalSeconds: 0, knownCount: 0, pendingCount: 0 },
  )
}

export function formatDurationSeconds(value: number): string {
  const seconds = normalizeDurationSeconds(value) ?? 0
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours <= 0) return `${totalMinutes}分钟`
  if (minutes <= 0) return `${hours}小时`
  return `${hours}小时${minutes}分钟`
}

export function formatSegmentEstimatedDuration(segment: RouteSegment): string {
  const seconds = getSegmentDurationSeconds(segment)
  return seconds === null ? '待计算' : formatDurationSeconds(seconds)
}

export function formatDurationSummary(summary: DurationSummary): string {
  if (!summary.knownCount) return '待计算'
  const base = formatDurationSeconds(summary.totalSeconds)
  return summary.pendingCount ? `${base}（另有 ${summary.pendingCount} 条待计算）` : base
}

export function formatDurationUpdatedAt(value: string | undefined): string {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'
  return date.toLocaleString('zh-CN', { hour12: false })
}

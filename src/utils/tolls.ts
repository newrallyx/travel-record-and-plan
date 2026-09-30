import type { RouteSegment } from '../types/trip'
import { buildSegmentRouteKey } from './routeBuildKey.ts'

export interface TollSummary {
  amountYuan: number
  drivingSegmentCount: number
  knownSegmentCount: number
  pendingSegmentCount: number
}

export function normalizeTollValue(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed * 100) / 100
}

export function hasCurrentTollEstimate(segment: RouteSegment): boolean {
  if ((segment.routeType ?? 'DRIVING') !== 'DRIVING') return false
  return normalizeTollValue(segment.estimatedTollYuan) !== undefined
    && Boolean(segment.routeBuildKey)
    && segment.routeBuildKey === buildSegmentRouteKey(segment)
}

export function getSegmentTollYuan(segment: RouteSegment): number | null {
  if (!hasCurrentTollEstimate(segment)) return null
  return normalizeTollValue(segment.estimatedTollYuan) ?? null
}

export function summarizeEstimatedTolls(segments: RouteSegment[]): TollSummary {
  let amountYuan = 0
  let drivingSegmentCount = 0
  let knownSegmentCount = 0

  for (const segment of segments) {
    if ((segment.routeType ?? 'DRIVING') !== 'DRIVING') continue
    drivingSegmentCount += 1
    const toll = getSegmentTollYuan(segment)
    if (toll === null) continue
    knownSegmentCount += 1
    amountYuan += toll
  }

  return {
    amountYuan: Math.round(amountYuan * 100) / 100,
    drivingSegmentCount,
    knownSegmentCount,
    pendingSegmentCount: drivingSegmentCount - knownSegmentCount,
  }
}

export function formatTollAmount(amountYuan: number): string {
  const rounded = Math.round(amountYuan * 100) / 100
  return `¥${rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`
}

export function formatSegmentEstimatedToll(segment: RouteSegment): string {
  if ((segment.routeType ?? 'DRIVING') !== 'DRIVING') return '不适用'
  const toll = getSegmentTollYuan(segment)
  return toll === null ? '待计算' : formatTollAmount(toll)
}

export function formatTollSummary(summary: TollSummary): string {
  if (summary.drivingSegmentCount === 0) return '不适用'
  if (summary.knownSegmentCount === 0) return `待计算（${summary.pendingSegmentCount} 条驾车线路）`
  const amount = formatTollAmount(summary.amountYuan)
  return summary.pendingSegmentCount > 0
    ? `${amount}（另有 ${summary.pendingSegmentCount} 条待计算）`
    : amount
}

export function formatTollDistance(meters: number | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '待计算'
  return `${(meters / 1000).toFixed(1)} 公里`
}

export function formatTollUpdatedAt(value: string | undefined): string {
  if (!value) return '未计算'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未计算'
  return date.toLocaleString('zh-CN', { hour12: false })
}

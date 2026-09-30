import { getTripDistanceMeters } from './distance.ts'
import { formatDurationSeconds, summarizeEstimatedDurations } from './durations.ts'
import { formatTollAmount, summarizeEstimatedTolls } from './tolls.ts'
import type { Trip } from '../types/trip'

function formatIsoDateChinese(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`
}

function formatApproxKilometers(meters: number | null): string | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters <= 0) return null
  return `约 ${Math.round(meters / 1000)} 公里`
}

function countTripSegments(trip: Trip): number {
  return trip.days.reduce((sum, day) => sum + day.routeSegments.length, 0)
}

function countTripPhotos(trip: Trip): number {
  const photoIds = new Set<string>()
  for (const day of trip.days) {
    for (const segment of day.routeSegments) {
      for (const photoId of segment.photoIds ?? []) photoIds.add(photoId)
    }
  }
  return photoIds.size
}

/**
 * 事实摘要：只使用旅程中已存在的数据，缺失即省略；
 * 不包含任何主观描述；实时计算、不保存结果。
 * 没有任何可用事实时返回空字符串。
 */
export function buildTripFactSummary(trip: Trip): string {
  const parts: string[] = []

  const startText = formatIsoDateChinese(trip.startDate)
  const endText = formatIsoDateChinese(trip.endDate)
  if (startText && endText) {
    parts.push(`本次旅程从 ${startText} 持续至 ${endText}`)
  }

  const dayCount = trip.days.length
  const segmentCount = countTripSegments(trip)
  if (dayCount > 0 && segmentCount > 0) {
    parts.push(`共 ${dayCount} 天、${segmentCount} 条路段`)
  } else if (dayCount > 0) {
    parts.push(`共 ${dayCount} 天`)
  } else if (segmentCount > 0) {
    parts.push(`共 ${segmentCount} 条路段`)
  }

  const distanceText = formatApproxKilometers(getTripDistanceMeters(trip))
  if (distanceText) parts.push(`总里程${distanceText}`)

  const segments = trip.days.flatMap((day) => day.routeSegments)
  const durationSummary = summarizeEstimatedDurations(segments)
  if (durationSummary.knownCount > 0) {
    parts.push(`预计行驶 ${formatDurationSeconds(durationSummary.totalSeconds)}`)
  }

  const tollSummary = summarizeEstimatedTolls(segments)
  if (tollSummary.knownSegmentCount > 0) {
    parts.push(`预估过路费 ${formatTollAmount(tollSummary.amountYuan)}`)
  }

  const photoCount = countTripPhotos(trip)
  if (photoCount > 0) parts.push(`关联照片 ${photoCount} 张`)

  if (parts.length === 0) return ''
  return `${parts.join('，')}。`
}

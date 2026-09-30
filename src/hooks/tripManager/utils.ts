import type { SegmentRef } from './types'

interface SegmentSelection {
  dayId: string
  segmentId: string
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

export function createDuplicateTripTitle(title: string, existingTitles: Set<string>): string {
  const baseTitle = `${title} \u526f\u672c`
  if (!existingTitles.has(baseTitle)) return baseTitle

  let copyIndex = 2
  while (existingTitles.has(`${baseTitle} ${copyIndex}`)) {
    copyIndex += 1
  }
  return `${baseTitle} ${copyIndex}`
}

export function getSavedSegmentSelection(ref: SegmentRef, nextDate: string): SegmentSelection {
  const targetDay = ref.trip.days.find((day) => day.date === nextDate)
  return {
    dayId: targetDay?.id ?? nextDate,
    segmentId: ref.segment.id,
  }
}

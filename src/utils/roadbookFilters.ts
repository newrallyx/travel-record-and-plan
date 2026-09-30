import type { ReviewTag, Trip } from '../types/trip'
import { getTripDistanceMeters } from './distance.ts'

// 路书书架筛选：纯函数，便于单元测试。

export interface RoadbookFilterState {
  year: string
  query: string
  tag: string
}

export const ROADBOOK_EMPTY_FILTER: RoadbookFilterState = { year: '', query: '', tag: '' }

export function getTripYear(trip: Trip): string {
  return /^\d{4}/.test(trip.startDate) ? trip.startDate.slice(0, 4) : ''
}

export function getTripYears(trips: Trip[]): string[] {
  return Array.from(new Set(trips.map(getTripYear).filter(Boolean))).sort((a, b) => b.localeCompare(a))
}

export function getTripTags(trips: Trip[]): ReviewTag[] {
  const tags = new Set<ReviewTag>()
  for (const trip of trips) {
    for (const day of trip.days) {
      for (const segment of day.routeSegments) {
        for (const tag of segment.reviewFacts?.tags ?? []) tags.add(tag)
      }
    }
  }
  return Array.from(tags)
}

export function tripMatchesQuery(trip: Trip, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return true
  if (trip.title.toLocaleLowerCase().includes(keyword)) return true
  for (const day of trip.days) {
    for (const segment of day.routeSegments) {
      if (segment.startPoint.toLocaleLowerCase().includes(keyword)) return true
      if (segment.endPoint.toLocaleLowerCase().includes(keyword)) return true
      for (const waypoint of segment.waypoints ?? []) {
        if (waypoint.name.toLocaleLowerCase().includes(keyword)) return true
      }
    }
  }
  return false
}

export function tripMatchesTag(trip: Trip, tag: string): boolean {
  if (!tag) return true
  for (const day of trip.days) {
    for (const segment of day.routeSegments) {
      if ((segment.reviewFacts?.tags ?? []).includes(tag as ReviewTag)) return true
    }
  }
  return false
}

export function filterRoadbookTrips(trips: Trip[], filter: RoadbookFilterState): Trip[] {
  return trips.filter((trip) => {
    if (filter.year && getTripYear(trip) !== filter.year) return false
    if (!tripMatchesQuery(trip, filter.query)) return false
    if (!tripMatchesTag(trip, filter.tag)) return false
    return true
  })
}

export interface RoadbookStats {
  tripCount: number
  segmentCount: number
  photoCount: number
  distanceMeters: number | null
}

export function summarizeRoadbookStats(trips: Trip[]): RoadbookStats {
  const reviewTrips = trips.filter((trip) => trip.category === 'review')
  let segmentCount = 0
  const photoIds = new Set<string>()
  let distanceMeters: number | null = null

  // 统计只包含已完成的 review 旅程；相同道路或路线被多次行驶时按每次记录重复累计。
  for (const trip of reviewTrips) {
    const tripDistance = getTripDistanceMeters(trip)
    if (tripDistance !== null) distanceMeters = (distanceMeters ?? 0) + tripDistance
    for (const day of trip.days) {
      segmentCount += day.routeSegments.length
      for (const segment of day.routeSegments) {
        for (const photoId of segment.photoIds ?? []) photoIds.add(photoId)
      }
    }
  }

  return { tripCount: reviewTrips.length, segmentCount, photoCount: photoIds.size, distanceMeters }
}

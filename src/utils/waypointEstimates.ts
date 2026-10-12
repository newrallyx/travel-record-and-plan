import type { RouteSegment, WaypointRouteEstimate } from '../types/trip.ts'
import { buildSegmentRouteKey } from './routeBuildKey.ts'

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function normalizeWaypointEstimates(value: unknown): WaypointRouteEstimate[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined
  if (value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return undefined
  let previousDistance = 0
  let previousDuration = 0
  let distanceComplete = true
  let durationComplete = true
  return value.map(item => {
    const distance = nonNegative(item.distanceMeters)
    const duration = nonNegative(item.durationSeconds)
    distanceComplete &&= distance !== undefined && distance >= previousDistance
    durationComplete &&= duration !== undefined && duration >= previousDuration
    if (distanceComplete) previousDistance = distance!
    if (durationComplete) previousDuration = duration!
    return {
      ...(distanceComplete ? { distanceMeters: distance } : {}),
      ...(durationComplete ? { durationSeconds: duration } : {}),
    }
  })
}

export function getCurrentWaypointEstimates(segment: RouteSegment): WaypointRouteEstimate[] | undefined {
  if (segment.routeBuildKey !== buildSegmentRouteKey(segment)) return undefined
  const estimates = normalizeWaypointEstimates(segment.waypointEstimates)
  return estimates?.length === segment.waypoints?.length ? estimates : undefined
}

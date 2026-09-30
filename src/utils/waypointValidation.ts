import type { Waypoint } from '../types/trip'

export type ResolvedWaypoint = Waypoint & { lat: number; lng: number }

export function hasResolvedWaypointCoordinate(waypoint: Waypoint): waypoint is ResolvedWaypoint {
  return Number.isFinite(waypoint.lat)
    && Number.isFinite(waypoint.lng)
    && (waypoint.lat as number) >= -90
    && (waypoint.lat as number) <= 90
    && (waypoint.lng as number) >= -180
    && (waypoint.lng as number) <= 180
}

export function getUnresolvedNamedWaypoints(waypoints: Waypoint[] | undefined): Waypoint[] {
  return (waypoints ?? []).filter((waypoint) => (
    waypoint.name.trim().length > 0 && !hasResolvedWaypointCoordinate(waypoint)
  ))
}

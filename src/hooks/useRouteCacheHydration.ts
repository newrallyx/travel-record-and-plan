import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { getSegmentRouteCache } from '../services/routeCacheDb'
import { buildSegmentRouteKey } from '../utils/routeBuildKey'
import type { CoordPoint, TripReview } from '../types/trip'

interface UseRouteCacheHydrationParams {
  trips: TripReview['trips']
  setTripReview: Dispatch<SetStateAction<TripReview>>
}

export function useRouteCacheHydration({ trips, setTripReview }: UseRouteCacheHydrationParams) {
  useEffect(() => {
    let cancelled = false

    async function hydrateSegmentRouteCache() {
      try {
        const patchMap = new Map<string, CoordPoint[]>()

        for (const trip of trips) {
          for (const day of trip.days) {
            for (const segment of day.routeSegments) {
              const cache = await getSegmentRouteCache(segment.id)
              if (!cache) continue

              const buildKey = buildSegmentRouteKey(segment)
              if (cache.routeBuildKey !== buildKey) continue

              const samePoints =
                Array.isArray(segment.points) &&
                segment.points.length === cache.points.length &&
                segment.points.every((point, idx) => point.lat === cache.points[idx].lat && point.lon === cache.points[idx].lon)

              if (!samePoints) {
                patchMap.set(segment.id, cache.points)
              }
            }
          }
        }

        if (cancelled || patchMap.size === 0) return

        setTripReview((prev) => {
          let changed = false
          const nextTrips = prev.trips.map((trip) => {
            let tripChanged = false
            const nextDays = trip.days.map((day) => {
              let dayChanged = false
              const nextSegments = day.routeSegments.map((segment) => {
                const points = patchMap.get(segment.id)
                if (!points) return segment

                changed = true
                dayChanged = true
                tripChanged = true
                return { ...segment, points }
              })
              return dayChanged ? { ...day, routeSegments: nextSegments } : day
            })
            return tripChanged ? { ...trip, days: nextDays } : trip
          })

          return changed ? { trips: nextTrips } : prev
        })
      } catch (error) {
        console.error('[App] Failed to hydrate route cache from IndexedDB.', error)
      }
    }

    void hydrateSegmentRouteCache()

    return () => {
      cancelled = true
    }
  }, [trips, setTripReview])
}

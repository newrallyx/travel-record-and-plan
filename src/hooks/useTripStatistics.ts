import { useEffect, useMemo, useState } from 'react'
import { getAllSegmentRouteCache, type RouteCacheRecord } from '../services/routeCacheDb.ts'
import type { Trip } from '../types/trip.ts'
import { summarizeRoadStatisticsComparison } from '../utils/roadStatisticsComparison.ts'

export function useTripStatistics(currentTrips: readonly Trip[], allTrips: readonly Trip[], cacheRevision = 0) {
  const [routeCaches, setRouteCaches] = useState<RouteCacheRecord[]>([])
  const [cacheStatus, setCacheStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let cancelled = false
    setCacheStatus('loading')
    void getAllSegmentRouteCache().then((records) => {
      if (cancelled) return
      setRouteCaches(records)
      setCacheStatus('ready')
    }).catch(() => {
      if (cancelled) return
      setRouteCaches([])
      setCacheStatus('unavailable')
    })
    return () => { cancelled = true }
  }, [allTrips, cacheRevision])

  const statistics = useMemo(
    () => summarizeRoadStatisticsComparison(currentTrips, allTrips, routeCaches),
    [currentTrips, allTrips, routeCaches],
  )
  return { statistics, cacheStatus }
}

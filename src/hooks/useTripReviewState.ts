import { useEffect, useState } from 'react'
import { isReadonlyDemoMode } from '../config/appMode'
import { loadReadonlyDemoTripReview } from '../services/demoDataLoader'
import { loadTripReview, saveTripReview } from '../services/tripStorage'
import type { TripReview } from '../types/trip'

function createInitialTripReviewState(): TripReview {
  return isReadonlyDemoMode ? { trips: [] } : loadTripReview()
}

export function useTripReviewState() {
  const [tripReview, setTripReview] = useState<TripReview>(createInitialTripReviewState)
  const [isLoading, setIsLoading] = useState(isReadonlyDemoMode)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!isReadonlyDemoMode) return

    let active = true
    setIsLoading(true)
    setLoadError(null)

    void loadReadonlyDemoTripReview()
      .then((data) => {
        if (!active) return
        setTripReview(data)
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        if (!active) return
        const message = error instanceof Error ? error.message : '未知错误'
        setLoadError(message)
        setTripReview({ trips: [] })
        setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isReadonlyDemoMode) return
    saveTripReview(tripReview)
  }, [tripReview])

  return { tripReview, setTripReview, isLoading, loadError }
}

import { useEffect, useState } from 'react'
import { loadTripReview, saveTripReview } from '../services/tripStorage'
import type { TripReview } from '../types/trip'

export function useTripReviewState() {
  const [tripReview, setTripReview] = useState<TripReview>(() => loadTripReview())

  useEffect(() => {
    saveTripReview(tripReview)
  }, [tripReview])

  return { tripReview, setTripReview }
}

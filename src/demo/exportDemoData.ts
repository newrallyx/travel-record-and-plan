import type { TripReview } from '../types/trip'
import { toPersistedTripReview } from '../services/tripStorage'

export function exportTripReviewAsDemoJson(data: TripReview): string {
  return JSON.stringify(toPersistedTripReview(data), null, 2)
}

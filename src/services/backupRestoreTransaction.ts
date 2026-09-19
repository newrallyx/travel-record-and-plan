import type { RouteCacheRecord } from './routeCacheDb'
import type { TripReview } from '../types/trip'

export async function commitDesktopRestoreTransaction({
  currentTripReview,
  nextTripReview,
  currentRoutes,
  nextRoutes,
  persistTripReview,
  replaceRoutes,
  commitPhotos,
}: {
  currentTripReview: TripReview
  nextTripReview: TripReview
  currentRoutes: RouteCacheRecord[]
  nextRoutes: RouteCacheRecord[]
  persistTripReview: (tripReview: TripReview) => void
  replaceRoutes: (routes: RouteCacheRecord[]) => Promise<number>
  commitPhotos: () => Promise<void>
}): Promise<number> {
  let tripStorageReplaced = false
  let routeReplacementStarted = false
  try {
    persistTripReview(nextTripReview)
    tripStorageReplaced = true
    routeReplacementStarted = true
    const importedCacheCount = await replaceRoutes(nextRoutes)
    await commitPhotos()
    return importedCacheCount
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (routeReplacementStarted) {
      try {
        await replaceRoutes(currentRoutes)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (tripStorageReplaced) {
      try {
        persistTripReview(currentTripReview)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      const primaryMessage = error instanceof Error ? error.message : String(error)
      const rollbackMessage = rollbackErrors
        .map((rollbackError) => rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
        .join('; ')
      throw new Error(`Desktop restore failed and rollback was incomplete: ${primaryMessage}; ${rollbackMessage}`)
    }
    throw error
  }
}

import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { isReadonlyDemoMode } from '../config/appMode'
import type { ResolvedRoutePatch } from '../components/map/types'
import type { TripReview } from '../types/trip'
import { applyResolvedRoutePatches, persistResolvedRoutePatches } from './resolvedRoutePatches'

export function useResolvedRoutes(setTripReview: Dispatch<SetStateAction<TripReview>>) {
  return useCallback((patches: ResolvedRoutePatch[]) => {
    if (isReadonlyDemoMode || !patches.length) return
    void persistResolvedRoutePatches(patches)
    setTripReview((previous) => applyResolvedRoutePatches(previous, patches))
  }, [setTripReview])
}

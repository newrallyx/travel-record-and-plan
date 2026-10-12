import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { isReadonlyDemoMode } from '../config/appMode'
import type { ResolvedRoutePatch } from '../components/map/types'
import type { TripReview } from '../types/trip'
import { applyResolvedRoutePatches, persistResolvedRoutePatches } from './resolvedRoutePatches'
import { showToast } from '../components/ToastHost'

export function useResolvedRoutes(setTripReview: Dispatch<SetStateAction<TripReview>>) {
  return useCallback((patches: ResolvedRoutePatch[]) => {
    if (isReadonlyDemoMode || !patches.length) return
    void persistResolvedRoutePatches(patches).catch(() => {
      showToast('路线缓存保存失败，本次路线未完整保存，请检查存储空间或权限后重新规划。', 'error')
    })
    setTripReview((previous) => applyResolvedRoutePatches(previous, patches))
  }, [setTripReview])
}

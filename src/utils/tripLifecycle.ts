import type { TripReview } from '../types/trip'
import { normalizeTripOrders } from './tripOrder.ts'

/**
 * 旅程生命周期纯函数：把规划中的旅程一次性转入复盘。
 * 规则：
 * - 只允许 plan → review，单向操作；
 * - 旅程、日期、路段及其 ID 全部保留，不复制、不重建；
 * - order 在目标分类中追加到末尾并统一重排；
 * - 路线缓存、照片关联不在此处处理（不删除、不迁移）。
 * 找不到旅程或旅程不在规划分类时返回原数据。
 */
export function moveTripToReview(tripReview: TripReview, tripId: string): TripReview {
  let moved = false
  const trips = tripReview.trips.map((trip) => {
    if (!moved && trip.id === tripId && trip.category === 'plan') {
      moved = true
      return { ...trip, category: 'review' as const, order: undefined }
    }
    return trip
  })

  if (!moved) return tripReview
  return { ...tripReview, trips: normalizeTripOrders(trips) }
}

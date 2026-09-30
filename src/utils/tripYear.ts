import type { FilterState, Trip } from '../types/trip'

// 跨年旅程完整归入开始年份，不拆分旅程和路线。
export function getTripYear(trip: Trip): string {
  return /^\d{4}-/.test(trip.startDate) ? trip.startDate.slice(0, 4) : 'unknown'
}

export function getSelectedYear(trips: Trip[], filters: FilterState): string {
  const selectedTrip = trips.find((trip) => trip.id === filters.tripId)
  return selectedTrip ? getTripYear(selectedTrip) : filters.year ?? ''
}

export function filterTripsByYear(trips: Trip[], year: string): Trip[] {
  return year ? trips.filter((trip) => getTripYear(trip) === year) : trips
}

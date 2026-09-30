import type { Trip, TripCategory } from '../types/trip'

export function sortTripsByOrder(trips: Trip[]): Trip[] {
  return trips
    .map((trip, sourceIndex) => ({ trip, sourceIndex }))
    .sort((a, b) => {
      const orderDifference = (a.trip.order ?? Number.MAX_SAFE_INTEGER) - (b.trip.order ?? Number.MAX_SAFE_INTEGER)
      return orderDifference || a.sourceIndex - b.sourceIndex
    })
    .map(({ trip }) => trip)
}

export function sortTripsByStartDate(trips: Trip[]): Trip[] {
  return trips
    .map((trip, sourceIndex) => ({ trip, sourceIndex }))
    .sort((a, b) => {
      const startDateDifference = a.trip.startDate.localeCompare(b.trip.startDate)
      if (startDateDifference !== 0) return startDateDifference
      const endDateDifference = a.trip.endDate.localeCompare(b.trip.endDate)
      return endDateDifference || a.sourceIndex - b.sourceIndex
    })
    .map(({ trip }) => trip)
}

export function normalizeTripOrders(trips: Trip[]): Trip[] {
  const orderById = new Map<string, number>()
  const categories: TripCategory[] = ['review', 'plan']

  for (const category of categories) {
    sortTripsByOrder(trips.filter((trip) => trip.category === category)).forEach((trip, order) => {
      orderById.set(trip.id, order)
    })
  }

  return trips.map((trip) => ({
    ...trip,
    order: orderById.get(trip.id) ?? trip.order,
  }))
}

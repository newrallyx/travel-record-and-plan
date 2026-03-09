import type { RoutePreference, RouteType } from '../types/trip'

export const routePreferenceOptions: Array<{ value: RoutePreference; label: string }> = [
  { value: 'HIGHWAY_FIRST', label: '高速优先' },
  { value: 'AVOID_TOLL', label: '避免收费' },
]

export const routeTypeOptions: Array<{ value: RouteType; label: string }> = [
  { value: 'driving', label: '驾车路线' },
  { value: 'bicycling', label: '骑行路线（走小路）' },
]

export function getRoutePreferenceLabel(value?: RoutePreference): string {
  if (!value) return '高速优先'
  return routePreferenceOptions.find((option) => option.value === value)?.label ?? '高速优先'
}

export function getRouteTypeLabel(value?: RouteType): string {
  return routeTypeOptions.find((option) => option.value === value)?.label ?? '驾车路线'
}

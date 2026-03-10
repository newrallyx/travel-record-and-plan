import type { RoutePreference } from '../types/trip'

// 路线偏好选项：用于表单下拉和展示文案。
export const routePreferenceOptions: Array<{ value: RoutePreference; label: string }> = [
  { value: 'HIGHWAY_FIRST', label: '高速优先' },
  { value: 'AVOID_TOLL', label: '避免收费' },
]

export function getRoutePreferenceLabel(value: RoutePreference): string {
  return routePreferenceOptions.find((option) => option.value === value)?.label ?? value
}

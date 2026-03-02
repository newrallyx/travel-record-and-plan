import type { RoutePreference } from '../types/trip'

// 路线偏好选项：用于表单下拉和展示文案。
export const routePreferenceOptions: Array<{ value: RoutePreference; label: string }> = [
  { value: 'HIGHWAY_FIRST', label: '高速优先' },
  { value: 'LESS_TOLL', label: '避开高速' },
  { value: 'AVOID_TOLL', label: '避免收费' },
  { value: 'NORMAL_ROAD_FIRST', label: '普通道路优先' },
  { value: 'SHORTEST_TIME', label: '最短时间' },
]

export function getRoutePreferenceLabel(value: RoutePreference): string {
  return routePreferenceOptions.find((option) => option.value === value)?.label ?? value
}

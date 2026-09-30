import type { RoadClass } from '../types/roadStatistics.ts'
import { ROAD_DIRECTION_REFERENCES } from '../components/map/roadDirectionReference.ts'

export function roadDirectionOptions(roadClass: RoadClass, routeRef?: string, provinceCode?: string): readonly string[] {
  if (roadClass !== 'EXPRESSWAY' && roadClass !== 'NATIONAL_ROAD') return []
  const ref = (routeRef ?? '').toUpperCase().replace(/[\s-]/g, '')
  return ROAD_DIRECTION_REFERENCES[ref.startsWith('S') ? `${provinceCode}:${ref}` : ref]?.endpoints ?? []
}

/** Omitted means automatic; pending explicitly suppresses automatic naming for this interval. */
export function normalizeManualDirection(value: unknown, roadClass: RoadClass, routeRef?: string, provinceCode?: string): string | undefined {
  const options = roadDirectionOptions(roadClass, routeRef, provinceCode)
  return options.length && typeof value === 'string' && (value === 'pending' || options.includes(value)) ? value : undefined
}

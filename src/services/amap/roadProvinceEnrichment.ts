import type { RouteRoadPart } from '../../types/roadStatistics.ts'
import { applyProvinceResolution, isProvinceSensitiveRoadPart, pendingProvinceResolution } from '../../utils/province.ts'
import { requestAmapProvinceLookup, type AmapProvinceLookup } from './provinceLookup.ts'

type ProvinceLookup = (
  point: { lat: number; lon: number },
  signal?: AbortSignal,
) => Promise<AmapProvinceLookup | null>

function samplePolyline(polyline: readonly [number, number][] | undefined): Array<{ lat: number; lon: number }> {
  if (!polyline?.length) return []
  const indexes = [...new Set([0, Math.floor((polyline.length - 1) / 2), polyline.length - 1])]
  return indexes.map((index) => ({ lat: polyline[index][0], lon: polyline[index][1] }))
}

/**
 * 导航 step 缺省行政区时，只对道路片段自身折线取少量点补查。多个点落在不同省份
 * 时保留待确认，绝不采用第一个返回值覆盖整段。
 */
export async function enrichRoadPartsWithPolylineProvince(
  parts: readonly RouteRoadPart[],
  options: { signal?: AbortSignal; lookup?: ProvinceLookup } = {},
): Promise<RouteRoadPart[]> {
  const lookup = options.lookup ?? requestAmapProvinceLookup
  return Promise.all(parts.map(async (part) => {
    if (!isProvinceSensitiveRoadPart(part) || part.provinceStatus === 'confirmed') return { ...part }
    const points = samplePolyline(part.polyline)
    if (!points.length) return { ...part }

    const results = await Promise.all(points.map((point) => lookup(point, options.signal)))
    const codes = new Set<string>(part.provinceCandidates ?? [])
    const names = new Map<string, string>()
    for (const result of results) {
      if (!result?.provinceCode) continue
      codes.add(result.provinceCode)
      if (result.provinceName) names.set(result.provinceCode, result.provinceName)
    }

    if (codes.size !== 1) {
      return applyProvinceResolution(part, pendingProvinceResolution(
        results.some((result) => result) ? 'POLYLINE_GEOCODE' : (part.provinceSource ?? 'UNKNOWN'),
        [...codes],
      ))
    }

    const provinceCode = [...codes][0]
    // 导航证据只有一个省且补查一致时，仍保留 NAVIGATION 溯源。
    if (part.provinceCode === provinceCode) return { ...part, provinceStatus: 'confirmed' as const }
    return applyProvinceResolution(part, {
      provinceCode,
      provinceName: names.get(provinceCode),
      provinceSource: part.provinceCode === provinceCode && part.provinceSource
        ? part.provinceSource
        : 'POLYLINE_GEOCODE',
      provinceStatus: 'confirmed',
    })
  }))
}

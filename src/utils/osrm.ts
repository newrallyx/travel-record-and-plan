import type { RoutePreference } from '../types/trip'

export interface RoadPoint {
  lat: number
  lon: number
}

function buildExcludeParam(routeType: RoutePreference): string {
  if (routeType === 'HIGHWAY_FIRST') return ''
  if (routeType === 'LESS_TOLL') return 'motorway'
  if (routeType === 'NORMAL_ROAD_FIRST') return 'motorway,ferry'
  return ''
}

// OSRM 路网轨迹：根据经纬度点序列与路线类型获取沿道路路径（返回 Leaflet 用 [lat, lon]）。
export async function fetchRoadPolyline(
  points: RoadPoint[],
  routeType: RoutePreference,
): Promise<Array<[number, number]> | null> {
  if (points.length < 2) return null

  const joined = points.map((point) => `${point.lon},${point.lat}`).join(';')
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${joined}`)
  url.searchParams.set('overview', 'full')
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('steps', 'false')

  const exclude = buildExcludeParam(routeType)
  if (exclude) {
    url.searchParams.set('exclude', exclude)
  }

  try {
    const response = await fetch(url.toString())
    if (!response.ok) return null

    const data = (await response.json()) as {
      code?: string
      routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>
    }

    const route = data.routes?.[0]
    const coordinates = route?.geometry?.coordinates
    if (!coordinates || !coordinates.length) return null

    // OSRM 坐标顺序是 [lon, lat]，这里转换为 Leaflet 使用的 [lat, lon]。
    return coordinates.map(([lon, lat]) => [lat, lon])
  } catch {
    return null
  }
}

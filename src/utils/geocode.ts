// 地理编码工具：使用 OSM Nominatim 把地点文本转为经纬度，并做本地缓存与串行节流。

const GEO_CACHE_KEY = 'geoCache_v1'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

export interface GeoPoint {
  lat: number
  lon: number
  label: string
}

interface NominatimCandidate {
  lat: string
  lon: string
  display_name: string
  importance?: number
  type?: string
  class?: string
}

type GeoCache = Record<string, GeoPoint>

export function normalizePlaceName(place: string): string {
  return place.trim().replace(/[，、；;|]/g, ',').replace(/\s+/g, ' ')
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase()
}

function loadGeoCache(): GeoCache {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as GeoCache
  } catch {
    return {}
  }
}

function saveGeoCache(cache: GeoCache): void {
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function pickBestCandidate(candidates: NominatimCandidate[]): NominatimCandidate | null {
  if (!candidates.length) return null

  const typeWeight: Record<string, number> = {
    house: 2,
    road: 2,
    neighbourhood: 1,
    village: 3,
    town: 3,
    city: 3,
    county: 2,
    state: 1,
    administrative: 0,
    railway: -1,
    waterway: -1,
  }

  const sorted = [...candidates].sort((a, b) => {
    const scoreA = (a.importance ?? 0) + (typeWeight[a.type ?? ''] ?? 0)
    const scoreB = (b.importance ?? 0) + (typeWeight[b.type ?? ''] ?? 0)
    return scoreB - scoreA
  })

  return sorted[0] ?? null
}

function buildQueryVariants(place: string, context?: string): string[] {
  const base = normalizePlaceName(place)
  if (!base) return []

  const list = [base]
  if (context) {
    list.push(`${base}, ${normalizePlaceName(context)}`)
  }
  list.push(`${base}, 中国`)

  return Array.from(new Set(list))
}

export async function geocodePlace(place: string, context?: string): Promise<GeoPoint | null> {
  const queryVariants = buildQueryVariants(place, context)
  if (!queryVariants.length) return null

  const cache = loadGeoCache()

  for (const query of queryVariants) {
    const cacheKey = normalizeQueryKey(query)
    if (cache[cacheKey]) {
      return cache[cacheKey]
    }

    try {
      const url = new URL(NOMINATIM_URL)
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('q', query)
      url.searchParams.set('accept-language', 'zh-CN')
      url.searchParams.set('countrycodes', 'cn')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('limit', '3')

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        continue
      }

      const data = (await response.json()) as NominatimCandidate[]
      const best = pickBestCandidate(data)
      if (!best) {
        continue
      }

      const point: GeoPoint = {
        lat: Number(best.lat),
        lon: Number(best.lon),
        label: best.display_name,
      }

      if (Number.isNaN(point.lat) || Number.isNaN(point.lon)) {
        continue
      }

      cache[cacheKey] = point
      saveGeoCache(cache)
      return point
    } catch {
      continue
    }
  }

  return null
}

export async function geocodePlacesSerial(
  places: Array<{ place: string; context?: string }>,
): Promise<Record<string, GeoPoint>> {
  const result: Record<string, GeoPoint> = {}

  for (const item of places) {
    const normalized = normalizePlaceName(item.place)
    if (!normalized || result[normalized]) continue

    const point = await geocodePlace(normalized, item.context)
    if (point) {
      result[normalized] = point
    }

    // 串行请求间隔，避免触发公共服务限流。
    await delay(450)
  }

  return result
}

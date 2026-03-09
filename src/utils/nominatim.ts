// Nominatim 查询工具：封装联想搜索、结果排序、格式化和查询缓存。

const QUERY_CACHE_KEY = 'nominatim_query_cache_v1'
const QUERY_API = 'https://nominatim.openstreetmap.org/search'
const memoryCache = new Map<string, NominatimPlace[]>()

interface NominatimAddress {
  state?: string
  province?: string
  city?: string
  county?: string
  town?: string
  village?: string
  suburb?: string
  hamlet?: string
}

export interface NominatimPlace {
  place_id?: number | string
  osm_id?: number | string
  osm_type?: string
  lat: string
  lon: string
  display_name: string
  importance?: number
  type?: string
  address?: NominatimAddress
}

function loadQueryCache(): Record<string, NominatimPlace[]> {
  try {
    const raw = localStorage.getItem(QUERY_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, NominatimPlace[]>
  } catch {
    return {}
  }
}

function saveQueryCache(cache: Record<string, NominatimPlace[]>): void {
  localStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(cache))
}

export function normalizeQuery(query: string): string {
  return query.trim().replace(/[，、；;|]/g, ' ').replace(/\s+/g, ' ')
}

export function formatPlaceLabel(address?: NominatimAddress): string {
  if (!address) return ''

  const province = address.state ?? address.province
  const city = address.city
  const county = address.county
  const town = address.town ?? address.village ?? address.suburb ?? address.hamlet

  return [province, city, county, town].filter(Boolean).join(' - ')
}

function candidateLevelScore(place: NominatimPlace): number {
  const address = place.address
  if (!address) return 0

  if (address.town || address.village || address.suburb || address.hamlet) return 3
  if (address.county) return 2
  if (address.city) return 1
  return 0
}

export function rankCandidates(candidates: NominatimPlace[]): NominatimPlace[] {
  return [...candidates].sort((a, b) => {
    const levelDiff = candidateLevelScore(b) - candidateLevelScore(a)
    if (levelDiff !== 0) return levelDiff
    return (b.importance ?? 0) - (a.importance ?? 0)
  })
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<NominatimPlace[]> {
  const normalized = normalizeQuery(query)
  if (!normalized) return []

  if (memoryCache.has(normalized)) {
    return memoryCache.get(normalized) ?? []
  }

  const localCache = loadQueryCache()
  if (localCache[normalized]) {
    memoryCache.set(normalized, localCache[normalized])
    return localCache[normalized]
  }

  const url = new URL(QUERY_API)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', normalized)
  url.searchParams.set('countrycodes', 'cn')
  url.searchParams.set('accept-language', 'zh-CN')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '8')

  const response = await fetch(url.toString(), {
    signal,
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    return []
  }

  const raw = (await response.json()) as NominatimPlace[]
  const ranked = rankCandidates(raw)
  memoryCache.set(normalized, ranked)
  localCache[normalized] = ranked
  saveQueryCache(localCache)

  return ranked
}

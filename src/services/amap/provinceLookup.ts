import { LOCAL_API_CLIENT_HEADERS } from '../localApiClient.ts'
import type { CoordPoint } from '../../types/trip.ts'
import { normalizeProvinceCode, provinceNameFromCode } from '../../utils/province.ts'

export interface AmapProvinceLookup {
  provinceCode?: string
  provinceName?: string
}

const LOOKUP_CACHE_LIMIT = 500
const LOOKUP_CACHE_TTL_MS = 10 * 60 * 1000
const lookupCache = new Map<string, { expireAt: number; value: AmapProvinceLookup | null }>()

function cacheKey(point: Pick<CoordPoint, 'lat' | 'lon'>): string {
  return `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`
}

function writeCache(key: string, value: AmapProvinceLookup | null): void {
  lookupCache.delete(key)
  lookupCache.set(key, { expireAt: Date.now() + LOOKUP_CACHE_TTL_MS, value })
  while (lookupCache.size > LOOKUP_CACHE_LIMIT) {
    const oldest = lookupCache.keys().next().value
    if (!oldest) break
    lookupCache.delete(oldest)
  }
}

export async function requestAmapProvinceLookup(
  point: Pick<CoordPoint, 'lat' | 'lon'>,
  signal?: AbortSignal,
): Promise<AmapProvinceLookup | null> {
  const key = cacheKey(point)
  const cached = lookupCache.get(key)
  if (cached) {
    if (cached.expireAt > Date.now()) return cached.value
    lookupCache.delete(key)
  }

  if (typeof window === 'undefined') return null

  const url = new URL('/api/amap/regeo', window.location.origin)
  // AMap Web Service uses longitude,latitude; project coordinates use lat,lon.
  url.searchParams.set('location', `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`)

  try {
    const response = await fetch(`${url.pathname}${url.search}`, {
      headers: LOCAL_API_CLIENT_HEADERS,
      signal,
    })
    const raw = (await response.json()) as {
      ok?: boolean
      data?: {
        status?: string
        regeocode?: {
          addressComponent?: {
            province?: string
            adcode?: string
          }
        }
      }
    }
    const component = raw.data?.regeocode?.addressComponent
    if (!response.ok || !raw.ok || raw.data?.status !== '1' || !component) {
      writeCache(key, null)
      return null
    }
    const provinceCode = normalizeProvinceCode(component.adcode) ?? normalizeProvinceCode(component.province)
    const value = provinceCode
      ? { provinceCode, provinceName: provinceNameFromCode(provinceCode) }
      : null
    writeCache(key, value)
    return value
  } catch (error) {
    if ((error as Error).name !== 'AbortError') writeCache(key, null)
    return null
  }
}

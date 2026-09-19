import { LOCAL_API_CLIENT_HEADERS } from '../localApiClient.ts'
import type { AMapPlaceSuggestion, AMapServiceError, AMapTip, InputTipsQuery } from './types'
import { parseLocationText } from './utils'

const INPUT_TIPS_CACHE_MAX = 200
const INPUT_TIPS_CACHE_TTL_MS = 10 * 60 * 1000

interface CachedTipsEntry {
  expireAt: number
  data: AMapPlaceSuggestion[]
}

const inputTipsCache = new Map<string, CachedTipsEntry>()

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeRawTip(raw: unknown): AMapTip {
  const tip = (raw ?? {}) as Record<string, unknown>
  return {
    id: toStringOrEmpty(tip.id),
    name: toStringOrEmpty(tip.name),
    district: toStringOrEmpty(tip.district),
    address: toStringOrEmpty(tip.address),
    location: toStringOrEmpty(tip.location),
    adcode: toStringOrEmpty(tip.adcode),
    typecode: toStringOrEmpty(tip.typecode),
    type: toStringOrEmpty(tip.type),
  }
}

function looksAdministrativeName(name: string): boolean {
  return /省|市|区|县|旗|盟|州$/.test(name)
}

function formatHierarchy(tip: AMapTip): string {
  const districtParts = tip.district.split(/[·\s]/).map((part) => part.trim()).filter(Boolean)
  const addressParts = tip.address.split(/[·\s]/).map((part) => part.trim()).filter(Boolean)
  return [...districtParts, ...addressParts].join('·')
}

function normalizeTip(
  tip: AMapTip,
  sourceType: AMapPlaceSuggestion['sourceType'],
): AMapPlaceSuggestion | null {
  if (!tip.location) return null
  const point = parseLocationText(tip.location)
  if (!point) return null

  const hierarchy = formatHierarchy(tip)
  const displayName = hierarchy ? `${tip.name}（${hierarchy}）` : tip.name
  const isAdministrative = sourceType === 'city' || looksAdministrativeName(tip.name)

  return {
    id: tip.id,
    name: tip.name,
    displayName,
    lat: point.lat,
    lng: point.lng,
    district: tip.district,
    address: tip.address,
    adcode: tip.adcode,
    sourceType,
    isAdministrative,
  }
}

function dedupeTips(list: AMapPlaceSuggestion[]): AMapPlaceSuggestion[] {
  const seen = new Set<string>()
  const result: AMapPlaceSuggestion[] = []

  for (const item of list) {
    const key = `${item.name}|${item.district ?? ''}|${item.lat.toFixed(6)},${item.lng.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

function makeInputTipsCacheKey(query: InputTipsQuery): string {
  return [
    query.keywords.trim(),
    query.city ?? '',
    query.mode ?? 'poi',
    query.type ?? '',
    query.location ?? '',
    query.datatype ?? 'all',
    query.citylimit ? '1' : '0',
  ].join('|')
}

function trimInputTipsCache() {
  while (inputTipsCache.size > INPUT_TIPS_CACHE_MAX) {
    const oldest = inputTipsCache.keys().next().value
    if (!oldest) return
    inputTipsCache.delete(oldest)
  }
}

function readCachedInputTips(cacheKey: string): AMapPlaceSuggestion[] | null {
  const found = inputTipsCache.get(cacheKey)
  if (!found) return null
  if (found.expireAt <= Date.now()) {
    inputTipsCache.delete(cacheKey)
    return null
  }
  inputTipsCache.delete(cacheKey)
  inputTipsCache.set(cacheKey, found)
  return found.data
}

function writeCachedInputTips(cacheKey: string, tips: AMapPlaceSuggestion[]) {
  inputTipsCache.delete(cacheKey)
  inputTipsCache.set(cacheKey, { expireAt: Date.now() + INPUT_TIPS_CACHE_TTL_MS, data: tips })
  trimInputTipsCache()
}

async function requestInputTips(
  query: InputTipsQuery,
  signal?: AbortSignal,
): Promise<{ tips: AMapPlaceSuggestion[]; error: AMapServiceError | null }> {
  const cacheKey = makeInputTipsCacheKey(query)
  const cached = readCachedInputTips(cacheKey)
  if (cached) return { tips: cached, error: null }

  const keywords = query.keywords.trim()
  if (!keywords) return { tips: [], error: null }

  const url = new URL('/api/amap/inputtips', window.location.origin)
  url.searchParams.set('keywords', keywords)
  url.searchParams.set('datatype', query.datatype ?? 'all')
  if (query.mode) url.searchParams.set('mode', query.mode)
  if (query.type) url.searchParams.set('type', query.type)
  if (query.city) url.searchParams.set('city', query.city)
  if (query.location) url.searchParams.set('location', query.location)
  if (typeof query.citylimit === 'boolean') {
    url.searchParams.set('citylimit', query.citylimit ? 'true' : 'false')
  }

  try {
    const response = await fetch(`${url.pathname}${url.search}`, {
      headers: LOCAL_API_CLIENT_HEADERS,
      signal,
    })
    const payload = (await response.json()) as {
      ok?: boolean
      data?: Array<{
        id?: string
        name?: string
        district?: string
        address?: string
        location?: string
        adcode?: string
      }>
      cached?: boolean
      reason?: string
    }

    if (!response.ok || !payload.ok || !Array.isArray(payload.data)) {
      return { tips: [], error: { message: '联想服务暂不可用，点击重试。' } }
    }

    const sourceType: AMapPlaceSuggestion['sourceType'] = query.mode === 'city' ? 'city' : 'poi'
    const tips = payload.data
      .map((item) => normalizeRawTip(item))
      .map((item) => normalizeTip(item, sourceType))
      .filter((item): item is AMapPlaceSuggestion => Boolean(item))

    writeCachedInputTips(cacheKey, tips)
    return { tips, error: null }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return { tips: [], error: null }
    return { tips: [], error: { message: '联想服务暂不可用，点击重试。' } }
  }
}

export async function searchAmapInputTips(
  query: InputTipsQuery,
  signal?: AbortSignal,
): Promise<{ tips: AMapPlaceSuggestion[]; error: AMapServiceError | null }> {
  const keywords = query.keywords.trim()
  if (keywords.length < 2) return { tips: [], error: null }

  const cityQuery: InputTipsQuery = {
    keywords,
    mode: 'city',
    city: query.city,
    citylimit: query.citylimit,
    datatype: query.datatype,
    location: query.location,
  }
  const poiQuery: InputTipsQuery = {
    keywords,
    city: query.city,
    citylimit: query.citylimit,
    datatype: query.datatype,
    type: query.type,
    location: query.location,
  }

  const [cityResponse, poiResponse] = await Promise.all([
    requestInputTips(cityQuery, signal),
    requestInputTips(poiQuery, signal),
  ])

  let fallbackPoi: AMapPlaceSuggestion[] = []
  if (query.citylimit && poiResponse.tips.length <= 2) {
    const fallbackResponse = await requestInputTips(
      { keywords, citylimit: false, datatype: query.datatype },
      signal,
    )
    fallbackPoi = fallbackResponse.tips.map((item) => ({
      ...item,
      sourceType: 'fallback-poi',
      isOutOfScope: true,
    }))
  }

  return {
    tips: dedupeTips([...cityResponse.tips, ...poiResponse.tips, ...fallbackPoi]),
    error: cityResponse.error ?? poiResponse.error,
  }
}

import type { RoutePreference } from '../types/trip'

const ROUTE_QUEUE_CONCURRENCY = 2
const ROUTE_REQUEST_DELAY_MS = 200
const INPUT_TIPS_CACHE_MAX = 200
const INPUT_TIPS_CACHE_TTL_MS = 10 * 60 * 1000

export interface AMapTip {
  id: string
  name: string
  district: string
  address: string
  location: string
  adcode: string
  typecode: string
  type: string
}

export interface AMapPlaceSuggestion {
  id?: string
  name: string
  displayName: string
  lat: number
  lng: number
  district?: string
  address?: string
  adcode?: string
  sourceType?: 'city' | 'poi' | 'fallback-poi'
  isAdministrative?: boolean
  isOutOfScope?: boolean
}

export interface InputTipsQuery {
  keywords: string
  mode?: 'poi' | 'city'
  type?: string
  city?: string
  citylimit?: boolean
  datatype?: 'all' | 'poi' | 'bus' | 'busline'
  location?: string
}

export interface DrivingRequestPoint {
  lat: number
  lng: number
}

export interface DrivingRouteResult {
  polyline: Array<[number, number]>
  distanceText: string
  durationText: string
  distanceMeters?: number
  routeKey: string
  fromCache?: boolean
}

export interface AMapServiceError {
  code?: string
  message: string
}

type RouteTask = {
  run: () => Promise<DrivingRouteResult>
  resolve: (value: DrivingRouteResult) => void
  reject: (reason?: unknown) => void
}

type CachedTipsEntry = {
  expireAt: number
  data: AMapPlaceSuggestion[]
}

const routeCache = new Map<string, DrivingRouteResult>()
const inputTipsCache = new Map<string, CachedTipsEntry>()
const routeTaskQueue: RouteTask[] = []
let activeRouteTasks = 0

function toLonLatText(point: DrivingRequestPoint): string {
  return `${point.lng},${point.lat}`
}

function parseLocationText(location: string): { lat: number; lng: number } | null {
  const [lngText, latText] = location.split(',')
  const lng = Number(lngText)
  const lat = Number(latText)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function preferenceToStrategy(preference: RoutePreference): string {
  if (preference === 'HIGHWAY_FIRST') return '0'
  if (preference === 'AVOID_TOLL') return '1'
  return '0'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function processRouteQueue() {
  while (activeRouteTasks < ROUTE_QUEUE_CONCURRENCY && routeTaskQueue.length) {
    const nextTask = routeTaskQueue.shift()
    if (!nextTask) return

    activeRouteTasks += 1
    void nextTask
      .run()
      .then(nextTask.resolve)
      .catch(nextTask.reject)
      .finally(() => {
        activeRouteTasks -= 1
        processRouteQueue()
      })
  }
}

function enqueueRouteTask(run: () => Promise<DrivingRouteResult>): Promise<DrivingRouteResult> {
  return new Promise<DrivingRouteResult>((resolve, reject) => {
    routeTaskQueue.push({ run, resolve, reject })
    processRouteQueue()
  })
}

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

function buildRouteKey(points: DrivingRequestPoint[], preference: RoutePreference): string {
  const origin = toLonLatText(points[0])
  const destination = toLonLatText(points[points.length - 1])
  const via = points.length > 2 ? points.slice(1, -1).map(toLonLatText).join(';') : ''
  const strategy = preferenceToStrategy(preference)
  return `${origin}|${destination}|${via}|${strategy}`
}

function looksAdministrativeName(name: string): boolean {
  return /省|市|区|县|旗|盟|州$/.test(name)
}

function formatHierarchy(tip: AMapTip): string {
  const districtParts = tip.district.split(/[·\s]/).map((part) => part.trim()).filter(Boolean)
  const addressParts = tip.address.split(/[·\s]/).map((part) => part.trim()).filter(Boolean)
  const merged = [...districtParts, ...addressParts]
  return merged.join('·')
}

function normalizeTip(tip: AMapTip, sourceType: AMapPlaceSuggestion['sourceType']): AMapPlaceSuggestion | null {
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
  if (cached) {
    return { tips: cached, error: null }
  }

  const q = query.keywords.trim()
  if (!q) return { tips: [], error: null }

  const url = new URL('/api/amap/inputtips', window.location.origin)
  url.searchParams.set('keywords', q)
  url.searchParams.set('datatype', query.datatype ?? 'all')
  if (query.mode) url.searchParams.set('mode', query.mode)
  if (query.type) url.searchParams.set('type', query.type)
  if (query.city) url.searchParams.set('city', query.city)
  if (query.location) url.searchParams.set('location', query.location)
  if (typeof query.citylimit === 'boolean') {
    url.searchParams.set('citylimit', query.citylimit ? 'true' : 'false')
  }

  try {
    const response = await fetch(`${url.pathname}${url.search}`, { signal })
    const payload = (await response.json()) as {
      ok?: boolean
      data?: Array<{ id?: string; name?: string; district?: string; address?: string; location?: string; adcode?: string }>
      cached?: boolean
      reason?: string
    }

    if (!response.ok || !payload.ok || !Array.isArray(payload.data)) {
      return {
        tips: [],
        error: { message: '联想服务暂不可用，点击重试。' },
      }
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
  const q = query.keywords.trim()
  if (q.length < 2) return { tips: [], error: null }

  const cityQuery: InputTipsQuery = {
    keywords: q,
    mode: 'city',
    city: query.city,
    citylimit: query.citylimit,
    datatype: query.datatype,
    location: query.location,
  }

  const poiQuery: InputTipsQuery = {
    keywords: q,
    city: query.city,
    citylimit: query.citylimit,
    datatype: query.datatype,
    type: query.type,
    location: query.location,
  }

  const [cityResp, poiResp] = await Promise.all([requestInputTips(cityQuery, signal), requestInputTips(poiQuery, signal)])

  let fallbackPoi: AMapPlaceSuggestion[] = []
  if (query.citylimit && poiResp.tips.length <= 2) {
    const fallbackResp = await requestInputTips({ keywords: q, citylimit: false, datatype: query.datatype }, signal)
    fallbackPoi = fallbackResp.tips.map((item) => ({ ...item, sourceType: 'fallback-poi', isOutOfScope: true }))
  }

  const merged = dedupeTips([...cityResp.tips, ...poiResp.tips, ...fallbackPoi])
  const firstError = cityResp.error ?? poiResp.error
  return { tips: merged, error: firstError }
}

export async function requestDrivingRoute(
  originLngLat: string,
  destLngLat: string,
  strategy = '0',
  waypoints?: string,
): Promise<{ polyline: Array<[number, number]>; distanceText: string; durationText: string; distanceMeters?: number }> {
  const url = new URL('/api/amap/direction', window.location.origin)
  url.searchParams.set('origin', originLngLat)
  url.searchParams.set('destination', destLngLat)
  url.searchParams.set('strategy', strategy)
  if (waypoints) {
    url.searchParams.set('waypoints', waypoints)
  }

  const response = await fetch(`${url.pathname}${url.search}`)
  const raw = (await response.json()) as {
    ok?: boolean
    message?: string
    detail?: unknown
    data?: {
      status?: string
      info?: string
      infocode?: string
      route?: {
        paths?: Array<{
          distance?: string
          duration?: string
          steps?: Array<{ polyline?: string }>
        }>
      }
    }
  }

  if (!response.ok || !raw.ok) {
    if (import.meta.env.DEV) {
      console.error('Direction raw response', raw)
    }
    throw new Error(raw.message || 'direction failed')
  }

  const payload = raw.data
  if (!payload || payload.status !== '1') {
    if (import.meta.env.DEV) {
      console.error('Direction amap payload', payload)
    }
    throw new Error(payload?.info || payload?.infocode || 'direction failed')
  }

  const path = payload.route?.paths?.[0]
  if (!path) throw new Error('高德未返回可用路线。')

  const pointsList: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const step of path.steps ?? []) {
    if (!step.polyline) continue
    for (const rawPair of step.polyline.split(';')) {
      const parsed = parseLocationText(rawPair)
      if (!parsed) continue
      const key = `${parsed.lat.toFixed(6)},${parsed.lng.toFixed(6)}`
      if (seen.has(key)) continue
      seen.add(key)
      pointsList.push([parsed.lat, parsed.lng])
    }
  }

  if (!pointsList.length) {
    throw new Error('高德返回路线为空。')
  }

  return {
    polyline: pointsList,
    distanceText: path.distance ? `${path.distance} 米` : '未知',
    durationText: path.duration ? `${path.duration} 秒` : '未知',
    distanceMeters: path.distance ? Number(path.distance) : undefined,
  }
}

export async function requestCyclingRoute(
  originLngLat: string,
  destLngLat: string,
): Promise<{ polyline: Array<[number, number]>; distanceText: string; durationText: string; distanceMeters?: number }> {
  const url = new URL('/api/amap/cycling-direction', window.location.origin)
  url.searchParams.set('origin', originLngLat)
  url.searchParams.set('destination', destLngLat)

  const response = await fetch(`${url.pathname}${url.search}`)
  const raw = (await response.json()) as {
    ok?: boolean
    message?: string
    data?: {
      errcode?: number
      errmsg?: string
      data?: {
        paths?: Array<{
          distance?: number
          duration?: number
          steps?: Array<{ polyline?: string }>
        }>
      }
    }
  }

  if (!response.ok || !raw.ok) {
    throw new Error(raw.message || 'cycling direction failed')
  }

  const payload = raw.data
  if (!payload || payload.errcode !== 0) {
    throw new Error(payload?.errmsg || 'cycling direction failed')
  }

  const path = payload.data?.paths?.[0]
  if (!path) throw new Error('高德未返回可用骑行路线。')

  const pointsList: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const step of path.steps ?? []) {
    if (!step.polyline) continue
    for (const rawPair of step.polyline.split(';')) {
      const parsed = parseLocationText(rawPair)
      if (!parsed) continue
      const key = `${parsed.lat.toFixed(6)},${parsed.lng.toFixed(6)}`
      if (seen.has(key)) continue
      seen.add(key)
      pointsList.push([parsed.lat, parsed.lng])
    }
  }

  if (!pointsList.length) {
    throw new Error('高德返回骑行路线为空。')
  }

  return {
    polyline: pointsList,
    distanceText: typeof path.distance === 'number' ? `${path.distance} 米` : '未知',
    durationText: typeof path.duration === 'number' ? `${path.duration} 秒` : '未知',
    distanceMeters: typeof path.distance === 'number' ? path.distance : undefined,
  }
}

async function planDrivingRouteRaw(
  points: DrivingRequestPoint[],
  preference: RoutePreference,
  routeKey: string,
): Promise<{ route: DrivingRouteResult | null; error: AMapServiceError | null }> {
  if (points.length < 2) return { route: null, error: { code: 'POINTS_NOT_ENOUGH', message: '路径规划至少需要起点和终点。' } }

  const origin = toLonLatText(points[0])
  const destination = toLonLatText(points[points.length - 1])
  const strategy = preferenceToStrategy(preference)
  const waypoints = points.length > 2 ? points.slice(1, -1).map(toLonLatText).join('|') : undefined

  try {
    const result = await requestDrivingRoute(origin, destination, strategy, waypoints)
    return {
      route: {
        polyline: result.polyline,
        distanceText: result.distanceText,
        durationText: result.durationText,
        distanceMeters: result.distanceMeters,
        routeKey,
      },
      error: null,
    }
  } catch (error) {
    return {
      route: null,
      error: { message: (error as Error).message || '高德驾车规划请求失败，请检查网络或稍后重试。' },
    }
  }
}

export async function planDrivingRoute(
  points: DrivingRequestPoint[],
  preference: RoutePreference,
): Promise<{ route: DrivingRouteResult | null; error: AMapServiceError | null }> {
  const routeKey = buildRouteKey(points, preference)
  const cached = routeCache.get(routeKey)
  if (cached) {
    return {
      route: { ...cached, fromCache: true },
      error: null,
    }
  }

  const result = await enqueueRouteTask(async () => {
    await sleep(ROUTE_REQUEST_DELAY_MS)
    const { route, error } = await planDrivingRouteRaw(points, preference, routeKey)
    if (!route || error) {
      throw error ?? { message: '驾车规划失败' }
    }
    return route
  })
    .then((route) => ({ route, error: null as AMapServiceError | null }))
    .catch((error: AMapServiceError) => ({ route: null, error }))

  if (result.route) {
    routeCache.set(routeKey, result.route)
  }

  return result
}

export async function planCyclingRoute(
  points: DrivingRequestPoint[],
): Promise<{ route: DrivingRouteResult | null; error: AMapServiceError | null }> {
  if (points.length < 2) return { route: null, error: { code: 'POINTS_NOT_ENOUGH', message: '路径规划至少需要起点和终点。' } }

  const routeKey = `${points.map(toLonLatText).join('|')}|CYCLING`
  const cached = routeCache.get(routeKey)
  if (cached) return { route: { ...cached, fromCache: true }, error: null }

  const run = async () => {
    await sleep(ROUTE_REQUEST_DELAY_MS)
    const polyline: Array<[number, number]> = []
    let distanceMeters = 0
    let durationSeconds = 0

    for (let idx = 0; idx < points.length - 1; idx += 1) {
      const leg = await requestCyclingRoute(toLonLatText(points[idx]), toLonLatText(points[idx + 1]))
      distanceMeters += Number(leg.distanceText.replace(/[^\d.]/g, '')) || 0
      durationSeconds += Number(leg.durationText.replace(/[^\d.]/g, '')) || 0
      polyline.push(...leg.polyline)
    }

    if (!polyline.length) throw new Error('骑行规划失败')

    const route: DrivingRouteResult = {
      polyline,
      distanceText: `${Math.round(distanceMeters)} 米`,
      durationText: `${Math.round(durationSeconds)} 秒`,
      distanceMeters: Math.round(distanceMeters),
      routeKey,
    }
    routeCache.set(routeKey, route)
    return route
  }

  return enqueueRouteTask(run)
    .then((route) => ({ route, error: null as AMapServiceError | null }))
    .catch((error: AMapServiceError) => ({ route: null, error: { message: error?.message || '高德骑行规划请求失败，请检查网络或稍后重试。' } }))
}

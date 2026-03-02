import type { RoutePreference } from '../types/trip'

const AMAP_DRIVING_URL = 'https://restapi.amap.com/v3/direction/driving'

const ROUTE_QUEUE_CONCURRENCY = 2
const ROUTE_REQUEST_DELAY_MS = 200

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
  type?: 'city'
  city?: string
  citylimit?: boolean
}

export interface DrivingRequestPoint {
  lat: number
  lng: number
}

export interface DrivingRouteResult {
  polyline: Array<[number, number]>
  distanceText: string
  durationText: string
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

const routeCache = new Map<string, DrivingRouteResult>()
const routeTaskQueue: RouteTask[] = []
let activeRouteTasks = 0

function getAmapKey(): string {
  const key = import.meta.env.VITE_AMAP_KEY
  return typeof key === 'string' ? key.trim() : ''
}

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
  if (preference === 'LESS_TOLL') return '4'
  if (preference === 'AVOID_TOLL') return '1'
  if (preference === 'NORMAL_ROAD_FIRST') return '2'
  return '0'
}

function ensureKey(): AMapServiceError | null {
  return getAmapKey() ? null : { code: 'NO_KEY', message: '未配置 VITE_AMAP_KEY，无法调用高德 API。' }
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

async function requestInputTips(
  query: InputTipsQuery,
  signal?: AbortSignal,
): Promise<{ tips: AMapPlaceSuggestion[]; error: AMapServiceError | null }> {
  const url = new URL('/api/amap/inputtips', window.location.origin)
  url.searchParams.set('keywords', query.keywords)
  if (query.type) url.searchParams.set('type', query.type)
  if (query.city) url.searchParams.set('city', query.city)
  if (typeof query.citylimit === 'boolean') {
    url.searchParams.set('citylimit', query.citylimit ? 'true' : 'false')
  }

  let raw: unknown = null

  try {
    const response = await fetch(`${url.pathname}${url.search}`, { signal })
    raw = await response.json()
    const payload = (raw ?? {}) as Record<string, unknown>

    const status = toStringOrEmpty(payload.status)
    const info = toStringOrEmpty(payload.info)
    const infocode = toStringOrEmpty(payload.infocode)
    const rawTips = payload.tips

    if (!response.ok || status !== '1' || !Array.isArray(rawTips)) {
      return {
        tips: [],
        error: {
          code: infocode || String(response.status),
          message: info || '联想服务暂不可用，点击重试。',
        },
      }
    }

    const normalizedTips = rawTips.map((item) => normalizeRawTip(item))

    const sourceType: AMapPlaceSuggestion['sourceType'] = query.type === 'city' ? 'city' : 'poi'
    const tips = normalizedTips
      .map((item) => normalizeTip(item, sourceType))
      .filter((item): item is AMapPlaceSuggestion => Boolean(item))

    return { tips, error: null }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return { tips: [], error: null }
    if (import.meta.env.DEV) {
      console.error('InputTips raw response', raw)
      console.error(error)
    }
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
    type: 'city',
    city: query.city,
    citylimit: query.citylimit,
  }

  const poiQuery: InputTipsQuery = {
    keywords: q,
    city: query.city,
    citylimit: query.citylimit,
  }

  const [cityResp, poiResp] = await Promise.all([requestInputTips(cityQuery, signal), requestInputTips(poiQuery, signal)])

  let fallbackPoi: AMapPlaceSuggestion[] = []
  if (query.citylimit && poiResp.tips.length <= 2) {
    const fallbackResp = await requestInputTips({ keywords: q, citylimit: false }, signal)
    fallbackPoi = fallbackResp.tips.map((item) => ({ ...item, sourceType: 'fallback-poi', isOutOfScope: true }))
  }

  const merged = dedupeTips([...cityResp.tips, ...poiResp.tips, ...fallbackPoi])
  const firstError = cityResp.error ?? poiResp.error
  return { tips: merged, error: firstError }
}

async function planDrivingRouteRaw(
  points: DrivingRequestPoint[],
  preference: RoutePreference,
  routeKey: string,
): Promise<{ route: DrivingRouteResult | null; error: AMapServiceError | null }> {
  const keyError = ensureKey()
  if (keyError) return { route: null, error: keyError }
  if (points.length < 2) return { route: null, error: { code: 'POINTS_NOT_ENOUGH', message: '路径规划至少需要起点和终点。' } }

  const url = new URL(AMAP_DRIVING_URL)
  url.searchParams.set('key', getAmapKey())
  url.searchParams.set('origin', toLonLatText(points[0]))
  url.searchParams.set('destination', toLonLatText(points[points.length - 1]))
  if (points.length > 2) {
    const waypoints = points.slice(1, -1).map(toLonLatText).join(';')
    if (waypoints) url.searchParams.set('waypoints', waypoints)
  }
  url.searchParams.set('strategy', preferenceToStrategy(preference))
  url.searchParams.set('extensions', 'base')

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      return {
        route: null,
        error: { code: String(response.status), message: `高德驾车规划失败（HTTP ${response.status}）。` },
      }
    }

    const data = (await response.json()) as {
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

    if (data.status !== '1') {
      return {
        route: null,
        error: { code: data.infocode, message: `高德驾车规划失败：${data.info ?? '未知错误'}` },
      }
    }

    const path = data.route?.paths?.[0]
    if (!path) {
      return { route: null, error: { code: 'NO_PATH', message: '高德未返回可用路线。' } }
    }

    const pointsList: Array<[number, number]> = []
    for (const step of path.steps ?? []) {
      if (!step.polyline) continue
      for (const rawPair of step.polyline.split(';')) {
        const parsed = parseLocationText(rawPair)
        if (parsed) pointsList.push([parsed.lat, parsed.lng])
      }
    }

    if (!pointsList.length) {
      return { route: null, error: { code: 'EMPTY_POLYLINE', message: '高德返回路线为空。' } }
    }

    const result: DrivingRouteResult = {
      polyline: pointsList,
      distanceText: path.distance ? `${path.distance} 米` : '未知',
      durationText: path.duration ? `${path.duration} 秒` : '未知',
      routeKey,
    }

    return { route: result, error: null }
  } catch {
    return {
      route: null,
      error: { message: '高德驾车规划请求失败，请检查网络或稍后重试。' },
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

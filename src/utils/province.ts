import type {
  RoadProvinceSource,
  RoadProvinceStatus,
  RouteRoadPart,
} from '../types/roadStatistics.ts'

/** 只保留省级行政区代码；城市/区县 adcode 会折算到前两位省级代码。 */
export const PROVINCE_NAME_BY_CODE: Readonly<Record<string, string>> = {
  '110000': '北京',
  '120000': '天津',
  '130000': '河北',
  '140000': '山西',
  '150000': '内蒙古',
  '210000': '辽宁',
  '220000': '吉林',
  '230000': '黑龙江',
  '310000': '上海',
  '320000': '江苏',
  '330000': '浙江',
  '340000': '安徽',
  '350000': '福建',
  '360000': '江西',
  '370000': '山东',
  '410000': '河南',
  '420000': '湖北',
  '430000': '湖南',
  '440000': '广东',
  '450000': '广西',
  '460000': '海南',
  '500000': '重庆',
  '510000': '四川',
  '520000': '贵州',
  '530000': '云南',
  '540000': '西藏',
  '610000': '陕西',
  '620000': '甘肃',
  '630000': '青海',
  '640000': '宁夏',
  '650000': '新疆',
  '710000': '台湾',
  '810000': '香港',
  '820000': '澳门',
}

export const PROVINCE_OPTIONS = Object.entries(PROVINCE_NAME_BY_CODE)
  .map(([code, name]) => ({ code, name }))

const PROVINCE_CODE_BY_NAME = new Map<string, string>([
  ...Object.entries(PROVINCE_NAME_BY_CODE).map(([code, name]) => [name, code] as const),
  ...Object.entries(PROVINCE_NAME_BY_CODE).map(([code, name]) => [`${name}省`, code] as const),
  ...Object.entries(PROVINCE_NAME_BY_CODE).map(([code, name]) => [`${name}市`, code] as const),
  ...Object.entries(PROVINCE_NAME_BY_CODE).map(([code, name]) => [`${name}自治区`, code] as const),
])

export type ProvinceEvidence = {
  adcodes?: readonly unknown[]
  names?: readonly unknown[]
}

export interface ProvinceResolution {
  provinceCode?: string
  provinceName?: string
  provinceSource: RoadProvinceSource
  provinceStatus: RoadProvinceStatus
  provinceCandidates?: string[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 将 6 位行政区编码折算为省级代码；不接受 citycode 之类的非 adcode。 */
export function provinceCodeFromAdcode(value: unknown): string | undefined {
  const text = normalizeText(value)
  if (!/^\d{6}$/.test(text)) return undefined
  const provinceCode = `${text.slice(0, 2)}0000`
  return PROVINCE_NAME_BY_CODE[provinceCode] ? provinceCode : undefined
}

export function normalizeProvinceCode(value: unknown): string | undefined {
  const text = normalizeText(value)
  if (PROVINCE_NAME_BY_CODE[text]) return text
  const fromAdcode = provinceCodeFromAdcode(text)
  if (fromAdcode) return fromAdcode
  return PROVINCE_CODE_BY_NAME.get(text)
}

export function provinceNameFromCode(value: unknown): string | undefined {
  const code = normalizeProvinceCode(value)
  return code ? PROVINCE_NAME_BY_CODE[code] : undefined
}

export function isProvinceSensitiveRoadPart(part: Pick<RouteRoadPart, 'roadClass' | 'routeRef'>): boolean {
  const routeRef = normalizeText(part.routeRef).toUpperCase()
  return part.roadClass === 'PROVINCIAL_ROAD'
    || (part.roadClass === 'EXPRESSWAY' && /^S\d{1,4}$/.test(routeRef))
}

export function resolveProvinceEvidence(
  evidence: ProvinceEvidence,
  source: RoadProvinceSource,
): ProvinceResolution {
  const codes = new Set<string>()
  for (const value of evidence.adcodes ?? []) {
    const code = normalizeProvinceCode(value)
    if (code) codes.add(code)
  }
  for (const value of evidence.names ?? []) {
    const code = normalizeProvinceCode(value)
    if (code) codes.add(code)
  }

  const provinceCandidates = [...codes].sort()
  if (provinceCandidates.length === 1) {
    const provinceCode = provinceCandidates[0]
    return {
      provinceCode,
      provinceName: PROVINCE_NAME_BY_CODE[provinceCode],
      provinceSource: source,
      provinceStatus: 'confirmed',
    }
  }

  return {
    provinceSource: source,
    provinceStatus: 'pending',
    ...(provinceCandidates.length ? { provinceCandidates } : {}),
  }
}

export function pendingProvinceResolution(
  source: RoadProvinceSource = 'UNKNOWN',
  candidates?: readonly string[],
): ProvinceResolution {
  const provinceCandidates = [...new Set((candidates ?? []).map(normalizeProvinceCode).filter(Boolean) as string[])].sort()
  return {
    provinceSource: source,
    provinceStatus: 'pending',
    ...(provinceCandidates.length ? { provinceCandidates } : {}),
  }
}

export function applyProvinceResolution<T extends Pick<RouteRoadPart, 'roadClass' | 'routeRef'>>(
  part: T,
  resolution: ProvinceResolution,
): T & ProvinceResolution {
  const next = { ...part, ...resolution }
  if (resolution.provinceStatus === 'pending' && !resolution.provinceCode) {
    delete (next as Partial<RouteRoadPart>).provinceCode
    delete (next as Partial<RouteRoadPart>).provinceName
  }
  if (!isProvinceSensitiveRoadPart(part)) {
    delete (next as Partial<RouteRoadPart>).provinceCode
    delete (next as Partial<RouteRoadPart>).provinceName
    delete (next as Partial<RouteRoadPart>).provinceSource
    delete (next as Partial<RouteRoadPart>).provinceStatus
    delete (next as Partial<RouteRoadPart>).provinceCandidates
  }
  return next
}

/** 从高德 step 的 cities/districts/adcode 等嵌套结构中收集行政区证据。 */
export function collectProvinceEvidence(value: unknown): ProvinceEvidence {
  const adcodes: unknown[] = []
  const names: unknown[] = []
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!current || typeof current !== 'object') return
    const record = current as Record<string, unknown>
    if (record.adcode !== undefined) adcodes.push(record.adcode)
    for (const key of ['province', 'provinceName', 'name']) {
      if (record[key] !== undefined) names.push(record[key])
    }
    for (const key of ['cities', 'districts', 'city', 'district', 'addressComponent']) {
      if (record[key] !== undefined) visit(record[key])
    }
  }
  visit(value)
  return { adcodes, names }
}

export function provinceLabel(part: Pick<RouteRoadPart, 'provinceName' | 'provinceCode' | 'provinceStatus'>): string {
  if (part.provinceStatus !== 'confirmed') return '省份待确认'
  return part.provinceName || provinceNameFromCode(part.provinceCode) || part.provinceCode || '省份待确认'
}

import type { Trip } from '../types/trip.ts'
import type { LinkedPhotoRecord } from '../types/photo.ts'
import type { RouteCacheRecord } from '../services/routeCacheDb.ts'
import { hasCurrentRoadAnalysis } from './routeBuildKey.ts'
import { roadMembershipParts } from './roadMemberships.ts'

export interface SearchTarget {
  tripId: string
  dayId: string
  segmentId: string
  photoId?: string
  waypointId?: string
}
interface SearchField { label: string; value: string; normalized: string; waypointId?: string }
export interface SearchRecord {
  id: string
  kind: 'trip' | 'day' | 'segment' | 'photo'
  title: string
  context: string
  category: Trip['category']
  target: SearchTarget
  fields: SearchField[]
}
export interface SearchResult extends SearchRecord { reasons: SearchField[]; score: number }
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/([gsxyzc])[-－]?(\d)/g, '$1$2')
const field = (label: string, value?: string, waypointId?: string): SearchField => ({ label, value: value ?? '', normalized: normalize(value ?? ''), waypointId })

/** 只索引记录与有效缓存；照片必须同时属于路段且仍被引用。 */
export function buildGlobalSearchIndex(trips: readonly Trip[], caches: readonly RouteCacheRecord[], photos: readonly LinkedPhotoRecord[]): SearchRecord[] {
  const cacheById = new Map(caches.map(cache => [cache.segmentId, cache]))
  const photoById = new Map(photos.map(photo => [photo.id, photo]))
  const records: SearchRecord[] = []
  for (const trip of trips) {
    const tripFields = [field('旅程', trip.title), field('开始日期', trip.startDate), field('结束日期', trip.endDate)]
    const target = { tripId: trip.id, dayId: '', segmentId: '' }
    records.push({ id: `trip:${trip.id}`, kind: 'trip', title: trip.title, context: `${trip.startDate} ～ ${trip.endDate}`,
      category: trip.category, target, fields: [...tripFields, field('游记', trip.travelogue)] })
    for (const day of trip.days) {
      const dayTarget = { ...target, dayId: day.id }
      const context = `${trip.title} · ${day.date}`
      const inherited = [field('旅程', trip.title), field('日期', day.date)]
      records.push({ id: `day:${day.id}`, kind: 'day', title: day.date || '日期待填写', context: trip.title,
        category: trip.category, target: dayTarget, fields: [field('日期', day.date)] })
      for (const segment of day.routeSegments) {
        const segmentTarget = { ...dayTarget, segmentId: segment.id }
        const fields = [...inherited, field('路段', segment.name), field('起点', segment.startPoint), field('终点', segment.endPoint),
          field('路段备注', segment.note), field('途经点', segment.viaPointsText),
          ...(segment.waypoints ?? []).map(point => field('途经点', point.name, point.id))]
        const cache = cacheById.get(segment.id)
        if (cache && hasCurrentRoadAnalysis(segment, cache)) {
          for (const part of cache.roadParts) {
            for (const road of roadMembershipParts(part)) {
              fields.push(field('道路编号', road.routeRef), field('道路名称', road.roadName), field('道路方向', road.manualDirection))
            }
          }
        }
        records.push({ id: `segment:${segment.id}`, kind: 'segment', title: segment.name || `${segment.startPoint} → ${segment.endPoint}`,
          context, category: trip.category, target: segmentTarget, fields: fields.filter(item => item.value) })
        for (const id of new Set(segment.photoIds ?? [])) {
          const photo = photoById.get(id)
          if (!photo || photo.segmentId !== segment.id) continue
          records.push({ id: `photo:${id}`, kind: 'photo', title: photo.originalFilename, context: `${context} · ${segment.name}`,
            category: trip.category, target: { ...segmentTarget, photoId: id },
            fields: [field('照片文件名', photo.originalFilename), field('照片备注', photo.note), field('拍摄时间', photo.capturedAt)] })
        }
      }
    }
  }
  return records
}

export function searchGlobalRecords(index: readonly SearchRecord[], query: string): SearchResult[] {
  const tokens = [...new Set(normalize(query.trim()).split(/\s+/).filter(Boolean))]
  if (!tokens.length) return []
  const results: SearchResult[] = []
  for (const record of index) {
    if (!tokens.every(token => record.fields.some(item => item.normalized.includes(token)))) continue
    const reasons = record.fields.filter(item => tokens.some(token => item.normalized.includes(token)))
      .filter((item, i, items) => items.findIndex(other => other.label === item.label && other.value === item.value) === i)
    const exact = reasons.some(item => item.normalized === tokens.join(' '))
    results.push({ ...record, target: { ...record.target, waypointId: reasons.find(item => item.waypointId)?.waypointId },
      reasons: reasons.map(item => {
        if (item.value.length <= 180) return item
        const match = Math.min(...tokens.map(token => item.normalized.indexOf(token)).filter(position => position >= 0))
        const start = Math.max(0, match - 50)
        return { ...item, value: `${start ? '…' : ''}${item.value.slice(start, start + 180)}${start + 180 < item.value.length ? '…' : ''}` }
      }), score: (exact ? 10 : 0) + (record.kind === 'trip' ? 4 : record.kind === 'photo' ? 2 : 0) })
  }
  return results.sort((a, b) => b.score - a.score || a.context.localeCompare(b.context, 'zh-CN') || a.id.localeCompare(b.id))
}

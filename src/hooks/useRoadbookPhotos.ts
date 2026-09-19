import { useEffect, useMemo, useState } from 'react'
import { electronPhotoMetadataRepository } from '../services/electronPhotoMetadataRepository'
import { electronPhotoRepository } from '../services/electronPhotoRepository'
import type { LinkedPhotoRecord } from '../types/photo'
import type { Trip } from '../types/trip'

/**
 * 路书浏览模式下的照片元数据加载：
 * 只读取照片索引（元数据），不加载任何原图；
 * 缩略图仍由组件内的 IntersectionObserver 按需加载。
 * 浏览器开发版没有桌面照片接口时自动降级为空数据。
 */
export function useRoadbookPhotos(trip: Trip | null) {
  const desktopAvailable = Boolean(window.roadtripDesktop?.photoLibrary)
  const segmentIds = useMemo(
    () => (trip ? trip.days.flatMap((day) => day.routeSegments.map((segment) => segment.id)) : []),
    [trip],
  )
  const [photosBySegment, setPhotosBySegment] = useState<Map<string, LinkedPhotoRecord[]>>(new Map())

  useEffect(() => {
    if (!trip || !desktopAvailable || segmentIds.length === 0) {
      setPhotosBySegment(new Map())
      return
    }
    let cancelled = false

    async function loadPhotos() {
      const groups = await Promise.all(
        segmentIds.map((segmentId) =>
          electronPhotoMetadataRepository.listPhotosBySegment(segmentId).catch(() => [] as LinkedPhotoRecord[]),
        ),
      )
      if (cancelled) return
      const next = new Map<string, LinkedPhotoRecord[]>()
      groups.forEach((records, index) => {
        const sorted = records.sort((left, right) =>
          (left.capturedAt ?? left.importedAt).localeCompare(right.capturedAt ?? right.importedAt),
        )
        if (sorted.length > 0) next.set(segmentIds[index], sorted)
      })
      setPhotosBySegment(next)
    }

    void loadPhotos()
    return () => {
      cancelled = true
    }
  }, [desktopAvailable, segmentIds, trip])

  const allPhotos = useMemo(() => {
    const records: LinkedPhotoRecord[] = []
    for (const segmentId of segmentIds) {
      records.push(...(photosBySegment.get(segmentId) ?? []))
    }
    return records
  }, [photosBySegment, segmentIds])

  return { photosBySegment, allPhotos, desktopAvailable }
}

/**
 * 书架封面：按旅程解析封面照片记录。
 * 规则：手动 coverPhotoId 优先；缺失或不再属于该旅程时，
 * 回退到旅程中按顺序找到的第一张有效照片；都没有时返回 undefined（显示渐变封面）。
 * 只读取照片索引元数据，缩略图由 RoadbookCoverImage 按需加载。
 */
export function useRoadbookLibraryPhotos(trips: Trip[]) {
  const desktopAvailable = Boolean(window.roadtripDesktop?.photoLibrary)
  const [coverByTrip, setCoverByTrip] = useState<Map<string, LinkedPhotoRecord>>(new Map())

  useEffect(() => {
    if (!desktopAvailable) {
      setCoverByTrip(new Map())
      return
    }
    let cancelled = false

    async function loadCovers() {
      const allPhotos = await electronPhotoRepository.listPhotos().catch(() => [] as LinkedPhotoRecord[])
      if (cancelled) return
      const photoById = new Map(allPhotos.map((photo) => [photo.id, photo]))
      const segmentIdsByTrip = new Map(
        trips.map((trip) => [
          trip.id,
          new Set(trip.days.flatMap((day) => day.routeSegments.map((segment) => segment.id))),
        ]),
      )
      const next = new Map<string, LinkedPhotoRecord>()

      for (const trip of trips) {
        const ownSegmentIds = segmentIdsByTrip.get(trip.id)
        let candidate: LinkedPhotoRecord | undefined = trip.coverPhotoId
          ? photoById.get(trip.coverPhotoId)
          : undefined
        if (candidate && !ownSegmentIds?.has(candidate.segmentId)) candidate = undefined

        if (!candidate) {
          for (const day of trip.days) {
            for (const segment of day.routeSegments) {
              for (const photoId of segment.photoIds ?? []) {
                const record = photoById.get(photoId)
                if (record && ownSegmentIds?.has(record.segmentId)) {
                  candidate = record
                  break
                }
              }
              if (candidate) break
            }
            if (candidate) break
          }
        }
        if (candidate) next.set(trip.id, candidate)
      }
      setCoverByTrip(next)
    }

    void loadCovers()
    return () => {
      cancelled = true
    }
  }, [desktopAvailable, trips])

  return { coverByTrip, desktopAvailable }
}

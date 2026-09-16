import { useEffect, useMemo, useRef, useState } from 'react'
import { planCyclingRoute, planDrivingRoute, searchAmapInputTips } from '../../services/amap'
import { getSegmentRouteCache } from '../../services/routeCacheDb'
import type { RouteSegment } from '../../types/trip'
import {
  buildSegmentRouteKey,
  canDisplaySegmentRouteCache,
  canReuseRecordedRoute,
  hasCurrentRoadAnalysis,
} from '../../utils/routeBuildKey'
import { hasCurrentDurationEstimate } from '../../utils/durations'
import { hasCurrentTollEstimate } from '../../utils/tolls'
import { getUnresolvedNamedWaypoints, hasResolvedWaypointCoordinate } from '../../utils/waypointValidation'
import { buildResolvedRoutePatch } from './resolvedRoutePatch'
import { fallbackLineFromPoints } from './trackUtils'
import type { PointKind, ResolvedRoutePatch, RouteRefreshRequest, SegmentRouteDescriptor, SegmentTrack } from './types'

interface UseMapTracksParams {
  filteredSegments: RouteSegment[]
  allowAutoBuild: boolean
  isReadonlyMode: boolean
  onRouteResolved: (patches: ResolvedRoutePatch[]) => void
  routeServiceRevision: number
  routeRefreshRequest: RouteRefreshRequest
}

async function resolvePointByName(placeName: string): Promise<{ lat: number; lon: number } | null> {
  const { tips } = await searchAmapInputTips({ keywords: placeName, citylimit: false })
  const first = tips[0]
  if (!first) return null
  return { lat: first.lat, lon: first.lng }
}

export function useMapTracks({
  filteredSegments,
  allowAutoBuild,
  isReadonlyMode,
  onRouteResolved,
  routeServiceRevision,
  routeRefreshRequest,
}: UseMapTracksParams) {
  const [tracks, setTracks] = useState<SegmentTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('请选择旅程/日期/路段以查看轨迹')
  const buildRunIdRef = useRef(0)
  const handledRefreshRevisionRef = useRef(0)

  const segmentDescriptors = useMemo<SegmentRouteDescriptor[]>(
    () =>
      filteredSegments.map((segment) => ({
        segment,
        buildKey: buildSegmentRouteKey(segment),
        canReusePersisted: canReuseRecordedRoute(segment),
      })),
    [filteredSegments],
  )

  const routeBuildKey = useMemo(
    () => segmentDescriptors.map((item) => `${item.segment.id}:${item.buildKey}`).join('||'),
    [segmentDescriptors],
  )

  useEffect(() => {
    let active = true
    const runId = ++buildRunIdRef.current

    async function buildTracks() {
      if (!segmentDescriptors.length) {
        setTracks([])
        setLoading(false)
        setMessage('请选择旅程/日期/路段以查看轨迹')
        return
      }

      const shouldPlanMissing = allowAutoBuild && !isReadonlyMode
      const pendingRefresh = routeRefreshRequest.revision > handledRefreshRevisionRef.current
        ? routeRefreshRequest
        : null
      if (pendingRefresh) handledRefreshRevisionRef.current = pendingRefresh.revision
      setLoading(shouldPlanMissing)
      setMessage(shouldPlanMissing ? '正在按需加载路线...' : '当前为全局视图，仅展示已缓存轨迹。')

      const warnings: string[] = []
      const patches: ResolvedRoutePatch[] = []
      const partialTracks: Array<SegmentTrack | null> = new Array(segmentDescriptors.length).fill(null)

      const tasks = segmentDescriptors.map(({ segment, buildKey, canReusePersisted }, index) =>
        (async () => {
          const startName = segment.startPoint
          const endName = segment.endPoint
          let startCoord = segment.startCoord
          let endCoord = segment.endCoord

          const resolvedWaypoints = (segment.waypoints ?? []).filter(hasResolvedWaypointCoordinate)
          const unresolvedWaypoints = getUnresolvedNamedWaypoints(segment.waypoints)
          if (unresolvedWaypoints.length > 0) {
            const names = unresolvedWaypoints.map((waypoint) => waypoint.name.trim()).join('、')
            warnings.push(
              `路段“${segment.name}”有 ${unresolvedWaypoints.length} 个途经点尚未解析坐标（${names}），已停止路线计算。`,
            )
            return
          }

          const markerPoints: Array<{ name: string; lat: number; lon: number; type: PointKind }> = []
          if (startCoord) markerPoints.push({ name: startName, lat: startCoord.lat, lon: startCoord.lon, type: 'start' })
          for (const waypoint of resolvedWaypoints) {
            markerPoints.push({ name: waypoint.name, lat: waypoint.lat, lon: waypoint.lng, type: 'via' })
          }
          if (endCoord) markerPoints.push({ name: endName, lat: endCoord.lat, lon: endCoord.lon, type: 'end' })

          const routeType = segment.routeType ?? 'DRIVING'
          const forceRefresh = pendingRefresh?.segmentId === segment.id
          const needsTollEstimate = routeType === 'DRIVING' && !hasCurrentTollEstimate(segment)
          const needsDurationEstimate = !hasCurrentDurationEstimate(segment)

          // 已记录路线（几何与当前起终点/途经点/偏好匹配）是用户的原始记录，
          // 缺少时长/过路费估算时也绝不自动重算覆盖；估算仅可通过手动“刷新路线估算”更新。
          if (canReusePersisted && segment.points && !forceRefresh) {
            const cache = await getSegmentRouteCache(segment.id)
            const currentRoadParts = cache && hasCurrentRoadAnalysis(segment, cache)
              ? cache.roadParts
              : undefined
            if (needsTollEstimate || needsDurationEstimate) {
              warnings.push(
                `路段「${segment.name}」已保留已记录路线；时长/过路费估算待计算，可点击“刷新路线估算”更新。`,
              )
            }
            partialTracks[index] = {
              segmentId: segment.id,
              segmentName: segment.name,
              points: markerPoints,
              line: segment.points,
              ...(currentRoadParts ? { roadParts: currentRoadParts, roadAnalysis: cache?.roadAnalysis } : {}),
              ...(typeof cache?.distanceMeters === 'number'
                ? { distanceMeters: cache.distanceMeters }
                : typeof segment.distanceMeters === 'number'
                  ? { distanceMeters: segment.distanceMeters }
                  : {}),
            }
            return
          }

          // IndexedDB 兜底：内存点数缺失（应用启动时 hydration 尚未完成、或全局/只读
          // 视图）时，先从持久缓存读取已记录几何；只要缓存存在且与当前路线输入匹配，
          // 就绝不自动重算覆盖。仅当既无内存点数也无持久缓存时才允许自动规划。
          if (!forceRefresh && !segment.points?.length) {
            const cache = await getSegmentRouteCache(segment.id)
            if (cache && cache.points.length && canDisplaySegmentRouteCache(segment, cache.routeBuildKey)) {
              if (needsTollEstimate || needsDurationEstimate) {
                warnings.push(
                  `路段「${segment.name}」已保留已记录路线；时长/过路费估算待计算，可点击“刷新路线估算”更新。`,
                )
              }
              partialTracks[index] = {
                segmentId: segment.id,
                segmentName: segment.name,
                points: markerPoints,
                line: cache.points,
                ...(hasCurrentRoadAnalysis(segment, cache)
                  ? { roadParts: cache.roadParts, roadAnalysis: cache.roadAnalysis }
                  : {}),
                ...(typeof cache.distanceMeters === 'number'
                  ? { distanceMeters: cache.distanceMeters }
                  : typeof segment.distanceMeters === 'number'
                    ? { distanceMeters: segment.distanceMeters }
                    : {}),
              }
              return
            }
          }

          if (!shouldPlanMissing) {
            if (segment.points?.length) {
              partialTracks[index] = {
                segmentId: segment.id,
                segmentName: segment.name,
                points: markerPoints,
                line: segment.points,
              }
              if (!canReusePersisted) warnings.push(`路段「${segment.name}」的缓存轨迹待更新。`)
              return
            }
            warnings.push(`路段「${segment.name}」暂无缓存轨迹。`)
            return
          }

          if (!startCoord && startName) {
            const resolved = await resolvePointByName(startName)
            if (resolved) startCoord = resolved
          }
          if (!endCoord && endName) {
            const resolved = await resolvePointByName(endName)
            if (resolved) endCoord = resolved
          }

          const planningPoints: Array<{ lat: number; lng: number }> = []
          if (startCoord) planningPoints.push({ lat: startCoord.lat, lng: startCoord.lon })
          for (const waypoint of resolvedWaypoints) planningPoints.push({ lat: waypoint.lat, lng: waypoint.lng })
          if (endCoord) planningPoints.push({ lat: endCoord.lat, lng: endCoord.lon })

          if (planningPoints.length < 2) {
            warnings.push(`路段「${segment.name}」缺少可用起终点坐标，无法规划。`)
            return
          }

          const { route, error } =
            routeType === 'CYCLING'
              ? await planCyclingRoute(planningPoints, { forceRefresh })
              : await planDrivingRoute(planningPoints, segment.preference, { forceRefresh })

          if (!active || runId !== buildRunIdRef.current) return

          let line = fallbackLineFromPoints(planningPoints.map((point) => ({ lat: point.lat, lon: point.lng })))
          let resolvedPatch: ResolvedRoutePatch | null = null
          if (route?.polyline?.length) {
            const patch = buildResolvedRoutePatch({
              segmentId: segment.id,
              routeBuildKey: buildKey,
              routeType,
              route,
            })
            line = patch.points
            patches.push(patch)
            resolvedPatch = patch
          } else {
            const reason = error?.message ?? '未知错误'
            warnings.push(`路段「${segment.name}」规划失败：${reason}。`)
            if (canReusePersisted && segment.points) line = segment.points
          }

          partialTracks[index] = {
            segmentId: segment.id,
            segmentName: segment.name,
            points: [
              { name: startName, lat: planningPoints[0].lat, lon: planningPoints[0].lng, type: 'start' },
              ...resolvedWaypoints.map((waypoint) => ({
                name: waypoint.name,
                lat: waypoint.lat,
                lon: waypoint.lng,
                type: 'via' as const,
              })),
              {
                name: endName,
                lat: planningPoints[planningPoints.length - 1].lat,
                lon: planningPoints[planningPoints.length - 1].lng,
                type: 'end',
              },
            ],
            line,
            ...(resolvedPatch?.roadParts
              ? { roadParts: resolvedPatch.roadParts, roadAnalysis: resolvedPatch.roadAnalysis }
              : {}),
            ...(typeof resolvedPatch?.distanceMeters === 'number'
              ? { distanceMeters: resolvedPatch.distanceMeters }
              : typeof segment.distanceMeters === 'number'
                ? { distanceMeters: segment.distanceMeters }
                : {}),
          }
        })(),
      )

      await Promise.allSettled(tasks)
      if (!active || runId !== buildRunIdRef.current) return

      const finalTracks = partialTracks.filter((track): track is SegmentTrack => Boolean(track))
      setTracks(finalTracks)
      setLoading(false)

      if (patches.length) onRouteResolved(patches)

      if (!finalTracks.length) {
        setMessage('未解析出可展示路线，请检查起终点、途经点或进入更细粒度视图。')
        return
      }

      setMessage(warnings.length ? warnings.join(' ') : shouldPlanMissing ? '已加载路线。' : '已展示缓存轨迹。')
    }

    void buildTracks()
    return () => {
      active = false
    }
  }, [
    routeBuildKey,
    segmentDescriptors,
    allowAutoBuild,
    isReadonlyMode,
    onRouteResolved,
    routeServiceRevision,
    routeRefreshRequest,
  ])

  return { tracks, loading, message }
}

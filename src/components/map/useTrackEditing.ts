import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CoordPoint } from '../../types/trip'
import { downsampleLine, OVERVIEW_MAX_POINTS_PER_SEGMENT } from './trackUtils'
import type { EditMode, SegmentTrack, TrackSavePayload } from './types'

const CONTROL_POINT_STEP = 25
const CONTROL_POINT_MAX = 16

interface UseTrackEditingParams {
  tracks: SegmentTrack[]
  editingSegmentId: string | null
  isOverviewMode: boolean
  onCancelEdit: () => void
  onSaveEdit: (payload: TrackSavePayload) => void
}

export function useTrackEditing({
  tracks,
  editingSegmentId,
  isOverviewMode,
  onCancelEdit,
  onSaveEdit,
}: UseTrackEditingParams) {
  const [editMode, setEditMode] = useState<EditMode>('start')
  const [draftLine, setDraftLine] = useState<CoordPoint[] | null>(null)
  const [originalLine, setOriginalLine] = useState<CoordPoint[] | null>(null)

  const editingTrack = useMemo(
    () => (editingSegmentId ? tracks.find((track) => track.segmentId === editingSegmentId) ?? null : null),
    [tracks, editingSegmentId],
  )

  useEffect(() => {
    if (!editingTrack) {
      setDraftLine(null)
      setOriginalLine(null)
      setEditMode('start')
      return
    }

    if (!draftLine) {
      const cloned = editingTrack.line.map((point) => ({ ...point }))
      setDraftLine(cloned)
      setOriginalLine(cloned.map((point) => ({ ...point })))
    }
  }, [editingTrack, draftLine])

  const displayedTracks = useMemo(() => {
    if (!editingTrack || !draftLine) return tracks

    return tracks.map((track) => {
      if (track.segmentId !== editingTrack.segmentId) return track

      const mutablePoints = track.points.map((point) => {
        if (!draftLine.length) return point
        if (point.type === 'start') return { ...point, lat: draftLine[0].lat, lon: draftLine[0].lon }
        if (point.type === 'end') {
          const end = draftLine[draftLine.length - 1]
          return { ...point, lat: end.lat, lon: end.lon }
        }
        return point
      })

      return {
        ...track,
        line: draftLine,
        points: mutablePoints,
        // 手动编辑一开始，旧道路片段的几何便不再与草稿一致；编辑期间回退为整条草稿线。
        roadParts: undefined,
        roadAnalysis: undefined,
      }
    })
  }, [tracks, editingTrack, draftLine])

  const renderedTracks = useMemo(
    () =>
      displayedTracks.map((track) => ({
        ...track,
        line: isOverviewMode ? downsampleLine(track.line, OVERVIEW_MAX_POINTS_PER_SEGMENT) : track.line,
      })),
    [displayedTracks, isOverviewMode],
  )

  const controlPointIndices = useMemo(() => {
    if (!draftLine || draftLine.length <= 2 || editMode !== 'track') return []

    const indices: number[] = []
    for (let index = 1; index < draftLine.length - 1; index += CONTROL_POINT_STEP) {
      indices.push(index)
      if (indices.length >= CONTROL_POINT_MAX) break
    }

    if (!indices.length) indices.push(Math.floor(draftLine.length / 2))
    return indices
  }, [draftLine, editMode])

  const cancelEdit = useCallback(() => {
    if (originalLine) setDraftLine(originalLine.map((point) => ({ ...point })))
    onCancelEdit()
  }, [onCancelEdit, originalLine])

  const saveEdit = useCallback(() => {
    if (!editingTrack || !draftLine || draftLine.length < 2) return

    onSaveEdit({
      segmentId: editingTrack.segmentId,
      startCoord: { lat: draftLine[0].lat, lon: draftLine[0].lon },
      endCoord: {
        lat: draftLine[draftLine.length - 1].lat,
        lon: draftLine[draftLine.length - 1].lon,
      },
      points: draftLine,
    })
    setDraftLine(null)
    setOriginalLine(null)
  }, [draftLine, editingTrack, onSaveEdit])

  return {
    editMode,
    setEditMode,
    draftLine,
    setDraftLine,
    renderedTracks,
    controlPointIndices,
    cancelEdit,
    saveEdit,
  }
}

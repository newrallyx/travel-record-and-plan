import { useCallback } from 'react'
import type { RouteSegment } from '../../types/trip'
import MapPanel from '../MapPanel'
import type { ResolvedRoutePatch, TrackSavePayload } from '../map/types'
import { DEFAULT_ROAD_TYPE_VISIBILITY } from '../map/roadTypeVisualization'

interface RoadbookMapProps {
  segments: RouteSegment[]
}

/** 路书浏览模式的只读地图：所有回调均为空操作，保证不会误修改旅程。 */
function RoadbookMap({ segments }: RoadbookMapProps) {
  const ignoreRouteResolved = useCallback((_patches: ResolvedRoutePatch[]) => {}, [])
  const ignoreSaveTrack = useCallback((_payload: TrackSavePayload) => {}, [])
  const ignoreEvent = useCallback(() => {}, [])
  const ignoreAsync = useCallback(async () => {}, [])

  return (
    <MapPanel
      filteredSegments={segments}
      routeColorMode="default"
      roadTypeVisibility={DEFAULT_ROAD_TYPE_VISIBILITY}
      isOverviewMode
      editingSegmentId={null}
      onCancelEdit={ignoreEvent}
      onSaveEdit={ignoreSaveTrack}
      selectedWaypoint={null}
      photos={[]}
      selectedPhotoId={null}
      onSelectPhoto={ignoreEvent}
      photoPositionEditId={null}
      photoPositionEditFilename=""
      photoPositionDraft={null}
      isSavingPhotoPosition={false}
      photoPositionError=""
      onPhotoPositionDraftChange={ignoreEvent}
      onSavePhotoPosition={ignoreAsync}
      onCancelPhotoPosition={ignoreEvent}
      onRouteResolved={ignoreRouteResolved}
      routeServiceRevision={0}
      routeRefreshRequest={{ segmentId: null, revision: 0 }}
      onRouteLoadingChange={ignoreEvent}
      allowAutoBuild={false}
      isReadonlyMode
      onEndpointDraftChange={ignoreEvent}
    />
  )
}

export default RoadbookMap

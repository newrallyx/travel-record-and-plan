import { useCallback, useMemo, useState } from 'react'
import type { RouteColorMode, RouteSegment, Trip } from '../../types/trip'
import MapPanel from '../MapPanel'
import type { ResolvedRoutePatch, TrackSavePayload } from '../map/types'
import { DEFAULT_ROAD_TYPE_VISIBILITY } from '../map/roadTypeVisualization'
import RouteColorControls from '../map/RouteColorControls'

interface RoadbookMapProps {
  segments: RouteSegment[]
  animateViewport?: boolean
  trips: readonly Trip[]
  selectedTripId?: string
  overviewYear?: string
  showScoreOptions?: boolean
}

/** 路书浏览模式的只读地图：所有回调均为空操作，保证不会误修改旅程。 */
function RoadbookMap({ segments, animateViewport, trips, selectedTripId, overviewYear, showScoreOptions = true }: RoadbookMapProps) {
  const [routeColorMode, setRouteColorMode] = useState<RouteColorMode>('default')
  const [roadTypeVisibility, setRoadTypeVisibility] = useState({ ...DEFAULT_ROAD_TYPE_VISIBILITY })
  const allTrips = useMemo(() => [...trips], [trips])
  const canUseScoreColoring = Boolean(selectedTripId)
  const activeColorMode = (!showScoreOptions || !canUseScoreColoring) && (routeColorMode === 'scenic' || routeColorMode === 'difficulty')
    ? 'default' : routeColorMode
  const ignoreRouteResolved = useCallback((_patches: ResolvedRoutePatch[]) => {}, [])
  const ignoreSaveTrack = useCallback((_payload: TrackSavePayload) => {}, [])
  const ignoreEvent = useCallback(() => {}, [])
  const ignoreAsync = useCallback(async () => {}, [])

  return (
    <>
    <RouteColorControls
      routeColorMode={activeColorMode}
      onChangeRouteColorMode={setRouteColorMode}
      roadTypeVisibility={roadTypeVisibility}
      onChangeRoadTypeVisibility={setRoadTypeVisibility}
      canUseScoreColoring={canUseScoreColoring}
      showScoreOptions={showScoreOptions}
    />
    <MapPanel
      filteredSegments={segments}
      routeColorMode={activeColorMode}
      roadTypeVisibility={roadTypeVisibility}
      allTrips={allTrips}
      selectedTripId={selectedTripId}
      overviewYear={overviewYear}
      isOverviewMode
      animateViewport={animateViewport}
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
    </>
  )
}

export default RoadbookMap

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { CoordPoint, RoutePreference, RouteType, Trip, Waypoint } from '../types/trip'
import { routePreferenceOptions } from '../utils/routePreference'
import { eachDayInRange } from '../utils/date'
import { AppIcon } from './icons'
import PlaceAutocomplete from './PlaceAutocomplete'
import SegmentScoreFields from './SegmentScoreFields'

interface TripEditorProps {
  trips: Trip[]
  isReadonlyMode: boolean
  selectedTripId: string
  selectedDayDate: string
  onAddTrip: (payload: { title: string; startDate: string; endDate: string }) => void
  onAddSegment: (payload: {
    tripId: string
    dayDate: string
    name: string
    startPoint: string
    endPoint: string
    waypoints: Waypoint[]
    preference: RoutePreference
    routeType: RouteType
    startCoord?: CoordPoint
    endCoord?: CoordPoint
    startPlaceId?: string
    endPlaceId?: string
    scenicScore?: number | null
    difficultyScore?: number | null
    note?: string
  }) => void
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

// 旅程编辑区：仅保留“新增旅程 / 为日期新增路段”，日期选项由旅程起止日期动态生成。
function TripEditor({
  trips,
  onAddTrip,
  onAddSegment,
  isReadonlyMode,
  selectedTripId,
  selectedDayDate,
}: TripEditorProps) {
  const [expandedPanel, setExpandedPanel] = useState<'trip' | 'segment' | null>(() => (trips.length === 0 ? 'trip' : null))
  const [creationMessage, setCreationMessage] = useState('')
  const [tripTitle, setTripTitle] = useState('')
  const [tripStartDate, setTripStartDate] = useState('')
  const [tripEndDate, setTripEndDate] = useState('')
  const [tripError, setTripError] = useState('')

  const [segmentTripId, setSegmentTripId] = useState('')
  const [segmentDayDate, setSegmentDayDate] = useState('')
  const [segmentName, setSegmentName] = useState('')
  const [segmentStartPoint, setSegmentStartPoint] = useState('')
  const [segmentEndPoint, setSegmentEndPoint] = useState('')
  const [segmentStartCoord, setSegmentStartCoord] = useState<CoordPoint | undefined>(undefined)
  const [segmentEndCoord, setSegmentEndCoord] = useState<CoordPoint | undefined>(undefined)
  const [segmentStartPlaceId, setSegmentStartPlaceId] = useState<string | undefined>(undefined)
  const [segmentEndPlaceId, setSegmentEndPlaceId] = useState<string | undefined>(undefined)
  const [segmentWaypoints, setSegmentWaypoints] = useState<Waypoint[]>([])
  const [segmentPreference, setSegmentPreference] = useState<RoutePreference>('HIGHWAY_FIRST')
  const [segmentRouteType, setSegmentRouteType] = useState<RouteType>('DRIVING')
  const [segmentScenicScore, setSegmentScenicScore] = useState<number | null>(null)
  const [segmentDifficultyScore, setSegmentDifficultyScore] = useState<number | null>(null)
  const [segmentNote, setSegmentNote] = useState('')
  const [segmentError, setSegmentError] = useState('')

  const toggleTripPanel = () => {
    setCreationMessage('')
    setExpandedPanel((current) => (current === 'trip' ? null : 'trip'))
  }

  const toggleSegmentPanel = () => {
    setCreationMessage('')
    if (expandedPanel === 'segment') {
      setExpandedPanel(null)
      return
    }

    const preferredTripId = selectedTripId && trips.some((trip) => trip.id === selectedTripId)
      ? selectedTripId
      : segmentTripId || trips[0]?.id || ''
    setSegmentTripId(preferredTripId)

    const preferredTrip = trips.find((trip) => trip.id === preferredTripId)
    const availableDates = preferredTrip ? eachDayInRange(preferredTrip.startDate, preferredTrip.endDate) : []
    setSegmentDayDate(availableDates.includes(selectedDayDate) ? selectedDayDate : availableDates[0] || '')
    setExpandedPanel('segment')
  }

  useEffect(() => {
    if (!segmentTripId) return
    if (!trips.some((trip) => trip.id === segmentTripId)) {
      setSegmentTripId('')
      setSegmentDayDate('')
    }
  }, [trips, segmentTripId])

  const dateOptions = useMemo(() => {
    const selectedTrip = trips.find((trip) => trip.id === segmentTripId)
    if (!selectedTrip) return []
    return eachDayInRange(selectedTrip.startDate, selectedTrip.endDate)
  }, [trips, segmentTripId])

  const handleAddTrip = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTripError('')

    if (!tripTitle.trim() || !tripStartDate || !tripEndDate) {
      setTripError('请填写旅程标题、开始日期、结束日期。')
      return
    }

    if (new Date(`${tripStartDate}T00:00:00`) > new Date(`${tripEndDate}T00:00:00`)) {
      setTripError('开始日期不能晚于结束日期。')
      return
    }

    onAddTrip({ title: tripTitle.trim(), startDate: tripStartDate, endDate: tripEndDate })
    setCreationMessage(`已创建旅程“${tripTitle.trim()}”，可在旅程筛选中查看。`)
    setExpandedPanel(null)
    setTripTitle('')
    setTripStartDate('')
    setTripEndDate('')
  }

  const handleAddSegment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSegmentError('')

    if (!segmentTripId) {
      setSegmentError('请先选择旅程')
      return
    }

    if (!segmentDayDate) {
      setSegmentError('请先选择日期。')
      return
    }

    if (!segmentName.trim() || !segmentStartPoint.trim() || !segmentEndPoint.trim()) {
      setSegmentError('请填写路段名称、起点、终点。')
      return
    }

    onAddSegment({
      tripId: segmentTripId,
      dayDate: segmentDayDate,
      name: segmentName.trim(),
      startPoint: segmentStartPoint.trim(),
      endPoint: segmentEndPoint.trim(),
      waypoints: segmentWaypoints,
      preference: segmentPreference,
      routeType: segmentRouteType,
      startCoord: segmentStartCoord,
      endCoord: segmentEndCoord,
      startPlaceId: segmentStartPlaceId,
      endPlaceId: segmentEndPlaceId,
      scenicScore: segmentScenicScore,
      difficultyScore: segmentDifficultyScore,
      note: segmentNote,
    })

    setCreationMessage(`已创建路段“${segmentName.trim()}”，可在当前旅程中查看。`)
    setExpandedPanel(null)

    setSegmentName('')
    setSegmentStartPoint('')
    setSegmentEndPoint('')
    setSegmentStartCoord(undefined)
    setSegmentEndCoord(undefined)
    setSegmentStartPlaceId(undefined)
    setSegmentEndPlaceId(undefined)
    setSegmentWaypoints([])
    setSegmentPreference('HIGHWAY_FIRST')
    setSegmentRouteType('DRIVING')
    setSegmentScenicScore(null)
    setSegmentDifficultyScore(null)
    setSegmentNote('')
  }

  return (
    <section className="card-section trip-editor-card">
      <h2>新建内容</h2>
      <div className="trip-editor-launchers" aria-label="新建内容">
        <button
          type="button"
          className={expandedPanel === 'trip' ? 'active' : ''}
          aria-expanded={expandedPanel === 'trip'}
          aria-controls="new-trip-form"
          onClick={toggleTripPanel}
          disabled={isReadonlyMode}
        >
          <AppIcon name="plus" className="icon-inline" />
          新增旅程
        </button>
        <button
          type="button"
          className={expandedPanel === 'segment' ? 'active' : ''}
          aria-expanded={expandedPanel === 'segment'}
          aria-controls="new-segment-form"
          onClick={toggleSegmentPanel}
          disabled={isReadonlyMode || trips.length === 0}
        >
          <AppIcon name="route" className="icon-inline" />
          新增路段
        </button>
      </div>
      {creationMessage && <p className="creation-success" role="status">{creationMessage}</p>}
      {expandedPanel === null && !creationMessage && (
        <p className="trip-editor-collapsed-hint">需要时展开新建表单；日常浏览和筛选无需经过表单。</p>
      )}
      {expandedPanel === 'trip' && <form id="new-trip-form" className="form-block trip-editor-form" onSubmit={handleAddTrip}>
        <h3>新增旅程</h3>
        <label className="form-field" htmlFor="new-trip-title">
          <span>旅程标题</span>
          <input id="new-trip-title" value={tripTitle} onChange={(e) => setTripTitle(e.target.value)} placeholder="例如：川西环线" disabled={isReadonlyMode} />
        </label>
        <label className="form-field" htmlFor="new-trip-start-date">
          <span>开始日期</span>
          <input
            id="new-trip-start-date"
            type="date"
            value={tripStartDate}
            onChange={(e) => {
              const nextStartDate = e.target.value
              setTripStartDate(nextStartDate)
              if (!tripEndDate || tripEndDate === tripStartDate) {
                setTripEndDate(nextStartDate)
              }
            }}
            disabled={isReadonlyMode}
          />
        </label>
        <label className="form-field" htmlFor="new-trip-end-date">
          <span>结束日期</span>
          <input
            id="new-trip-end-date"
            type="date"
            value={tripEndDate}
            onFocus={() => {
              if (!tripEndDate && tripStartDate) setTripEndDate(tripStartDate)
            }}
            onChange={(e) => setTripEndDate(e.target.value)}
            disabled={isReadonlyMode}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={isReadonlyMode}>添加旅程</button>
        {tripError && <p className="error-text">{tripError}</p>}
      </form>}

      {expandedPanel === 'segment' && <form id="new-segment-form" className="form-block trip-editor-form" onSubmit={handleAddSegment}>
        <h3>为日期新增路段</h3>
        <label className="form-field" htmlFor="new-segment-trip">
          <span>所属旅程</span>
        <select
          id="new-segment-trip"
          value={segmentTripId}
          onChange={(e) => {
            const nextTripId = e.target.value
            setSegmentTripId(nextTripId)
            setSegmentDayDate('')
          }}
          disabled={isReadonlyMode}
        >
          <option value="">请选择旅程</option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.title}
            </option>
          ))}
        </select>
        </label>

        <label className="form-field" htmlFor="new-segment-date">
          <span>路段日期</span>
        <select id="new-segment-date" value={segmentDayDate} onChange={(e) => setSegmentDayDate(e.target.value)} disabled={isReadonlyMode || !segmentTripId}>
          <option value="">请选择日期</option>
          {dateOptions.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </select>
        </label>

        <label className="form-field" htmlFor="new-segment-name">
          <span>路段名称</span>
          <input id="new-segment-name" value={segmentName} onChange={(e) => setSegmentName(e.target.value)} placeholder="例如：成都到雅安" disabled={isReadonlyMode} />
        </label>

        <label className="form-field-label" htmlFor="new-segment-start">起点</label>
        <PlaceAutocomplete
          inputId="new-segment-start"
          inputLabel="起点"
          valueText={segmentStartPoint}
          onValueTextChange={(text) => {
            setSegmentStartPoint(text)
            setSegmentStartCoord(undefined)
            setSegmentStartPlaceId(undefined)
          }}
          onSelect={(result) => {
            setSegmentStartPoint(result.label)
            setSegmentStartCoord({ lat: result.lat, lon: result.lng })
            setSegmentStartPlaceId(result.amapId)
          }}
          placeholder="起点（输入后从候选中选择）"
          disabled={isReadonlyMode || !segmentTripId}
        />

        <label className="form-field-label" htmlFor="new-segment-end">终点</label>
        <PlaceAutocomplete
          inputId="new-segment-end"
          inputLabel="终点"
          valueText={segmentEndPoint}
          onValueTextChange={(text) => {
            setSegmentEndPoint(text)
            setSegmentEndCoord(undefined)
            setSegmentEndPlaceId(undefined)
          }}
          onSelect={(result) => {
            setSegmentEndPoint(result.label)
            setSegmentEndCoord({ lat: result.lat, lon: result.lng })
            setSegmentEndPlaceId(result.amapId)
          }}
          placeholder="终点（输入后从候选中选择）"
          disabled={isReadonlyMode || !segmentTripId}
        />

        <div className="waypoint-section">
          <p>途经点（Waypoints）</p>
          <p>途经点数量：{segmentWaypoints.length}</p>
          <div className="waypoint-actions">
            <button type="button" disabled={isReadonlyMode} onClick={() => setSegmentWaypoints((prev) => [...prev, { id: createId('wp'), name: '' }])}>
              + 添加途经点
            </button>
          </div>
          <ul className="waypoint-list">
            {segmentWaypoints.map((waypoint, index) => (
              <li key={waypoint.id} className="waypoint-item">
                <span>#{index + 1}</span>
                <PlaceAutocomplete
                  inputId={`new-segment-waypoint-${waypoint.id}`}
                  inputLabel={`途经点 ${index + 1}`}
                  valueText={waypoint.name}
                  onValueTextChange={(text) => {
                    setSegmentWaypoints((prev) =>
                      prev.map((item) =>
                        item.id === waypoint.id
                          ? { ...item, name: text, lat: undefined, lng: undefined, amapId: undefined }
                          : item,
                      ),
                    )
                  }}
                  onSelect={(result) => {
                    setSegmentWaypoints((prev) =>
                      prev.map((item) =>
                        item.id === waypoint.id
                          ? { ...item, name: result.label, lat: result.lat, lng: result.lng, amapId: result.amapId }
                          : item,
                      ),
                    )
                  }}
                  placeholder="输入地名并选择候选"
                  disabled={isReadonlyMode || !segmentTripId}
                />
                <div className="waypoint-buttons">
                  <button
                    type="button"
                    disabled={isReadonlyMode}
                    onClick={() => {
                      setSegmentWaypoints((prev) => {
                        const idx = prev.findIndex((item) => item.id === waypoint.id)
                        if (idx <= 0) return prev
                        const copied = [...prev]
                        const [item] = copied.splice(idx, 1)
                        copied.splice(idx - 1, 0, item)
                        return copied
                      })
                    }}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    disabled={isReadonlyMode}
                    onClick={() => {
                      setSegmentWaypoints((prev) => {
                        const idx = prev.findIndex((item) => item.id === waypoint.id)
                        if (idx < 0 || idx >= prev.length - 1) return prev
                        const copied = [...prev]
                        const [item] = copied.splice(idx, 1)
                        copied.splice(idx + 1, 0, item)
                        return copied
                      })
                    }}
                  >
                    下移
                  </button>
                  <button type="button" disabled={isReadonlyMode} onClick={() => setSegmentWaypoints((prev) => prev.filter((item) => item.id !== waypoint.id))}>
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <label className="form-field" htmlFor="new-segment-route-type">
          <span>路线类型</span>
        <select id="new-segment-route-type" value={segmentRouteType} onChange={(e) => setSegmentRouteType(e.target.value as RouteType)} disabled={isReadonlyMode}>
          <option value="DRIVING">驾车路线</option>
          <option value="CYCLING">骑行路线（走小路）</option>
        </select>
        </label>

        <label className="form-field" htmlFor="new-segment-preference">
          <span>路线策略</span>
        <select
          id="new-segment-preference"
          value={segmentPreference}
          onChange={(e) => setSegmentPreference(e.target.value as RoutePreference)}
          disabled={isReadonlyMode || segmentRouteType === 'CYCLING'}
        >
          {routePreferenceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        </label>

        <SegmentScoreFields
          title="新增路段评分（可选）"
          values={{ scenicScore: segmentScenicScore, difficultyScore: segmentDifficultyScore }}
          onChange={(field, value) => {
            if (field === 'scenicScore') {
              setSegmentScenicScore(value)
              return
            }
            setSegmentDifficultyScore(value)
          }}
          disabled={isReadonlyMode}
        />

        <label className="segment-note-section">
          <span>新增路段备注（可选）</span>
          <textarea
            value={segmentNote}
            onChange={(event) => setSegmentNote(event.target.value)}
            rows={3}
            placeholder="记录这段路的观感、提醒或复盘备注。"
            disabled={isReadonlyMode}
          />
        </label>

        <button type="submit" className="btn-primary" disabled={isReadonlyMode || !segmentTripId || !segmentDayDate || !segmentName.trim()}>
          添加路段
        </button>
        {isReadonlyMode && <p className="hint-text">演示版只读模式下不可新增旅程或路段。</p>}
        {!segmentTripId && <p className="hint-text">请先选择旅程</p>}
        {(segmentStartPoint && !segmentStartCoord) || (segmentEndPoint && !segmentEndCoord) ? (
          <p className="hint-text">建议从候选中选择起终点，以提高定位精度。</p>
        ) : null}
        {segmentError && <p className="error-text">{segmentError}</p>}
      </form>}
    </section>
  )
}

export default TripEditor

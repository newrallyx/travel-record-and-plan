import { useMemo, useState } from 'react'
import { AutoCloseDetails } from './AutoCloseDetails'
import type { Trip } from '../types/trip'
import { formatDistance, getTripDistanceMeters } from '../utils/distance'
import { formatDurationSummary, summarizeEstimatedDurations } from '../utils/durations'
import { formatTollSummary, summarizeEstimatedTolls } from '../utils/tolls'

interface TripManageModalProps {
  trips: Trip[]
  isReadonlyMode: boolean
  onClose: () => void
  onDeleteTrip: (tripId: string) => void
  onDuplicateTrip: (tripId: string) => void
  onMoveTrip: (tripId: string, direction: 'up' | 'down') => void
  onReorderTrips: (orderedTripIds: string[]) => void
  onUpdateTrip: (tripId: string, patch: { title: string; startDate: string; endDate: string }) => boolean
  onCompleteTrip: (tripId: string) => Promise<void>
}

interface TripEditDraft {
  title: string
  startDate: string
  endDate: string
}

function segmentCountOfTrip(trip: Trip): number {
  return trip.days.reduce((sum, day) => sum + day.routeSegments.length, 0)
}

function TripManageModal({
  trips,
  isReadonlyMode,
  onClose,
  onDeleteTrip,
  onDuplicateTrip,
  onMoveTrip,
  onReorderTrips,
  onUpdateTrip,
  onCompleteTrip,
}: TripManageModalProps) {
  const [draggingTripId, setDraggingTripId] = useState<string | null>(null)
  const [dragOverTripId, setDragOverTripId] = useState<string | null>(null)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TripEditDraft | null>(null)
  const [errorText, setErrorText] = useState('')

  const sortedTrips = useMemo(() => trips, [trips])

  const moveTripToEdge = (tripId: string, edge: 'top' | 'bottom') => {
    if (isReadonlyMode) return
    const orderedIds = sortedTrips.map((trip) => trip.id)
    const from = orderedIds.findIndex((id) => id === tripId)
    if (from < 0) return
    const to = edge === 'top' ? 0 : orderedIds.length - 1
    if (from === to) return
    const [moved] = orderedIds.splice(from, 1)
    orderedIds.splice(to, 0, moved)
    onReorderTrips(orderedIds)
  }

  return (
    <section className="card-section sidebar-manage-panel" role="region" aria-label="管理旅程面板">
      <div className="sidebar-manage-header">
        <div>
          <h2>管理旅程</h2>
          <p className="hint-text">可拖拽卡片排序，也可通过“排序”菜单使用键盘调整顺序。</p>
          {isReadonlyMode && <p className="hint-text">演示版只读模式：管理操作已禁用，仅可浏览。</p>}
        </div>
      </div>

      {!!errorText && <p className="error-text">{errorText}</p>}

      <ul className="trip-manage-list">
        {sortedTrips.map((trip, index) => {
          const segmentCount = segmentCountOfTrip(trip)
          const isEditing = editingTripId === trip.id

          return (
            <li
              key={trip.id}
              className={`trip-manage-item${draggingTripId === trip.id ? ' dragging' : ''}${dragOverTripId === trip.id ? ' drag-target' : ''}`}
              draggable={!isReadonlyMode && !isEditing}
              aria-disabled={isReadonlyMode}
              onDragStart={() => setDraggingTripId(trip.id)}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOverTripId(trip.id)
              }}
              onDragLeave={() => {
                setDragOverTripId((current) => (current === trip.id ? null : current))
              }}
              onDrop={() => {
                setDragOverTripId(null)
                if (isReadonlyMode) return
                if (!draggingTripId || draggingTripId === trip.id) return
                const orderedIds = [...sortedTrips.map((item) => item.id)]
                const from = orderedIds.findIndex((id) => id === draggingTripId)
                const to = orderedIds.findIndex((id) => id === trip.id)
                if (from < 0 || to < 0) return
                const [moved] = orderedIds.splice(from, 1)
                orderedIds.splice(to, 0, moved)
                onReorderTrips(orderedIds)
                setDraggingTripId(null)
              }}
              onDragEnd={() => {
                setDraggingTripId(null)
                setDragOverTripId(null)
              }}
            >
              <div className="trip-main-meta">
                {!isEditing && (
                  <>
                    <strong title={trip.title}>{trip.title}</strong>
                    <small>
                      {trip.startDate} ~ {trip.endDate} · {segmentCount} 条路段 · 旅程总里程：
                      {formatDistance(getTripDistanceMeters(trip))}
                      {' · '}预计行驶时间：
                      {formatDurationSummary(summarizeEstimatedDurations(trip.days.flatMap((day) => day.routeSegments)))}
                      {' · '}预估过路费：
                      {formatTollSummary(summarizeEstimatedTolls(trip.days.flatMap((day) => day.routeSegments)))}
                    </small>
                  </>
                )}

                {isEditing && draft && (
                  <div className="trip-inline-edit">
                    <label className="form-field" htmlFor={`trip-title-${trip.id}`}>
                      <span>旅程标题</span>
                      <input
                        id={`trip-title-${trip.id}`}
                        value={draft.title}
                        onChange={(event) => setDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                        placeholder="旅程名称"
                        disabled={isReadonlyMode}
                      />
                    </label>
                    <label className="form-field" htmlFor={`trip-start-date-${trip.id}`}>
                      <span>开始日期</span>
                      <input
                        id={`trip-start-date-${trip.id}`}
                        type="date"
                        value={draft.startDate}
                        onChange={(event) =>
                          setDraft((prev) => (prev ? { ...prev, startDate: event.target.value } : prev))
                        }
                        disabled={isReadonlyMode}
                      />
                    </label>
                    <label className="form-field" htmlFor={`trip-end-date-${trip.id}`}>
                      <span>结束日期</span>
                      <input
                        id={`trip-end-date-${trip.id}`}
                        type="date"
                        value={draft.endDate}
                        onChange={(event) => setDraft((prev) => (prev ? { ...prev, endDate: event.target.value } : prev))}
                        disabled={isReadonlyMode}
                      />
                    </label>
                      <div className="trip-item-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => {
                            if (isReadonlyMode) return
                            if (!draft.title.trim()) {
                              setErrorText('旅程名称不能为空。')
                              return
                            }
                            if (draft.endDate < draft.startDate) {
                              setErrorText('结束日期不能早于开始日期。')
                              return
                            }
                            const ok = onUpdateTrip(trip.id, {
                              title: draft.title.trim(),
                              startDate: draft.startDate,
                              endDate: draft.endDate,
                            })
                            if (!ok) {
                              setErrorText('保存失败，请检查日期是否有效。')
                              return
                            }
                            setErrorText('')
                            setEditingTripId(null)
                            setDraft(null)
                          }}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setEditingTripId(null)
                            setDraft(null)
                            setErrorText('')
                          }}
                        >
                          取消
                        </button>
                      </div>
                  </div>
                )}
              </div>

              {!isEditing && (
                <div className="trip-item-actions trip-manage-actions">
                    <button
                      type="button"
                      className="trip-edit-button"
                      onClick={() => {
                        if (isReadonlyMode) return
                        setEditingTripId(trip.id)
                        setDraft({ title: trip.title, startDate: trip.startDate, endDate: trip.endDate })
                        setErrorText('')
                      }}
                      disabled={isReadonlyMode}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isReadonlyMode) return
                        onDuplicateTrip(trip.id)
                        setErrorText('')
                      }}
                      disabled={isReadonlyMode}
                    >
                      新建副本
                    </button>
                    <AutoCloseDetails className="trip-action-menu">
                      <summary aria-label={`调整“${trip.title}”的排序`}>排序</summary>
                      <div className="trip-action-menu-panel">
                        <button type="button" onClick={() => onMoveTrip(trip.id, 'up')} disabled={isReadonlyMode || index === 0}>
                          上移
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveTrip(trip.id, 'down')}
                          disabled={isReadonlyMode || index === sortedTrips.length - 1}
                        >
                          下移
                        </button>
                        <button type="button" onClick={() => moveTripToEdge(trip.id, 'top')} disabled={isReadonlyMode || index === 0}>
                          移到顶部
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTripToEdge(trip.id, 'bottom')}
                          disabled={isReadonlyMode || index === sortedTrips.length - 1}
                        >
                          移到底部
                        </button>
                      </div>
                    </AutoCloseDetails>
                    <AutoCloseDetails className="trip-action-menu trip-more-menu">
                      <summary aria-label={`打开“${trip.title}”的更多操作`}>更多</summary>
                      <div className="trip-action-menu-panel">
                        {trip.category === 'plan' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (isReadonlyMode) return
                              void onCompleteTrip(trip.id)
                              setErrorText('')
                            }}
                            disabled={isReadonlyMode}
                          >
                            完成旅程，转入复盘
                          </button>
                        )}
                        <button type="button" className="danger-btn" onClick={() => onDeleteTrip(trip.id)} disabled={isReadonlyMode}>
                          删除旅程
                        </button>
                      </div>
                    </AutoCloseDetails>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="modal-footer">
        <button type="button" onClick={onClose}>
          完成
        </button>
      </div>
    </section>
  )
}

export default TripManageModal

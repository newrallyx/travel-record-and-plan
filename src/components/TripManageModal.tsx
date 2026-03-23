import { useMemo, useState } from 'react'
import type { Trip } from '../types/trip'
import { formatDistance, getTripDistanceMeters } from '../utils/distance'

interface TripManageModalProps {
  trips: Trip[]
  isReadonlyMode: boolean
  onClose: () => void
  onDeleteTrip: (tripId: string) => void
  onMoveTrip: (tripId: string, direction: 'up' | 'down') => void
  onReorderTrips: (orderedTripIds: string[]) => void
  onUpdateTrip: (tripId: string, patch: { title: string; startDate: string; endDate: string }) => boolean
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
  onMoveTrip,
  onReorderTrips,
  onUpdateTrip,
}: TripManageModalProps) {
  const [draggingTripId, setDraggingTripId] = useState<string | null>(null)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TripEditDraft | null>(null)
  const [errorText, setErrorText] = useState('')

  const sortedTrips = useMemo(() => trips, [trips])

  return (
    <section className="card-section sidebar-manage-panel" role="region" aria-label="管理旅程面板">
      <div className="sidebar-manage-header">
        <div>
          <h2>1) 管理旅程</h2>
          <p className="hint-text">支持拖拽排序、编辑旅程信息，也可使用上移/下移按钮。</p>
          {isReadonlyMode && <p className="hint-text">演示版只读模式：管理操作已禁用，仅可浏览。</p>}
        </div>
        <button type="button" onClick={onClose}>
          返回左栏
        </button>
      </div>

      {!!errorText && <p className="error-text">{errorText}</p>}

      <ul className="trip-manage-list">
        {sortedTrips.map((trip, index) => {
          const segmentCount = segmentCountOfTrip(trip)
          const isEditing = editingTripId === trip.id

          return (
            <li
              key={trip.id}
              className="trip-manage-item"
              draggable
              aria-disabled={isReadonlyMode}
              onDragStart={() => setDraggingTripId(trip.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
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
              onDragEnd={() => setDraggingTripId(null)}
            >
              <div className="trip-main-meta">
                {!isEditing && (
                  <>
                    <strong>{trip.title}</strong>
                    <small>
                      {trip.startDate} ~ {trip.endDate} · {segmentCount} 条路段 · 旅程总里程：
                      {formatDistance(getTripDistanceMeters(trip))}
                    </small>
                  </>
                )}

                {isEditing && draft && (
                  <div className="trip-inline-edit">
                      <input
                        value={draft.title}
                        onChange={(event) => setDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                        placeholder="旅程名称"
                        disabled={isReadonlyMode}
                      />
                      <input
                        type="date"
                        value={draft.startDate}
                        onChange={(event) =>
                          setDraft((prev) => (prev ? { ...prev, startDate: event.target.value } : prev))
                        }
                        disabled={isReadonlyMode}
                      />
                      <input
                        type="date"
                        value={draft.endDate}
                        onChange={(event) => setDraft((prev) => (prev ? { ...prev, endDate: event.target.value } : prev))}
                        disabled={isReadonlyMode}
                      />
                      <div className="trip-item-actions">
                        <button
                          type="button"
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
                <div className="trip-item-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (isReadonlyMode) return
                        setEditingTripId(trip.id)
                        setDraft({ title: trip.title, startDate: trip.startDate, endDate: trip.endDate })
                        setErrorText('')
                      }}
                    >
                      编辑
                    </button>
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
                    <button type="button" className="danger-btn" onClick={() => onDeleteTrip(trip.id)} disabled={isReadonlyMode}>
                      删除
                    </button>
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

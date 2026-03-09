import { useMemo, useState } from 'react'
import type { Trip } from '../types/trip'

interface TripManageModalProps {
  open: boolean
  trips: Trip[]
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
  open,
  trips,
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

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>管理旅程</h3>
        <p className="hint-text">支持拖拽排序、编辑旅程信息，也可使用上移/下移按钮。</p>

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
                onDragStart={() => setDraggingTripId(trip.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
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
                        {trip.startDate} ~ {trip.endDate} · {segmentCount} 条路段
                      </small>
                    </>
                  )}

                  {isEditing && draft && (
                    <div className="trip-inline-edit">
                      <input
                        value={draft.title}
                        onChange={(event) => setDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                        placeholder="旅程名称"
                      />
                      <input
                        type="date"
                        value={draft.startDate}
                        onChange={(event) =>
                          setDraft((prev) => (prev ? { ...prev, startDate: event.target.value } : prev))
                        }
                      />
                      <input
                        type="date"
                        value={draft.endDate}
                        onChange={(event) => setDraft((prev) => (prev ? { ...prev, endDate: event.target.value } : prev))}
                      />
                      <div className="trip-item-actions">
                        <button
                          type="button"
                          onClick={() => {
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
                        setEditingTripId(trip.id)
                        setDraft({ title: trip.title, startDate: trip.startDate, endDate: trip.endDate })
                        setErrorText('')
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" onClick={() => onMoveTrip(trip.id, 'up')} disabled={index === 0}>
                      上移
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveTrip(trip.id, 'down')}
                      disabled={index === sortedTrips.length - 1}
                    >
                      下移
                    </button>
                    <button type="button" className="danger-btn" onClick={() => onDeleteTrip(trip.id)}>
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
      </div>
    </div>
  )
}

export default TripManageModal

import { useEffect, useMemo, useRef, useState } from 'react'
import { confirmDialog } from '../ConfirmDialog.tsx'
import { showToast } from '../ToastHost.tsx'
import { searchAmapInputTips, planCyclingRoute, planDrivingRoute } from '../../services/amap.ts'
import {
  getSegmentRouteCache,
  restoreAutomaticRoadPartCorrection,
  saveHistoricalRoadAnalysisOnly,
  saveHistoricalRouteReplacement,
  saveManualRoadPartCorrection,
  type RouteCacheRecord,
} from '../../services/routeCacheDb.ts'
import {
  collectHistoricalRoadAnalysisTargets,
  runHistoricalRoadAnalysisBatch,
  type HistoricalRoadAnalysisProgress,
  type HistoricalRoadAnalysisScope,
  type HistoricalRoadAnalysisTarget,
  type HistoricalRouteConflict,
} from '../../services/historicalRoadAnalysis.ts'
import type { ResolvedRoutePatch } from '../map/types.ts'
import type { Trip } from '../../types/trip.ts'
import { sortTripsByStartDate } from '../../utils/tripOrder.ts'
import RoadPartCorrectionTable, { type RoadPartCorrectionDraft } from './RoadPartCorrectionTable.tsx'
import RoadIntervalAnnotationPanel from './RoadIntervalAnnotationPanel.tsx'

interface RoadAnalysisManagerProps {
  trips: readonly Trip[]
  currentTripId?: string
  currentSegmentId?: string
  isReadonlyMode?: boolean
  onReplacement: (patch: ResolvedRoutePatch) => void
  onCacheChange: () => void
}

const EMPTY_PROGRESS: HistoricalRoadAnalysisProgress = {
  total: 0,
  completed: 0,
  active: 0,
  success: 0,
  pending: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
  items: [],
}

function findReviewTripContainingSegment(trips: readonly Trip[], segmentId?: string): Trip | undefined {
  if (!segmentId) return undefined
  return trips.find((trip) => trip.category === 'review'
    && trip.days.some((day) => day.routeSegments.some((segment) => segment.id === segmentId)))
}

function findTripDayContainingSegment(trip: Trip | undefined, segmentId?: string) {
  if (!trip || !segmentId) return undefined
  return trip.days.find((day) => day.routeSegments.some((segment) => segment.id === segmentId))
}

function getFirstDayId(trip: Trip | undefined): string {
  return trip?.days[0]?.id ?? ''
}

function getFirstSegmentId(trip: Trip | undefined, dayId?: string): string {
  const day = dayId ? trip?.days.find((item) => item.id === dayId) : trip?.days[0]
  return day?.routeSegments[0]?.id ?? ''
}

function getCorrectionDrafts(cache: RouteCacheRecord | null): RoadPartCorrectionDraft[] {
  return cache?.roadParts?.map((part) => ({
    roadClass: part.roadClass,
    routeRef: part.routeRef ?? '',
    provinceCode: part.provinceCode ?? '',
  })) ?? []
}

function formatDistanceDifference(conflict: HistoricalRouteConflict): string {
  const ratio = conflict.comparison.distanceDifferenceRatio
  const geometry = conflict.comparison.geometrySimilarity
  const distanceText = ratio === null ? '里程无法比较' : `里程差 ${(ratio * 100).toFixed(1)}%`
  return `${distanceText}，几何相似度 ${(geometry * 100).toFixed(1)}%`
}

export default function RoadAnalysisManager({
  trips,
  currentTripId,
  currentSegmentId,
  isReadonlyMode = false,
  onReplacement,
  onCacheChange,
}: RoadAnalysisManagerProps) {
  const [scope, setScope] = useState<HistoricalRoadAnalysisScope>('current-segment')
  const [progress, setProgress] = useState<HistoricalRoadAnalysisProgress>(EMPTY_PROGRESS)
  const [running, setRunning] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const initialCorrectionTrip = findReviewTripContainingSegment(trips, currentSegmentId)
    ?? trips.find((trip) => trip.category === 'review' && trip.id === currentTripId)
    ?? trips.find((trip) => trip.category === 'review')
  const initialCorrectionDay = findTripDayContainingSegment(initialCorrectionTrip, currentSegmentId)
    ?? initialCorrectionTrip?.days[0]
  const [correctionTripId, setCorrectionTripId] = useState(initialCorrectionTrip?.id ?? '')
  const [correctionDayId, setCorrectionDayId] = useState(initialCorrectionDay?.id ?? '')
  const [correctionSegmentId, setCorrectionSegmentId] = useState(() => {
    if (currentSegmentId && findTripDayContainingSegment(initialCorrectionTrip, currentSegmentId)) {
      return currentSegmentId
    }
    return getFirstSegmentId(initialCorrectionTrip, initialCorrectionDay?.id)
  })
  const [correctionCache, setCorrectionCache] = useState<RouteCacheRecord | null>(null)
  const [correctionDrafts, setCorrectionDrafts] = useState<RoadPartCorrectionDraft[]>([])
  const [savingCorrectionIndex, setSavingCorrectionIndex] = useState<number | null>(null)
  const [savingAllCorrections, setSavingAllCorrections] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const correctionContextRef = useRef({ currentTripId, currentSegmentId })

  const reviewTrips = useMemo(() => sortTripsByStartDate(trips.filter((trip) => trip.category === 'review')), [trips])
  const correctionTrip = useMemo(
    () => reviewTrips.find((trip) => trip.id === correctionTripId),
    [reviewTrips, correctionTripId],
  )
  const correctionDay = useMemo(
    () => correctionTrip?.days.find((day) => day.id === correctionDayId),
    [correctionTrip, correctionDayId],
  )
  const correctionSegments = useMemo(
    () => correctionDay?.routeSegments ?? [],
    [correctionDay],
  )
  const correctionSegment = useMemo(
    () => correctionSegments.find((segment) => segment.id === correctionSegmentId),
    [correctionSegmentId, correctionSegments],
  )

  useEffect(() => {
    const previousContext = correctionContextRef.current
    const contextChanged = previousContext.currentTripId !== currentTripId
      || previousContext.currentSegmentId !== currentSegmentId

    if (contextChanged) {
      correctionContextRef.current = { currentTripId, currentSegmentId }
      const nextTrip = findReviewTripContainingSegment(reviewTrips, currentSegmentId)
        ?? reviewTrips.find((trip) => trip.id === currentTripId)
        ?? reviewTrips[0]
      const nextDay = findTripDayContainingSegment(nextTrip, currentSegmentId)
        ?? nextTrip?.days[0]
      const nextSegmentId = currentSegmentId
        && findTripDayContainingSegment(nextTrip, currentSegmentId)
        ? currentSegmentId
        : getFirstSegmentId(nextTrip, nextDay?.id)
      setCorrectionTripId(nextTrip?.id ?? '')
      setCorrectionDayId(nextDay?.id ?? '')
      setCorrectionSegmentId(nextSegmentId)
      return
    }

    const selectedTripStillExists = reviewTrips.some((trip) => trip.id === correctionTripId)
    if (!selectedTripStillExists) {
      if (!correctionTripId) {
        if (correctionDayId) setCorrectionDayId('')
        if (correctionSegmentId) setCorrectionSegmentId('')
        return
      }
      const nextTrip = findReviewTripContainingSegment(reviewTrips, currentSegmentId)
        ?? reviewTrips.find((trip) => trip.id === currentTripId)
        ?? reviewTrips[0]
      setCorrectionTripId(nextTrip?.id ?? '')
      const nextDay = nextTrip?.days[0]
      setCorrectionDayId(nextDay?.id ?? '')
      setCorrectionSegmentId(getFirstSegmentId(nextTrip, nextDay?.id))
      return
    }

    if (!correctionDay) {
      const nextDayId = getFirstDayId(correctionTrip)
      setCorrectionDayId(nextDayId)
      setCorrectionSegmentId(getFirstSegmentId(correctionTrip, nextDayId))
      return
    }

    if (!correctionSegments.some((segment) => segment.id === correctionSegmentId)) {
      setCorrectionSegmentId(getFirstSegmentId(correctionTrip, correctionDayId))
    }
  }, [correctionDay, correctionDayId, correctionSegmentId, correctionSegments, correctionTrip, correctionTripId, currentSegmentId, currentTripId, reviewTrips])

  const loadCorrectionCache = async (segmentId = correctionSegmentId) => {
    const cache = segmentId ? await getSegmentRouteCache(segmentId) : null
    if (segmentId === correctionSegmentId) {
      setCorrectionCache(cache)
      setCorrectionDrafts(getCorrectionDrafts(cache))
    }
  }

  useEffect(() => {
    let cancelled = false
    setCorrectionCache(null)
    setCorrectionDrafts([])
    if (!correctionSegmentId) {
      return
    }
    void getSegmentRouteCache(correctionSegmentId).then((cache) => {
      if (!cancelled) {
        setCorrectionCache(cache)
        setCorrectionDrafts(getCorrectionDrafts(cache))
      }
    })
    return () => { cancelled = true }
  }, [correctionSegmentId])

  const afterCorrection = async (savedIndices: readonly number[]) => {
    const cache = await getSegmentRouteCache(correctionSegmentId)
    setCorrectionCache(cache)
    // A row save must not discard edits waiting to be saved in other rows.
    setCorrectionDrafts((current) => getCorrectionDrafts(cache).map((draft, index) => (
      savedIndices.includes(index) ? draft : current[index] ?? draft
    )))
    onCacheChange()
  }

  const dirtyCorrections = useMemo(() => {
    if (!correctionCache?.roadParts) return []
    return correctionCache.roadParts.flatMap((part, partIndex) => {
      const draft = correctionDrafts[partIndex]
      if (!draft || (
        draft.roadClass === part.roadClass
        && draft.routeRef.trim() === (part.routeRef ?? '')
        && draft.provinceCode === (part.provinceCode ?? '')
      )) return []
      return [{ partIndex, draft }]
    })
  }, [correctionCache, correctionDrafts])
  const correctionSaving = savingAllCorrections || savingCorrectionIndex !== null

  const saveCorrections = async (indices: number[]) => {
    if (!correctionSegmentId || correctionSaving || isReadonlyMode || running || indices.length === 0) return
    setSavingAllCorrections(true)
    const saved: number[] = []
    try {
      for (const partIndex of indices) {
        const draft = correctionDrafts[partIndex]
        if (!draft) continue
        await saveManualRoadPartCorrection(correctionSegmentId, partIndex, draft)
        saved.push(partIndex)
      }
      await afterCorrection(saved)
      showToast(`已保存 ${saved.length} 个道路片段的人工修正。`, 'success')
    } catch (error) {
      onCacheChange()
      showToast(`已保存 ${saved.length} 段，其余修改仍保留，可重试。${(error as Error).message || '人工修正保存失败。'}`, 'error')
    } finally {
      setSavingAllCorrections(false)
    }
  }

  const restoreCorrection = async (partIndex: number) => {
    if (!correctionSegmentId || correctionSaving) return
    setSavingCorrectionIndex(partIndex)
    try {
      await restoreAutomaticRoadPartCorrection(correctionSegmentId, partIndex)
      await afterCorrection([partIndex])
      showToast('已恢复自动道路分类。', 'success')
    } catch (error) {
      showToast((error as Error).message || '恢复自动分类失败。', 'error')
    } finally {
      setSavingCorrectionIndex(null)
    }
  }

  const saveAllCorrections = async () => {
    await saveCorrections(dirtyCorrections.map(({ partIndex }) => partIndex))
  }

  const runTargets = async (targets: HistoricalRoadAnalysisTarget[]) => {
    if (running || targets.length === 0) return
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    let decisionQueue: Promise<unknown> = Promise.resolve()
    const resolveConflict = (conflict: HistoricalRouteConflict) => {
      const decision = decisionQueue.then(async () => {
        const replace = await confirmDialog({
          title: '重新规划路线差异较大',
          message: `路段“${conflict.target.segment.name}”与已保存轨迹不相似（${formatDistanceDifference(conflict)}）。请选择保留原轨迹，或明确替换为本次重新规划结果。`,
          cancelText: '保留原轨迹',
          confirmText: '明确替换',
          danger: true,
          signal: controller.signal,
        })
        return replace ? 'replace' as const : 'keep' as const
      })
      decisionQueue = decision.then(() => undefined, () => undefined)
      return decision
    }

    try {
      await runHistoricalRoadAnalysisBatch(targets, {
        signal: controller.signal,
        getRouteCache: getSegmentRouteCache,
        resolvePlace: async (name) => {
          const { tips } = await searchAmapInputTips({ keywords: name, citylimit: false })
          const first = tips[0]
          return first ? { lat: first.lat, lng: first.lng } : null
        },
        planDrivingRoute,
        planCyclingRoute,
        saveAnalysisOnly: saveHistoricalRoadAnalysisOnly,
        saveReplacement: saveHistoricalRouteReplacement,
        resolveConflict,
        onReplacement,
        onProgress: setProgress,
      })
      onCacheChange()
      await loadCorrectionCache()
    } finally {
      controllerRef.current = null
      setRunning(false)
    }
  }

  const start = () => {
    const targets = collectHistoricalRoadAnalysisTargets(trips, scope, currentTripId, currentSegmentId)
    if (targets.length === 0) {
      showToast('当前范围没有可分析的复盘路段。', 'info')
      return
    }
    void runTargets(targets)
  }

  const retryFailed = () => {
    const targets = progress.items.filter((item) => item.status === 'failed').map((item) => item.target)
    void runTargets(targets)
  }

  useEffect(() => {
    if (running || progress.failed > 0 || progress.items.length > 0) setManagerOpen(true)
  }, [progress.failed, progress.items.length, running])

  return (
    <section className="statistics-module road-analysis-manager" aria-label="历史路线道路分析">
      <details
        className="road-analysis-disclosure"
        open={managerOpen}
        onToggle={(event) => setManagerOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="road-analysis-summary-title">
            <strong>历史路线道路分析</strong>
            <small>按需补全道路分类与历史统计</small>
          </span>
          <span className={`road-analysis-status ${running ? 'is-running' : progress.failed > 0 ? 'is-failed' : progress.total > 0 ? 'is-complete' : 'is-idle'}`}>
            {running ? `分析中 ${progress.completed}/${progress.total}` : progress.failed > 0 ? `${progress.failed} 项失败` : progress.total > 0 ? `已完成 ${progress.completed}/${progress.total}` : '尚未运行'}
          </span>
        </summary>
        <div className="road-analysis-disclosure-body">
          <header className="statistics-module-heading">
            <div>
              <p>并发数固定为 2，失败自动重试一次。重新规划先比较总里程和几何；相似时只补道路分析，差异较大时由你决定是否替换。</p>
            </div>
          </header>
          <div className="road-analysis-toolbar">
        <label><span>分析范围</span>
          <select value={scope} onChange={(event) => setScope(event.target.value as HistoricalRoadAnalysisScope)} disabled={running}>
            <option value="current-segment">当前路段</option>
            <option value="current-trip">当前旅程</option>
            <option value="all-review">全部复盘旅程</option>
          </select>
        </label>
        <button type="button" className="btn-primary" onClick={start} disabled={isReadonlyMode || running || (scope === 'current-segment' ? !currentSegmentId : scope === 'current-trip' ? !currentTripId : false)}>
          {running ? '分析中…' : '开始分析'}
        </button>
        {running && <button type="button" className="btn-secondary" onClick={() => controllerRef.current?.abort()}>取消</button>}
        {!running && progress.failed > 0 && <button type="button" className="btn-secondary" onClick={retryFailed}>重试失败项</button>}
          </div>
          <div className="road-analysis-progress" aria-live="polite">
        <span>进度 <strong>{progress.completed}/{progress.total}</strong></span>
        <span>成功 <strong>{progress.success}</strong></span>
        <span>待确认 <strong>{progress.pending}</strong></span>
        <span>失败 <strong>{progress.failed}</strong></span>
        <span>跳过 <strong>{progress.skipped}</strong></span>
        <span>取消 <strong>{progress.cancelled}</strong></span>
          </div>
          {progress.items.length > 0 && (
            <div className="road-analysis-result-list">
          {progress.items.map((item) => <div key={`${item.target.tripId}:${item.target.segment.id}`} data-status={item.status}>
            <strong>{item.target.segment.name}</strong><span>{item.message ?? (item.status === 'running' ? `正在分析（第 ${item.attempts || 1} 次）` : '等待处理')}</span>
          </div>)}
            </div>
          )}

          <div className="road-analysis-corrections">
        <header>
          <div className="road-analysis-correction-heading">
            <div><h4>人工修正</h4><p>可修正道路类型、编号和省份；来源记为 MANUAL，可随时按原始道路证据恢复自动分类。</p></div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void saveAllCorrections()}
              disabled={isReadonlyMode || running || correctionSaving || dirtyCorrections.length === 0}
            >
              全部保存
            </button>
          </div>
          <div className="road-analysis-correction-selectors" aria-label="人工修正选择范围">
            <label>
              <span>选择旅程</span>
              <select
                aria-label="选择旅程"
                value={correctionTripId}
                onChange={(event) => {
                  const nextTripId = event.target.value
                  const nextTrip = reviewTrips.find((trip) => trip.id === nextTripId)
                  const nextDay = nextTrip?.days[0]
                  setCorrectionTripId(nextTripId)
                  setCorrectionDayId(nextDay?.id ?? '')
                  setCorrectionSegmentId(getFirstSegmentId(nextTrip, nextDay?.id))
                }}
                disabled={running || correctionSaving}
              >
                <option value="">请选择旅程</option>
                {reviewTrips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
              </select>
            </label>
            <label>
              <span>选择日期</span>
              <select
                aria-label="选择日期"
                value={correctionDayId}
                onChange={(event) => {
                  const nextDayId = event.target.value
                  setCorrectionDayId(nextDayId)
                  setCorrectionSegmentId(getFirstSegmentId(correctionTrip, nextDayId))
                }}
                disabled={running || correctionSaving || !correctionTrip || correctionTrip.days.length === 0}
              >
                <option value="">{correctionTrip ? '请选择日期' : '请先选择旅程'}</option>
                {correctionTrip?.days.map((day) => <option key={day.id} value={day.id}>{day.date || '未标日期'}</option>)}
              </select>
            </label>
            <label>
              <span>选择对应日期的路段</span>
              <select
                aria-label="选择对应日期的路段"
                value={correctionSegmentId}
                onChange={(event) => setCorrectionSegmentId(event.target.value)}
                disabled={running || correctionSaving || !correctionDay || correctionSegments.length === 0}
              >
                <option value="">{correctionDay ? '请选择路段' : correctionTrip ? '请先选择日期' : '请先选择旅程'}</option>
                {correctionSegments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
              </select>
            </label>
          </div>
        </header>
        {correctionSegment && (
          <RoadIntervalAnnotationPanel
            segment={correctionSegment}
            cache={correctionCache}
            disabled={isReadonlyMode || running || correctionSaving}
            onCacheChange={onCacheChange}
            onReload={() => loadCorrectionCache()}
          />
        )}
        {correctionCache?.roadParts?.length ? (
          <RoadPartCorrectionTable
            key={correctionSegmentId}
            parts={correctionCache.roadParts}
            drafts={correctionDrafts}
            disabled={isReadonlyMode || running || correctionSaving}
            onDraftChange={(indices, patch) => setCorrectionDrafts((current) => current.map((draft, index) => (
              indices.includes(index) ? { ...draft, ...patch } : draft
            )))}
            onSave={(indices) => void saveCorrections(indices)}
            onRestore={(index) => void restoreCorrection(index)}
          />
        ) : <p className="road-analysis-empty">所选路段暂无可修正的道路分析，请先运行历史路线道路分析。</p>}
          </div>
        </div>
      </details>
    </section>
  )
}

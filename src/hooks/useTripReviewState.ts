import { useCallback, useEffect, useState } from 'react'
import { isReadonlyDemoMode } from '../config/appMode'
import {
  loadTripReviewWithStatus,
  readTripReviewRecoveryCopy,
  replaceCorruptTripReviewWithMockData,
  saveTripReview,
  type TripReviewLoadResult,
  type TripStorageIssue,
} from '../services/tripStorage'
import type { TripReview } from '../types/trip'

const EMPTY_TRIP_REVIEW: TripReview = { trips: [] }
const SAVE_FAILURE_MESSAGE = '未持久化：本次更改未能保存到本地。请检查磁盘空间或存储权限后重试。'

type DemoManifest = {
  files: string[]
}

export function useTripReviewState() {
  const [initialLoad] = useState<TripReviewLoadResult>(() => {
    return isReadonlyDemoMode
      ? { tripReview: EMPTY_TRIP_REVIEW, issue: null, persistenceBlocked: false }
      : loadTripReviewWithStatus()
  })
  const [tripReview, setTripReview] = useState<TripReview>(initialLoad.tripReview)
  const [storageIssue, setStorageIssue] = useState<TripStorageIssue | null>(initialLoad.issue)
  const [persistenceBlocked, setPersistenceBlocked] = useState(initialLoad.persistenceBlocked)
  const [recoveryExported, setRecoveryExported] = useState(false)
  const [demoLoading, setDemoLoading] = useState<boolean>(isReadonlyDemoMode)
  const [demoError, setDemoError] = useState<string | null>(null)

  useEffect(() => {
    if (!isReadonlyDemoMode) return

    let cancelled = false

    async function loadDemoData() {
      try {
        setDemoLoading(true)
        setDemoError(null)

        const manifestResponse = await fetch('/demo-data/manifest.json', { cache: 'no-store' })
        if (!manifestResponse.ok) {
          throw new Error(`读取 manifest.json 失败：HTTP ${manifestResponse.status}`)
        }

        const manifest = (await manifestResponse.json()) as DemoManifest

        if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
          throw new Error('manifest.json 格式不正确，缺少 files 数组')
        }

        const parts = await Promise.all(
          manifest.files.map(async (filePath) => {
            const response = await fetch(filePath, { cache: 'no-store' })
            if (!response.ok) {
              throw new Error(`读取 ${filePath} 失败：HTTP ${response.status}`)
            }

            const data = (await response.json()) as TripReview

            if (!data || !Array.isArray(data.trips)) {
              throw new Error(`${filePath} 格式不正确，缺少 trips 数组`)
            }

            return data
          }),
        )

        const merged: TripReview = {
          trips: parts.flatMap((part) => part.trips ?? []),
        }

        if (!cancelled) {
          setTripReview(merged)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        if (!cancelled) {
          setDemoError(message)
          setTripReview(EMPTY_TRIP_REVIEW)
        }
      } finally {
        if (!cancelled) {
          setDemoLoading(false)
        }
      }
    }

    void loadDemoData()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isReadonlyDemoMode || persistenceBlocked) return

    const result = saveTripReview(tripReview)
    if (result.ok) {
      setStorageIssue((current) => current?.kind === 'save-failed' ? null : current)
    } else {
      setStorageIssue({ kind: 'save-failed', message: SAVE_FAILURE_MESSAGE })
    }
  }, [persistenceBlocked, tripReview])

  const retryTripPersistence = useCallback(() => {
    if (isReadonlyDemoMode || persistenceBlocked) return false

    const result = saveTripReview(tripReview)
    setStorageIssue(result.ok ? null : { kind: 'save-failed', message: SAVE_FAILURE_MESSAGE })
    return result.ok
  }, [persistenceBlocked, tripReview])

  const downloadTripRecoveryCopy = useCallback(() => {
    try {
      const preferQuarantinedCopy = storageIssue?.kind === 'corrupt-data' && storageIssue.recoverySaved
      const raw = readTripReviewRecoveryCopy(preferQuarantinedCopy)
      if (raw === null) return false

      const blob = new Blob([raw], { type: 'text/plain;charset=utf-8' })
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      anchor.href = downloadUrl
      anchor.download = `trip-review-recovery-${timestamp}.txt`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)
      setRecoveryExported(true)
      return true
    } catch (error) {
      console.error('[tripStorage] Failed to export the recovery copy.', error)
      return false
    }
  }, [storageIssue])

  const canResetCorruptTripStorage = storageIssue?.kind === 'corrupt-data'
    && (storageIssue.recoverySaved || recoveryExported)

  const resetCorruptTripStorage = useCallback(() => {
    if (!canResetCorruptTripStorage) return false

    try {
      const nextTripReview = replaceCorruptTripReviewWithMockData()
      setTripReview(nextTripReview)
      setPersistenceBlocked(false)
      setStorageIssue(null)
      return true
    } catch (error) {
      console.error('[tripStorage] Failed to replace corrupted trip data after user confirmation.', error)
      setStorageIssue((current) => ({
        kind: 'corrupt-data',
        recoverySaved: current?.kind === 'corrupt-data' ? current.recoverySaved : false,
        message: '使用示例数据重置失败。原始数据仍未被覆盖，请先导出恢复原文并检查存储权限。',
      }))
      return false
    }
  }, [canResetCorruptTripStorage])

  return {
    tripReview,
    setTripReview,
    demoLoading,
    demoError,
    storageIssue,
    retryTripPersistence,
    downloadTripRecoveryCopy,
    canResetCorruptTripStorage,
    resetCorruptTripStorage,
  }
}

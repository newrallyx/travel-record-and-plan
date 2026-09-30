import { useCallback, useEffect, useState } from 'react'
import {
  getAmapKeyStatus,
  saveAmapKey,
  type AmapKeySource,
} from '../services/amapKeyConfig'

const GUIDE_DISMISSED_KEY = 'roadtrip:amap-guide-dismissed:v1'

function hasDismissedGuide() {
  try { return localStorage.getItem(GUIDE_DISMISSED_KEY) === '1' } catch { return false }
}

function dismissGuide() {
  try { localStorage.setItem(GUIDE_DISMISSED_KEY, '1') } catch { /* 存储不可用时仍允许关闭。 */ }
}

export function useAmapKeyConfig(enabled: boolean) {
  const [configured, setConfigured] = useState(false)
  const [source, setSource] = useState<AmapKeySource>(null)
  const [isChecking, setIsChecking] = useState(enabled)
  const [isSaving, setIsSaving] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [initialPage, setInitialPage] = useState<'config' | 'guide'>('config')
  const [error, setError] = useState('')
  const [serviceRevision, setServiceRevision] = useState(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    setIsChecking(true)
    setError('')
    try {
      const status = await getAmapKeyStatus()
      setConfigured(status.configured)
      setSource(status.source)
      if (!status.configured && !hasDismissedGuide()) {
        setInitialPage('guide')
        setIsOpen(true)
      }
    } catch (requestError) {
      setConfigured(false)
      setSource(null)
      setError(requestError instanceof Error ? requestError.message : '无法读取地图服务配置。')
    } finally {
      setIsChecking(false)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async (key: string): Promise<boolean> => {
    const normalizedKey = key.trim()
    if (!normalizedKey) {
      setError('请输入高德 Web 服务 Key。')
      return false
    }

    setIsSaving(true)
    setError('')
    try {
      const status = await saveAmapKey(normalizedKey)
      setConfigured(status.configured)
      setSource(status.source)
      setServiceRevision((current) => current + 1)
      dismissGuide()
      setIsOpen(false)
      return true
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '保存地图服务 Key 失败。')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [])

  const open = useCallback(() => {
    setError('')
    setInitialPage('config')
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    dismissGuide()
    setIsOpen(false)
  }, [])

  return {
    configured,
    source,
    isChecking,
    isSaving,
    isOpen,
    initialPage,
    error,
    serviceRevision,
    open,
    close,
    save,
    refresh,
  }
}

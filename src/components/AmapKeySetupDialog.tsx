import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { AmapKeySource } from '../services/amapKeyConfig'

interface AmapKeySetupDialogProps {
  open: boolean
  configured: boolean
  source: AmapKeySource
  isSaving: boolean
  error: string
  onSave: (key: string) => Promise<boolean>
  onClose: () => void
}

function sourceLabel(source: AmapKeySource): string {
  if (source === 'environment') return '环境变量'
  if (source === 'local-config') return '本机应用配置'
  return '未配置'
}

function AmapKeySetupDialog({
  open,
  configured,
  source,
  isSaving,
  error,
  onSave,
  onClose,
}: AmapKeySetupDialogProps) {
  const [keyDraft, setKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (!open) return
    setKeyDraft('')
    setShowKey(false)
  }, [open])

  if (!open) return null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const saved = await onSave(keyDraft)
    if (saved) setKeyDraft('')
  }

  return (
    <div className="amap-key-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="amap-key-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="amap-key-dialog-title"
      >
        <div className="amap-key-dialog-header">
          <div>
            <h2 id="amap-key-dialog-title">配置地图服务</h2>
            <p>地点联想和路线规划需要高德 Web 服务 Key。</p>
          </div>
          <button type="button" className="amap-key-dialog-close" onClick={onClose} aria-label="关闭配置窗口">
            ×
          </button>
        </div>

        <p className="amap-key-dialog-status">
          当前状态：{configured ? `已配置（${sourceLabel(source)}）` : '未配置'}
        </p>

        <form onSubmit={submit}>
          <label className="amap-key-field">
            高德 Web 服务 Key
            <div className="amap-key-input-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                placeholder={configured ? '输入新的 Key 可替换当前配置' : '请输入高德 Web 服务 Key'}
                autoComplete="off"
                spellCheck={false}
                disabled={isSaving}
                autoFocus
              />
              <button type="button" onClick={() => setShowKey((current) => !current)} disabled={isSaving}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          <p className="amap-key-dialog-note">
            Key 仅发送到本机后端。桌面版会保存在当前 Windows 用户的应用数据目录，不会写入旅程备份。
          </p>
          {error && <p className="amap-key-dialog-error">{error}</p>}

          <div className="amap-key-dialog-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
              稍后设置
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving || !keyDraft.trim()}>
              {isSaving ? '保存中...' : configured ? '替换 Key' : '保存并启用'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default AmapKeySetupDialog

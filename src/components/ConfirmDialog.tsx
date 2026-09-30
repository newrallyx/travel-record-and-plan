import { useEffect, useId, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

export interface DialogOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  showCancel?: boolean
  input?: {
    label?: string
    placeholder?: string
    defaultValue?: string
  }
  signal?: AbortSignal
}

type DialogResult = boolean | string | null

interface PendingDialog extends DialogOptions {
  resolve: (value: DialogResult) => void
  abortHandler?: () => void
}

let pending: PendingDialog | null = null
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) listener()
}

function showDialog(options: DialogOptions): Promise<DialogResult> {
  return new Promise<DialogResult>((resolve) => {
    if (options.signal?.aborted) {
      resolve(options.input ? null : false)
      return
    }
    const nextPending: PendingDialog = { ...options, resolve }
    const abortHandler = () => {
      if (pending?.resolve !== resolve) return
      pending = null
      emitChange()
      resolve(options.input ? null : false)
    }
    nextPending.abortHandler = abortHandler
    pending = nextPending
    emitChange()
    options.signal?.addEventListener('abort', abortHandler, { once: true })
  })
}

/** 确认对话框：resolve(true) 确认 / resolve(false) 取消 */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
  return showDialog({
    title: '确认操作',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    ...options,
  }) as Promise<boolean>
}

/** 提示对话框：仅一个「知道了」按钮 */
export function alertDialog(message: string, options: Partial<DialogOptions> = {}): Promise<boolean> {
  return showDialog({
    title: '提示',
    message,
    confirmText: '知道了',
    showCancel: false,
    ...options,
  }) as Promise<boolean>
}

/** 输入对话框：resolve(输入值) / 取消 resolve(null) */
export function promptDialog(
  options: DialogOptions & { input: NonNullable<DialogOptions['input']> },
): Promise<string | null> {
  return showDialog({
    title: '请输入',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    ...options,
  }) as Promise<string | null>
}

/** 全局对话框宿主：在应用根部挂载一次 */
export function ConfirmDialogHost() {
  const [state, setState] = useState<PendingDialog | null>(pending)
  const [inputValue, setInputValue] = useState('')
  const inputId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  useFocusTrap(dialogRef, Boolean(state))

  useEffect(() => {
    const listener = () => {
      setState(pending)
      setInputValue(pending?.input?.defaultValue ?? '')
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const close = (value: DialogResult) => {
    const current = pending
    pending = null
    emitChange()
    current?.signal?.removeEventListener('abort', current.abortHandler as EventListener)
    current?.resolve(value)
  }

  useEffect(() => {
    if (!state) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(state.input ? null : false)
      } else if (event.key === 'Enter' && state.input) {
        event.preventDefault()
        close(inputValue)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!state) return null

  const isPrompt = Boolean(state.input)
  const confirmDisabled = isPrompt && inputValue.trim() === ''

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && state.showCancel) {
          close(state.input ? null : false)
        }
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <header className="confirm-dialog-header">
          <h2 id="confirm-dialog-title">{state.title ?? (state.danger ? '确认操作' : '提示')}</h2>
          {state.showCancel && (
            <button
              type="button"
              className="confirm-dialog-close"
              onClick={() => close(state.input ? null : false)}
              aria-label="关闭对话框"
            >
              ×
            </button>
          )}
        </header>
        <div className="confirm-dialog-body">
          <p className="confirm-dialog-message">{state.message}</p>
          {isPrompt && state.input && (
            <label className="confirm-dialog-input" htmlFor={inputId}>
              <span>{state.input.label ?? '输入内容'}</span>
              <input
                id={inputId}
                type="text"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder={state.input.placeholder}
                autoFocus
              />
            </label>
          )}
        </div>
        <footer className="confirm-dialog-actions">
          {state.showCancel && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => close(state.input ? null : false)}
            >
              {state.cancelText ?? '取消'}
            </button>
          )}
          <button
            type="button"
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            autoFocus={!isPrompt}
            disabled={confirmDisabled}
            onClick={() => close(isPrompt ? inputValue : true)}
          >
            {state.confirmText ?? '确定'}
          </button>
        </footer>
      </section>
    </div>
  )
}

import { useEffect, useState } from 'react'

export type ToastType = 'success' | 'info' | 'warning' | 'error'

interface Toast {
  id: number
  type: ToastType
  message: string
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()
let nextId = 1

function emit() {
  for (const listener of listeners) listener()
}

/** 弹出右上角轻提示，约 4.2 秒后自动消失 */
export function showToast(message: string, type: ToastType = 'success') {
  const id = nextId++
  toasts = [...toasts, { id, type, message }]
  emit()
  window.setTimeout(() => {
    toasts = toasts.filter((toast) => toast.id !== id)
    emit()
  }, 4200)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

/** Toast 宿主：在应用根部挂载一次 */
export function ToastHost() {
  const [list, setList] = useState<Toast[]>(toasts)

  useEffect(() => {
    const listener = () => setList(toasts)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (list.length === 0) return null

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`}>
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismissToast(toast.id)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import readmeSource from '../../README.md?raw'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null)
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const html = marked.parse(readmeSource) as string

  return (
    <div
      className="help-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
      >
        <header className="help-dialog-header">
          <div>
            <h2 id="help-dialog-title">使用说明</h2>
            <p>项目 README · 最新版 v{__APP_VERSION__}</p>
          </div>
          <button type="button" className="help-dialog-close" onClick={onClose} aria-label="关闭使用说明">
            ×
          </button>
        </header>
        <div className="help-dialog-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        <footer className="help-dialog-footer">
          <span>旅行轨迹记录与规划工具 · v{__APP_VERSION__}</span>
          <button type="button" className="btn-secondary" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  )
}

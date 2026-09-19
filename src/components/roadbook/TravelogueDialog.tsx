import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface TravelogueDialogProps {
  open: boolean
  text: string
  isDirty: boolean
  isReadonlyMode: boolean
  onRegenerate: () => void
  onSave: () => void
  onDownload: () => void
  onClose: () => void
}

function TravelogueDialog({
  open,
  text,
  isDirty,
  isReadonlyMode,
  onRegenerate,
  onSave,
  onDownload,
  onClose,
}: TravelogueDialogProps) {
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

  const html = useMemo(() => marked.parse(text) as string, [text])

  if (!open) return null

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
        className="help-dialog travelogue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="travelogue-dialog-title"
      >
        <header className="help-dialog-header">
          <div>
            <h2 id="travelogue-dialog-title">生成游记</h2>
            <p>根据旅程、路线、评分、复盘标签和备注自动生成，可保存或下载 Markdown。</p>
          </div>
          <button type="button" className="help-dialog-close" onClick={onClose} aria-label="关闭游记">
            ×
          </button>
        </header>
        <div className="help-dialog-body markdown-body travelogue-markdown" dangerouslySetInnerHTML={{ __html: html }} />
        <footer className="help-dialog-footer">
          <span className={isDirty ? 'travelogue-status dirty' : 'travelogue-status'}>
            {isDirty ? '内容有未保存的更改' : '已保存到当前旅程'}
          </span>
          <div className="travelogue-footer-actions">
            <button type="button" className="btn-secondary" onClick={onRegenerate}>
              重新生成
            </button>
            <button type="button" className="btn-secondary" onClick={onDownload}>
              下载 Markdown
            </button>
            {!isReadonlyMode && (
              <button type="button" className="btn-primary" onClick={onSave} disabled={!isDirty}>
                保存游记
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default TravelogueDialog

import { useEffect, useRef, useState } from 'react'
import { loadCandidatePhotoPreview } from '../services/photoCandidatePreview'
import type { PhotoLibraryScanFile } from '../types/photo'

const MAX_CANDIDATE_PREVIEW_BYTES = 40 * 1024 * 1024

interface PhotoCandidateCardProps {
  rootId: string
  file: PhotoLibraryScanFile
  checked: boolean
  disabled: boolean
  linked: boolean
  onToggle: () => void
}

function PhotoCandidateCard({ rootId, file, checked, disabled, linked, onToggle }: PhotoCandidateCardProps) {
  const cardRef = useRef<HTMLLabelElement | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const tooLargeToPreview = file.fingerprint.size > MAX_CANDIDATE_PREVIEW_BYTES

  useEffect(() => {
    const element = cardRef.current
    if (!element || !rootId || tooLargeToPreview) return
    let cancelled = false
    let objectUrl = ''

    const loadPreview = async () => {
      try {
        const preview = await loadCandidatePhotoPreview(rootId, file.relativePath)
        if (cancelled) return
        objectUrl = URL.createObjectURL(preview.blob)
        setPreviewUrl(objectUrl)
      } catch {
        if (!cancelled) setLoadFailed(true)
      }
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void loadPreview()
    }, { rootMargin: '160px' })
    observer.observe(element)

    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.relativePath, rootId, tooLargeToPreview])

  return (
    <label ref={cardRef} className={`photo-candidate-card${checked ? ' selected' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        aria-label={`选择照片 ${file.originalFilename}`}
      />
      <div className="photo-candidate-preview">
        {previewUrl ? (
          <img src={previewUrl} alt={file.originalFilename} />
        ) : (
          <span>{tooLargeToPreview ? '大图暂不预览' : (loadFailed ? '无法预览' : '正在读取预览…')}</span>
        )}
      </div>
      <div className="photo-candidate-meta">
        <strong title={file.relativePath}>{file.originalFilename}</strong>
        <small>{new Date(file.fingerprint.modifiedAt).toLocaleDateString('zh-CN')} · {(file.fingerprint.size / 1024 / 1024).toFixed(1)} MB</small>
        {linked && <span className="photo-candidate-linked-badge">已关联</span>}
      </div>
    </label>
  )
}

export default PhotoCandidateCard

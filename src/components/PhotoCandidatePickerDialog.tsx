import { useEffect, useMemo, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { PhotoLibraryScanFile } from '../types/photo'
import PhotoCandidateCard from './PhotoCandidateCard'

const PICKER_RENDER_BATCH_SIZE = 80

interface PhotoCandidatePickerDialogProps {
  rootId: string
  files: PhotoLibraryScanFile[]
  unlinkedRelativePaths: Set<string>
  initialSelectedPaths: Set<string>
  isImporting: boolean
  onClose: () => void
  onImport: (relativePaths: Set<string>) => void
}

function PhotoCandidatePickerDialog({
  rootId,
  files,
  unlinkedRelativePaths,
  initialSelectedPaths,
  isImporting,
  onClose,
  onImport,
}: PhotoCandidatePickerDialogProps) {
  const [selectedPaths, setSelectedPaths] = useState(() => new Set(initialSelectedPaths))
  const [visibleCount, setVisibleCount] = useState(PICKER_RENDER_BATCH_SIZE)
  const [filenameSearch, setFilenameSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('date-desc')
  const [unlinkedOnly, setUnlinkedOnly] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const dialogRef = useRef<HTMLElement | null>(null)
  useFocusTrap(dialogRef, true)
  const filteredFiles = useMemo(() => {
    const query = filenameSearch.trim().toLocaleLowerCase()
    const startTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
    const endTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
    return files
      .filter((file) => {
        if (query && !`${file.originalFilename} ${file.relativePath}`.toLocaleLowerCase().includes(query)) return false
        if (unlinkedOnly && !unlinkedRelativePaths.has(file.relativePath)) return false
        return file.fingerprint.modifiedAt >= startTime && file.fingerprint.modifiedAt <= endTime
      })
      .sort((left, right) => {
        if (sortOrder === 'name-asc' || sortOrder === 'name-desc') {
          const result = left.originalFilename.localeCompare(right.originalFilename, 'zh-CN', { numeric: true })
          return sortOrder === 'name-desc' ? -result : result
        }
        const result = left.fingerprint.modifiedAt - right.fingerprint.modifiedAt
        return sortOrder === 'date-desc' ? -result : result
      })
  }, [dateFrom, dateTo, filenameSearch, files, sortOrder, unlinkedOnly, unlinkedRelativePaths])
  const visibleFiles = filteredFiles.slice(0, visibleCount)

  useEffect(() => setVisibleCount(PICKER_RENDER_BATCH_SIZE), [dateFrom, dateTo, filenameSearch, sortOrder, unlinkedOnly])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isImporting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isImporting, onClose])

  const toggle = (relativePath: string) => {
    if (!unlinkedRelativePaths.has(relativePath)) return
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }

  const selectFilteredResults = () => {
    setSelectedPaths((current) => {
      const next = new Set(current)
      for (const file of filteredFiles) {
        if (unlinkedRelativePaths.has(file.relativePath)) next.add(file.relativePath)
      }
      return next
    })
  }

  return (
    <div className="photo-candidate-picker-backdrop" role="presentation">
      <section ref={dialogRef} className="photo-candidate-picker-dialog" role="dialog" aria-modal="true" aria-label="选择要关联的照片">
        <header className="photo-candidate-picker-header">
          <div>
            <h2>选择要关联的照片</h2>
            <p>共 {files.length} 张，已选择 {selectedPaths.size} 张。点击照片卡片即可选择。</p>
          </div>
          <div>
            <button type="button" onClick={selectFilteredResults} disabled={isImporting || filteredFiles.length === 0}>选择当前筛选结果</button>
            <button type="button" onClick={() => setSelectedPaths(new Set())} disabled={isImporting || selectedPaths.size === 0}>清空全部选择</button>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isImporting}>关闭</button>
          </div>
        </header>

        <div className="photo-candidate-picker-filters" aria-label="候选照片筛选">
          <label>
            <span>文件名</span>
            <input value={filenameSearch} onChange={(event) => setFilenameSearch(event.target.value)} placeholder="搜索文件名或路径" />
          </label>
          <label>
            <span>排序</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}>
              <option value="date-desc">拍摄日期：新到旧</option>
              <option value="date-asc">拍摄日期：旧到新</option>
              <option value="name-asc">文件名：A 到 Z</option>
              <option value="name-desc">文件名：Z 到 A</option>
            </select>
          </label>
          <label>
            <span>开始日期</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            <span>结束日期</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="photo-candidate-unlinked-filter">
            <input type="checkbox" checked={unlinkedOnly} onChange={(event) => setUnlinkedOnly(event.target.checked)} />
            <span>仅显示未关联照片</span>
          </label>
          <strong>当前显示 {filteredFiles.length} 张</strong>
        </div>

        <div className="photo-candidate-picker-grid">
          {visibleFiles.map((file) => (
            <PhotoCandidateCard
              key={file.relativePath}
              rootId={rootId}
              file={file}
              checked={selectedPaths.has(file.relativePath)}
              disabled={isImporting || !unlinkedRelativePaths.has(file.relativePath)}
              linked={!unlinkedRelativePaths.has(file.relativePath)}
              onToggle={() => toggle(file.relativePath)}
            />
          ))}
          {visibleFiles.length === 0 && <p className="photo-candidate-picker-empty">没有符合当前筛选条件的照片。</p>}
          {visibleCount < filteredFiles.length && (
            <button type="button" className="photo-candidate-picker-more" onClick={() => setVisibleCount((count) => count + PICKER_RENDER_BATCH_SIZE)}>
              加载更多照片（剩余 {filteredFiles.length - visibleCount} 张）
            </button>
          )}
        </div>

        <footer className="photo-candidate-picker-footer">
          <span>已选择 {selectedPaths.size} / {files.length} 张</span>
          <div>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isImporting}>取消</button>
            <button
              type="button"
              className="btn-primary"
              disabled={selectedPaths.size === 0 || isImporting}
              onClick={() => onImport(new Set(Array.from(selectedPaths).filter((path) => unlinkedRelativePaths.has(path))))}
            >
              {isImporting ? '正在关联…' : `关联选中的 ${selectedPaths.size} 张`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default PhotoCandidatePickerDialog

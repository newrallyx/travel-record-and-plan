import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ROAD_CLASS_LABELS } from '../../config/roadStatistics.ts'
import type { ConcurrentRoad, RoadClass, RouteRoadPart } from '../../types/roadStatistics.ts'
import ConcurrentRoadEditor from './ConcurrentRoadEditor.tsx'
import { isProvinceSensitiveRoadPart, PROVINCE_OPTIONS } from '../../utils/province.ts'
import { roadEvidenceText } from '../../utils/roadEvidence.ts'
import { getRoadPartDisplayName } from '../../utils/roadNamePresentation.ts'

export interface RoadPartCorrectionDraft {
  concurrentRoads: ConcurrentRoad[]
  roadClass: RoadClass
  routeRef: string
  provinceCode: string
  manualDirection: string
}

interface Props {
  parts: readonly RouteRoadPart[]
  drafts: readonly RoadPartCorrectionDraft[]
  disabled: boolean
  onDraftChange: (indices: number[], patch: Partial<RoadPartCorrectionDraft>) => void
  onSave: (indices: number[]) => void
  onRestore: (index: number) => void
  activePartIndex: number | null
  onLocatePart: (index: number | null) => void
  selected: ReadonlySet<number>
  onSelectionChange: (indices: Set<number>) => void
}

const ROAD_CLASS_OPTIONS = Object.keys(ROAD_CLASS_LABELS) as RoadClass[]

export default function RoadPartCorrectionTable({ parts, drafts, disabled, onDraftChange, onSave, onRestore, activePartIndex, onLocatePart, selected, onSelectionChange }: Props) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const anchor = useRef<number | null>(null)
  const allCheckbox = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; y: number; initial: Set<number>; active: boolean } | null>(null)
  const suppressClick = useRef(false)
  const selectableIndices = parts.map((_, index) => index)
  const editableSelectedIndices = [...selected].filter(index => parts[index] && !parts[index].manualAnnotationId)

  useEffect(() => {
    onSelectionChange(new Set())
    anchor.current = null
    drag.current = null
    setBox(null)
  }, [parts, onSelectionChange])

  useEffect(() => {
    if (allCheckbox.current) allCheckbox.current.indeterminate = selected.size > 0 && selected.size < parts.length
  }, [selected, parts.length])

  const toggle = (index: number, shiftKey: boolean) => {
    onLocatePart(null)
    const start = shiftKey && anchor.current !== null ? anchor.current : index
    const checked = !selected.has(index)
    const next = new Set(selected)
    for (let i = Math.min(start, index); i <= Math.max(start, index); i += 1) {
      if (checked) next.add(i)
      else next.delete(i)
    }
    onSelectionChange(next)
    anchor.current = index
  }

  const moveSelection = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || event.buttons !== 1 || disabled) return
    const container = event.currentTarget
    const bounds = container.getBoundingClientRect()
    const x = event.clientX - bounds.left + container.scrollLeft
    const y = event.clientY - bounds.top + container.scrollTop
    if (!current.active && Math.hypot(x - current.x, y - current.y) < 5) return
    current.active = true
    suppressClick.current = true
    container.setPointerCapture(event.pointerId)
    const rect = { left: Math.min(current.x, x), top: Math.min(current.y, y), width: Math.abs(x - current.x), height: Math.abs(y - current.y) }
    const next = new Set(current.initial)
    container.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row, index) => {
      const rowBounds = row.getBoundingClientRect()
      const top = rowBounds.top - bounds.top + container.scrollTop
      const left = rowBounds.left - bounds.left + container.scrollLeft
      if (top <= rect.top + rect.height && top + rowBounds.height >= rect.top
        && left <= rect.left + rect.width && left + rowBounds.width >= rect.left) next.add(index)
    })
    onLocatePart(null)
    onSelectionChange(next)
    setBox(rect)
    event.preventDefault()
  }

  const finishSelection = () => {
    drag.current = null
    setBox(null)
  }

  return (
    <>
      <div className="road-correction-selection-toolbar">
        <span aria-live="polite">已选 {selected.size} 段</span>
        <button type="button" className="btn-secondary" disabled={disabled || selected.size === 0} onClick={() => {
          onLocatePart(null)
          onSelectionChange(new Set())
          anchor.current = null
        }}>取消选择</button>
        <button type="button" className="btn-primary" disabled={disabled || editableSelectedIndices.length === 0} onClick={() => onSave(editableSelectedIndices.sort((a, b) => a - b))}>保存选中</button>
        <span>勾选多段、Shift 连选，或从选择列拖动框选；修改和保存仅作用于选中的可编辑片段。区间标注可选中高亮，请在上方标注列表修改或撤销。共线只作用于该片段，部分共线请在地图上选择区间。</span>
      </div>
      <div className="statistics-table-wrap road-correction-selection-wrap"
        onPointerDown={(event) => {
          suppressClick.current = false
          if (disabled || event.button !== 0 || event.pointerType !== 'mouse' || event.shiftKey) return
          const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-selection-index]')
          if (!cell) return
          const bounds = event.currentTarget.getBoundingClientRect()
          anchor.current = Number(cell.dataset.selectionIndex)
          drag.current = {
            x: event.clientX - bounds.left + event.currentTarget.scrollLeft,
            y: event.clientY - bounds.top + event.currentTarget.scrollTop,
            initial: new Set(selected), active: false,
          }
        }}
        onPointerMove={moveSelection}
        onPointerUp={finishSelection}
        onPointerCancel={finishSelection}
        onLostPointerCapture={finishSelection}
        onPointerLeave={() => { if (!drag.current?.active) finishSelection() }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <table className="statistics-table road-analysis-correction-table">
          <thead><tr>
            <th scope="col" className="road-correction-select-cell"><input ref={allCheckbox} type="checkbox" aria-label="全选道路片段" disabled={disabled || !parts.length}
              checked={parts.length > 0 && selected.size === parts.length}
              onChange={(event) => {
                onLocatePart(null)
                onSelectionChange(new Set(event.target.checked ? selectableIndices : []))
                anchor.current = null
              }} /></th>
            <th scope="col">道路片段</th><th scope="col">道路类型</th><th scope="col">主道路编号</th><th scope="col">省份</th><th scope="col">共线道路</th><th scope="col">操作</th>
          </tr></thead>
          <tbody>{parts.map((part, index) => {
            const rowDisabled = disabled || Boolean(part.manualAnnotationId)
            const draft = drafts[index] ?? { roadClass: part.roadClass, routeRef: part.routeRef ?? '', provinceCode: part.provinceCode ?? '', manualDirection: part.manualDirection ?? '', concurrentRoads: part.concurrentRoads ?? [] }
            const name = getRoadPartDisplayName(part)
            const provinceText = isProvinceSensitiveRoadPart(part)
              ? ` · ${part.provinceStatus === 'confirmed' ? part.provinceName ?? part.provinceCode ?? '已归属' : '省份待确认'}`
              : ''
            const update = (patch: Partial<RoadPartCorrectionDraft>) => onDraftChange(selected.has(index) ? editableSelectedIndices : [index], patch)
            return <tr key={index} className={[selected.has(index) ? 'is-selected' : '', activePartIndex === index ? 'is-map-active' : ''].filter(Boolean).join(' ')}
              onClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,select')) onLocatePart(index) }}>
              <td className="road-correction-select-cell" data-selection-index={index}>
                <input type="checkbox" aria-label={`选择第 ${index + 1} 段 ${name}`} checked={selected.has(index)} disabled={disabled}
                  onChange={() => {}} onClick={(event) => toggle(index, event.shiftKey)} />
              </td>
              <th scope="row"><button type="button" className="road-part-locate" title={roadEvidenceText(part)} aria-label={`在地图上定位 ${name}`} aria-pressed={activePartIndex === index} onClick={() => onLocatePart(index)}>{name}</button>
                <small className="statistics-route-names" title={roadEvidenceText(part)}>{Math.round(part.distanceMeters / 10) / 100} km{provinceText}{part.confidence === 'LOW' && <span> · 待核对</span>}</small>
                {part.manualAnnotationId && <small className="statistics-route-names">区间标注，请在上方标注列表修改或撤销。</small>}</th>
              <td><select aria-label={`第 ${index + 1} 段道路类型`} value={draft.roadClass} disabled={rowDisabled}
                onChange={(event) => update({ roadClass: event.target.value as RoadClass })}>
                {ROAD_CLASS_OPTIONS.map((value) => <option key={value} value={value}>{ROAD_CLASS_LABELS[value]}</option>)}
              </select></td>
              <td><input aria-label={`第 ${index + 1} 段道路编号`} value={draft.routeRef} placeholder="如 G65" disabled={rowDisabled}
                onChange={(event) => update({ routeRef: event.target.value })} /></td>
              <td><select aria-label={`第 ${index + 1} 段道路省份`} value={draft.provinceCode} disabled={rowDisabled || !isProvinceSensitiveRoadPart({ roadClass: draft.roadClass, routeRef: draft.routeRef })}
                onChange={(event) => update({ provinceCode: event.target.value })}>
                <option value="">{isProvinceSensitiveRoadPart({ roadClass: draft.roadClass, routeRef: draft.routeRef }) ? '待确认' : '不适用'}</option>
                {PROVINCE_OPTIONS.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
              </select></td>
              <td><ConcurrentRoadEditor label={`第 ${index + 1} 段共线道路`} roads={draft.concurrentRoads} disabled={rowDisabled}
                defaultClass={draft.roadClass} provinceCode={draft.provinceCode} onChange={concurrentRoads => update({ concurrentRoads })} /></td>
              <td><div className="road-analysis-correction-actions">
                <button type="button" className="btn-secondary" disabled={rowDisabled} onClick={() => onSave([index])}>保存修正</button>
                <button type="button" className="btn-secondary" disabled={rowDisabled || part.source !== 'MANUAL'} onClick={() => onRestore(index)}>恢复自动分类</button>
              </div></td>
            </tr>
          })}</tbody>
        </table>
        {box && <div className="road-correction-selection-box" style={box} />}
      </div>
    </>
  )
}

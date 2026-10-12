import type { ConcurrentRoad, RoadClass } from '../../types/roadStatistics.ts'
import { ROAD_CLASS_LABELS } from '../../config/roadStatistics.ts'
import { CONCURRENT_ROAD_CLASSES } from '../../utils/roadMemberships.ts'
import { isProvinceSensitiveRoadPart, PROVINCE_OPTIONS } from '../../utils/province.ts'

export default function ConcurrentRoadEditor({ roads, onChange, disabled, label, defaultClass, provinceCode }: {
  roads: readonly ConcurrentRoad[]
  onChange: (roads: ConcurrentRoad[]) => void
  disabled: boolean
  label: string
  defaultClass: RoadClass
  provinceCode?: string
}) {
  const update = (index: number, patch: Partial<ConcurrentRoad>) => onChange(roads.map((road, i) => i === index ? { ...road, ...patch } : road))
  return <div className="concurrent-road-editor" aria-label={label}>
    {roads.map((road, index) => {
      const sensitive = isProvinceSensitiveRoadPart(road)
      return <div className="concurrent-road-row" key={index}>
        <select aria-label={`${label}第 ${index + 1} 条类型`} value={road.roadClass} disabled={disabled}
          onChange={event => update(index, { roadClass: event.target.value as ConcurrentRoad['roadClass'] })}>
          {CONCURRENT_ROAD_CLASSES.map(value => <option key={value} value={value}>{ROAD_CLASS_LABELS[value]}</option>)}
        </select>
        <input aria-label={`${label}第 ${index + 1} 条编号`} placeholder="如 G316" value={road.routeRef} disabled={disabled}
          onChange={event => update(index, { routeRef: event.target.value })} />
        {sensitive && <select aria-label={`${label}第 ${index + 1} 条省份`} value={road.provinceCode ?? ''} disabled={disabled}
          onChange={event => update(index, { provinceCode: event.target.value })}>
          <option value="">请选择省份</option>
          {PROVINCE_OPTIONS.map(province => <option key={province.code} value={province.code}>{province.name}</option>)}
        </select>}
        <button type="button" className="btn-secondary" aria-label={`${label}移除第 ${index + 1} 条`} disabled={disabled}
          onClick={() => onChange(roads.filter((_, i) => i !== index))}>移除</button>
      </div>
    })}
    <button type="button" className="btn-secondary" disabled={disabled || !(CONCURRENT_ROAD_CLASSES as readonly string[]).includes(defaultClass)}
      onClick={() => onChange([...roads, { roadClass: defaultClass as ConcurrentRoad['roadClass'], routeRef: '', ...(provinceCode ? { provinceCode } : {}) }])}>添加共线道路</button>
  </div>
}

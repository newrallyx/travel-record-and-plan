import { useId, type ReactNode } from 'react'
import type { RouteColorMode } from '../../types/trip'
import {
  ROAD_TYPE_VISIBILITY_CATEGORIES,
  ROAD_TYPE_MAP_COLORS,
  ROAD_TYPE_MAP_LABELS,
  type RoadTypeVisibility,
} from './roadTypeVisualization'

interface RouteColorControlsProps {
  routeColorMode: RouteColorMode
  onChangeRouteColorMode: (mode: RouteColorMode) => void
  roadTypeVisibility: RoadTypeVisibility
  onChangeRoadTypeVisibility: (visibility: RoadTypeVisibility) => void
  canUseScoreColoring: boolean
  showScoreOptions?: boolean
  actions?: ReactNode
}

export default function RouteColorControls({
  routeColorMode, onChangeRouteColorMode, roadTypeVisibility, onChangeRoadTypeVisibility,
  canUseScoreColoring, showScoreOptions = true, actions,
}: RouteColorControlsProps) {
  const radioGroupName = useId()
  const areAllRoadTypesVisible = ROAD_TYPE_VISIBILITY_CATEGORIES.every(category => roadTypeVisibility[category])
  return (
      <div className="route-color-mode-section">
        <div className="route-color-toolbar">
          <span className="route-color-mode-title">着色</span>
          <div className="route-color-mode-options" role="radiogroup" aria-label="地图轨迹着色模式">
            <label className={`route-color-mode-option ${routeColorMode === 'default' ? 'active' : ''}`}>
              <input
                type="radio"
                name={radioGroupName}
                checked={routeColorMode === 'default'}
                onChange={() => onChangeRouteColorMode('default')}
              />
              默认
            </label>
            {showScoreOptions && <>
            <label className={`route-color-mode-option ${routeColorMode === 'scenic' ? 'active' : ''}`}>
              <input
                type="radio"
                name={radioGroupName}
                checked={routeColorMode === 'scenic'}
                disabled={!canUseScoreColoring}
                onChange={() => onChangeRouteColorMode('scenic')}
              />
              风景评分
            </label>
            <label className={`route-color-mode-option ${routeColorMode === 'difficulty' ? 'active' : ''}`}>
              <input
                type="radio"
                name={radioGroupName}
                checked={routeColorMode === 'difficulty'}
                disabled={!canUseScoreColoring}
                onChange={() => onChangeRouteColorMode('difficulty')}
              />
              难度评分
            </label>
            </>}
            <label className={`route-color-mode-option ${routeColorMode === 'roadType' ? 'active' : ''}`}>
              <input
                type="radio"
                name={radioGroupName}
                checked={routeColorMode === 'roadType'}
                onChange={() => onChangeRouteColorMode('roadType')}
              />
              道路类型
            </label>
          </div>
          <div className={`route-color-trailing-controls ${routeColorMode === 'roadType' ? 'has-road-type-controls' : ''}`}>
            {routeColorMode === 'roadType' && (
              <div className="road-type-visibility-controls" aria-label="道路类型显示开关">
                <div className="road-type-visibility-options">
                  {ROAD_TYPE_VISIBILITY_CATEGORIES.map((category) => (
                    <label className="road-type-visibility-option" key={category}>
                      <input
                        type="checkbox"
                        checked={roadTypeVisibility[category]}
                        onChange={(event) => onChangeRoadTypeVisibility({
                          ...roadTypeVisibility,
                          [category]: event.target.checked,
                        })}
                      />
                      <span className="road-type-color-chip" style={{ backgroundColor: ROAD_TYPE_MAP_COLORS[category] }} />
                      {ROAD_TYPE_MAP_LABELS[category]}
                    </label>
                  ))}
                </div>
                <div className="road-type-visibility-actions">
                  <button
                    type="button"
                    onClick={() => onChangeRoadTypeVisibility({
                      EXPRESSWAY: true,
                      NATIONAL_ROAD: true,
                      PROVINCIAL_ROAD: true,
                      OTHER: true,
                      UNKNOWN: true,
                    })}
                    disabled={areAllRoadTypesVisible}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeRoadTypeVisibility({
                      EXPRESSWAY: false,
                      NATIONAL_ROAD: false,
                      PROVINCIAL_ROAD: false,
                      OTHER: false,
                      UNKNOWN: false,
                    })}
                    disabled={!ROAD_TYPE_VISIBILITY_CATEGORIES.some((category) => roadTypeVisibility[category])}
                  >
                    全不选
                  </button>
                </div>
              </div>
            )}
            <details className="route-color-info">
              <summary aria-label="查看地图着色说明" title="查看地图着色说明">ⓘ</summary>
              <div className="route-color-info-popover">
                <p>着色模式互斥，同一时间最多开启一种可视化。</p>
                {routeColorMode === 'roadType' ? (
                  <p>灰色轨迹由“未知道路”开关控制，包含未知分类和缺少有效道路分析的路线；地图上的“道路统计”图例可查看当前范围与历史累计的待核实里程。</p>
                ) : showScoreOptions && !canUseScoreColoring ? (
                  <p>评分着色仅在选中具体旅程时可用；“全年旅程”和“全部旅程”会混合多次记录，已自动关闭评分着色。</p>
                ) : null}
              </div>
            </details>
          </div>
          {actions}
        </div>
      </div>
  )
}

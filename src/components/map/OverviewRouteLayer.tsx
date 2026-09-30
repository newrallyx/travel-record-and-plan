import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { ROAD_CLASS_LABELS } from '../../config/roadStatistics'
import type { RouteColorMode } from '../../types/trip'
import { createOverviewHoverIndex, overviewLineWeight, type OverviewLine } from './overviewAggregation'
import { offsetScreenLine, overviewDirectionMode, screenDirectionArrows, type ScreenPoint } from './overviewDirectionDisplay'
import { getRoadTypeMapCategory, roadTypeColorForClass, type RoadTypeVisibility } from './roadTypeVisualization'

const showDirections = false

/** Canvas-only display derivation. No persistence, route planning or cache writes. */
export function OverviewRouteLayer({ lines, routeColorMode, visibility }: {
  lines: OverviewLine[]; routeColorMode: RouteColorMode; visibility: RoadTypeVisibility
}) {
  const map = useMap()
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.2 })
    const base = L.layerGroup().addTo(map), focus = L.layerGroup().addTo(map)
    let selected: string | undefined
    const entries = new Map<string, { group: any; path?: any; pool: any[]; detailed: boolean }>()
    const candidates = lines.map((line) => ({ line, bounds: L.latLngBounds(line.positions) }))
    const hoverCountAt = createOverviewHoverIndex(lines)
    let previousZoom: number | undefined
    const toScreen = (positions: Array<[number, number]>): ScreenPoint[] => positions.map((p) => map.latLngToContainerPoint(p))
    const toGeo = (points: ScreenPoint[]): Array<[number, number]> => points.map((p) => {
      const ll = map.containerPointToLatLng([p.x, p.y]); return [ll.lat, ll.lng]
    })
    const tooltip = (line: OverviewLine, count = line.count) => {
      const el = document.createElement('div')
      el.className = 'map-direction-tooltip'
      const add = (text: string, strong = false) => {
        const row = document.createElement(strong ? 'strong' : 'div'); row.textContent = text; el.appendChild(row)
      }
      add([line.routeRef, line.roadName].filter(Boolean).join(' ') || ROAD_CLASS_LABELS[line.roadClass], true)
      const bothFlows = line.flowCounts && line.flowCounts.forward > 0 && line.flowCounts.reverse > 0
      add(`当前范围经过 ${count} 次（${count > line.count || bothFlows ? '双向合计，' : ''}按路线记录）`)
      add(line.roadClass === 'UNKNOWN' ? '道路类型待核实' : ROAD_CLASS_LABELS[line.roadClass])
      return el
    }
    const bindHoverTooltip = (path: any, line: OverviewLine) => {
      path.bindTooltip(() => tooltip(line), { sticky: true })
      const update = (event: any) => {
        const { lat, lng } = event.latlng
        path.setTooltipContent(tooltip(line, hoverCountAt(line, [lat, lng])))
      }
      path.on('mouseover', update)
      path.on('mousemove', update)
    }
    const colorFor = (line: OverviewLine) => routeColorMode === 'roadType' ? roadTypeColorForClass(line.roadClass) : '#4f46e5'
    const drawDirections = (line: OverviewLine, layer: any, interactive: boolean, pool: any[] = []) => {
      let used = 0
      const polyline = (positions: Array<[number, number]>, options: Record<string, unknown>) => {
        let path = pool[used]
        if (path && path.options.interactive !== options.interactive) { layer.removeLayer(path); pool[used] = path = undefined }
        if (path) path.setLatLngs(positions).setStyle(options)
        else { path = L.polyline(positions, { renderer, ...options }).addTo(layer); pool[used] = path }
        used++
        return path
      }
      const dirs = line.directions!
      const zoom = map.getZoom(), detailed = overviewDirectionMode(zoom) === 'directions'
      const fw = overviewLineWeight(dirs.forward.count, zoom), rw = overviewLineWeight(dirs.reverse.count, zoom)
      const offset = (fw + rw) / 4 + 2
      const both = dirs.forward.count > 0 && dirs.reverse.count > 0
      const center = toScreen(line.positions)
      const forward = toScreen(dirs.forward.positions), reverse = toScreen(dirs.reverse.positions)
      // Preserve actual carriageways when they are distinguishable; otherwise use a small display-only separation.
      const a = forward[Math.floor(forward.length / 2)], b = reverse[Math.floor(reverse.length / 2)]
      const separate = both && (!detailed || Math.hypot(a.x - b.x, a.y - b.y) < offset * 2)
      const size = map.getSize()
      for (const side of ['forward', 'reverse'] as const) {
        const direction = dirs[side]
        if (!direction.count) continue
        const points = separate ? offsetScreenLine(center, side === 'forward' ? offset : -offset)
          : side === 'forward' ? forward : reverse
        const lineLayer = polyline(toGeo(points), { color: colorFor(line),
          weight: side === 'forward' ? fw : rw, opacity: 0.95, interactive })
        if (interactive) bindHoverTooltip(lineLayer, line)
        const arrows = screenDirectionArrows(side === 'forward' ? points : [...points].reverse(), size.x, size.y)
        for (const arrow of arrows) {
          polyline(toGeo(arrow), { color: '#ffffff', weight: 2.5, opacity: 1, interactive: false })
          polyline(toGeo(arrow), { color: colorFor(line), weight: 1, opacity: 1, interactive: false })
        }
        if (!interactive && arrows.length) {
          const label = document.createElement('span')
          label.textContent = `${direction.destination ? `${direction.destination}方向` : side === 'forward' ? '①' : '②'} ${direction.count}次`
          L.tooltip({ permanent: true, direction: side === 'forward' ? 'bottom' : 'top',
            className: 'map-direction-label', offset: [0, side === 'forward' ? 7 : -7] })
            .setLatLng(toGeo([arrows[0][1]])[0]).setContent(label).addTo(layer)
        }
      }
      while (pool.length > used) layer.removeLayer(pool.pop())
    }
    const draw = () => {
      focus.clearLayers()
      const zoom = map.getZoom(), mode = overviewDirectionMode(zoom), bounds = map.getBounds().pad(0.2)
      const visible = new Set<string>()
      for (const { line, bounds: lineBounds } of candidates) {
        const category = getRoadTypeMapCategory(line.roadClass)
        if (routeColorMode === 'roadType' && !visibility[category ?? 'UNKNOWN']) continue
        if (!bounds.intersects(lineBounds)) continue
        visible.add(line.id)
        const detailed = Boolean(showDirections && line.directions && mode === 'directions')
        let entry = entries.get(line.id)
        if (entry && entry.detailed !== detailed) {
          base.removeLayer(entry.group); entries.delete(line.id); entry = undefined
        }
        if (!entry) {
          entry = { group: L.layerGroup().addTo(base), pool: [], detailed }
          entries.set(line.id, entry)
          if (!detailed) {
            const path = L.polyline(line.positions, { renderer, color: colorFor(line),
              weight: overviewLineWeight(line.count, zoom), opacity: 0.9 }).addTo(entry.group)
            entry.path = path
            bindHoverTooltip(path, line)
            if (showDirections && line.directions) {
              path.on('mouseover', () => {
                if (overviewDirectionMode(map.getZoom()) === 'focus' && !selected) {
                  path.setStyle({ opacity: 0 }); focus.clearLayers(); drawDirections(line, focus, false)
                }
              })
              path.on('mouseout', () => {
                if (!selected) { path.setStyle({ opacity: 0.9 }); focus.clearLayers() }
              })
              path.on('click', () => {
                if (overviewDirectionMode(map.getZoom()) !== 'focus') return
                selected = selected === line.id ? undefined : line.id
                path.closeTooltip()
                for (const item of entries.values()) item.path?.setStyle({ opacity: 0.9 })
                focus.clearLayers()
                if (selected) { path.setStyle({ opacity: 0 }); drawDirections(line, focus, false) }
              })
            }
          }
        }
        if (detailed) drawDirections(line, entry.group, true, entry.pool)
        else {
          if (previousZoom !== zoom) entry.path.setStyle({ weight: overviewLineWeight(line.count, zoom) })
          entry.path.setStyle({ opacity: selected === line.id && mode === 'focus' ? 0 : 0.9 })
          if (selected === line.id && mode === 'focus') drawDirections(line, focus, false)
        }
      }
      for (const [id, entry] of entries) {
        if (!visible.has(id)) { base.removeLayer(entry.group); entries.delete(id) }
      }
      previousZoom = zoom
    }
    draw()
    // Leaflet emits moveend after zoomend as well. One listener avoids rebuilding twice.
    map.on('moveend', draw)
    return () => { map.off('moveend', draw); base.remove(); focus.remove(); renderer.remove() }
  }, [map, lines, routeColorMode, visibility])
  return null
}

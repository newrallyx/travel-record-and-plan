import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as roadTypes from '../src/components/map/roadTypeVisualization.ts'
import * as segmentScores from '../src/utils/segmentScores.ts'
import { DIFFICULTY_SCORE_BANDS } from '../src/config/roadStatistics.ts'

function loadComponent(file, modules) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  const jsx = (type, props, key) => ({ type, props, key })
  vm.runInNewContext(code, { exports, window: {}, require: id => {
    if (id === 'react') return { useMemo: fn => fn(), useState: initial => [initial, () => {}], useEffect() {}, useId: () => 'color-controls' }
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    assert.ok(id in modules, `missing module ${id}`)
    return modules[id]
  } })
  return exports
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate))
  if (!tree?.props) return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)]
}

test('road controls toggle unknown independently and include it in select all / select none', () => {
  const { default: RouteColorControls } = loadComponent('../src/components/map/RouteColorControls.tsx', {
    './roadTypeVisualization': roadTypes,
  })
  let visibility = { ...roadTypes.DEFAULT_ROAD_TYPE_VISIBILITY }
  const render = () => RouteColorControls({ canUseScoreColoring: true, routeColorMode: 'roadType',
    roadTypeVisibility: visibility, onChangeRoadTypeVisibility: value => { visibility = value } })
  const options = nodes(render(), node => node.type === 'label' && node.props.className === 'road-type-visibility-option')
  assert.equal(options.length, 5)
  const unknown = options.find(node => node.key === 'UNKNOWN')
  assert.ok(unknown.props.children.includes('未知道路'))
  const checkbox = nodes(unknown, node => node.type === 'input')[0]
  assert.equal(checkbox.props.checked, true)
  checkbox.props.onChange({ target: { checked: false } })
  assert.equal(visibility.UNKNOWN, false)
  assert.equal(visibility.EXPRESSWAY, true)
  const button = label => nodes(render(), node => node.type === 'button' && node.props.children === label)[0]
  assert.equal(button('全选').props.disabled, false)
  button('全选').props.onClick()
  assert.ok(Object.values(visibility).every(Boolean))
  button('全不选').props.onClick()
  assert.ok(Object.values(visibility).every(value => value === false))
  assert.equal(button('全不选').props.disabled, true)
  visibility = { ...visibility, UNKNOWN: true }
  assert.equal(button('全不选').props.disabled, false)
  button('全不选').props.onClick()
  assert.equal(visibility.UNKNOWN, false)
})

test('detail tracks filter unknown parts and unanalyzed fallback lines without hiding known roads or other color modes', () => {
  const { MapCanvas } = loadComponent('../src/components/map/MapCanvas.tsx', {
    'react-leaflet': Object.fromEntries(['MapContainer', 'Marker', 'Pane', 'Popup', 'Polyline', 'TileLayer'].map(name => [name, name])),
    '../../config/roadStatistics': { DIFFICULTY_SCORE_BANDS },
    './roadTypeVisualization': roadTypes,
    './OverviewRouteLayer': {}, './overviewAggregation': {}, './MapControllers': {}, './mapIcons': {},
    './PhotoMarkerLayer': {}, '../../utils/distance': {},
    './trackUtils': { DEFAULT_MAP_CENTER: [34, 109], OVERVIEW_MAX_POINTS_PER_SEGMENT: 220,
      toLatLng: points => points.map(point => [point.lat, point.lon]) },
    './visibleTrackPoints': { getVisibleTrackPoints: () => [] },
    '../../utils/segmentScores': segmentScores,
  })
  const line = [{ lat: 34, lon: 109 }, { lat: 35, lon: 110 }]
  const part = roadClass => ({ roadClass, polyline: line.map(point => [point.lat, point.lon]) })
  const tracks = [
    { segmentId: 'mixed', line, roadParts: [part('EXPRESSWAY'), part('UNKNOWN'), part('URBAN_ROAD')] },
    { segmentId: 'unanalyzed', line },
    { segmentId: 'invalid-geometry', line, roadParts: [{ roadClass: 'UNKNOWN', polyline: [] }] },
  ]
  const render = (visibility, mode = 'roadType') => nodes(MapCanvas({
    filteredSegments: tracks.map(track => ({ id: track.segmentId })), renderedTracks: tracks,
    routeColorMode: mode, roadTypeVisibility: visibility, photos: [], controlPointIndices: [],
  }), node => node.type === 'Polyline')
  const all = roadTypes.DEFAULT_ROAD_TYPE_VISIBILITY
  assert.equal(render(all).length, 5)
  const hideUnknown = { ...all, UNKNOWN: false }
  assert.deepEqual(render(hideUnknown).map(node => node.props.pathOptions.color),
    [roadTypes.ROAD_TYPE_MAP_COLORS.EXPRESSWAY, roadTypes.ROAD_TYPE_MAP_COLORS.OTHER])
  const none = Object.fromEntries(roadTypes.ROAD_TYPE_VISIBILITY_CATEGORIES.map(key => [key, false]))
  assert.equal(render(none).length, 0)
  assert.equal(render({ ...none, UNKNOWN: true }).length, 3)
  for (const mode of ['default', 'scenic']) {
    const paths = render(none, mode)
    assert.equal(paths.length, 3)
    assert.ok(paths.every(path => path.props.pathOptions.weight === 2))
  }
  const difficultyPaths = render(none, 'difficulty')
  assert.equal(difficultyPaths.length, 6)
  const outlines = difficultyPaths.filter(path => path.props.pathOptions.interactive === false)
  const foreground = difficultyPaths.filter(path => path.props.pathOptions.interactive !== false)
  assert.equal(outlines.length, 3)
  assert.ok(outlines.every(path => path.props.pathOptions.weight === 5))
  assert.ok(foreground.every(path => path.props.pathOptions.weight === 3 && path.props.pathOptions.opacity === 1))
  assert.ok(foreground.every(path => path.props.pathOptions.color === segmentScores.UNRATED_SEGMENT_COLOR))
})

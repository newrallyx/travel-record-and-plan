export type ScreenPoint = { x: number; y: number }

/** Right-hand offset in screen pixels, bounded at bends to avoid long spikes. */
export function offsetScreenLine(points: ScreenPoint[], pixels: number): ScreenPoint[] {
  return points.map((p, i) => {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)]
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy)
    return length ? { x: p.x - dy / length * pixels, y: p.y + dx / length * pixels } : { ...p }
  })
}

/** Arrow chevrons follow path order; use reversed points for the opposite direction. */
export function screenDirectionArrows(points: ScreenPoint[], width: number, height: number): ScreenPoint[][] {
  const arrows: ScreenPoint[][] = []
  const add = (a: ScreenPoint, b: ScreenPoint, t: number) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
    if (!length || x < 0 || y < 0 || x > width || y > height) return
    const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length
    arrows.push([{ x: x - dx * 6 + dy * 4, y: y - dy * 6 - dx * 4 }, { x, y },
      { x: x - dx * 6 - dy * 4, y: y - dy * 6 + dx * 4 }])
  }
  let travelled = 0, next = 45
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    while (next <= travelled + length) {
      add(a, b, (next - travelled) / length)
      next += 140
      if (arrows.length >= 24) return arrows
    }
    travelled += length
  }
  // Short visible sections still need one arrow, irrespective of source sampling density.
  if (!arrows.length && travelled >= 16 && travelled < 90) {
    let remaining = travelled / 2
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y)
      if (length && remaining <= length) { add(a, b, remaining / length); break }
      remaining -= length
    }
  }
  return arrows
}

export function overviewDirectionMode(zoom: number): 'total' | 'focus' | 'directions' {
  return zoom < 10 ? 'total' : zoom < 14 ? 'focus' : 'directions'
}

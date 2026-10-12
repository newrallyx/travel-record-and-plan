import { LOCAL_API_CLIENT_HEADERS } from './localApiClient.ts'
import { getExportMapTiles, type ExportMapViewport, type RoadbookMapAsset } from '../utils/roadbookMapExport.ts'

/** 每次导出单独复用瓦片，四路并发；底图不完整时整张降级，避免半张空白地图。 */
export function createRoadbookBasemapLoader() {
  const cache = new Map<string, Promise<Blob>>()
  let unavailable = ''
  const readTile = (x: number, y: number, z: number) => {
    const key = `${z}/${x}/${y}`
    let request = cache.get(key)
    if (!request) {
      request = fetch(`/api/export/map-tile?x=${x}&y=${y}&z=${z}`, { headers: LOCAL_API_CLIENT_HEADERS, signal: AbortSignal.timeout(7000) })
        .then(async response => {
          if (!response.ok) throw new Error('网络或底图服务不可用')
          const blob = await response.blob()
          if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || !blob.size || blob.size > 1024 * 1024) throw new Error('底图瓦片无效')
          return blob
        })
      cache.set(key, request)
    }
    return request
  }
  return async (viewport: ExportMapViewport): Promise<RoadbookMapAsset> => {
    if (unavailable) return { failure: unavailable }
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width; canvas.height = viewport.height
    const context = canvas.getContext('2d')
    if (!context) return { failure: '当前环境无法生成底图快照' }
    context.fillStyle = '#f1f5f9'; context.fillRect(0, 0, canvas.width, canvas.height)
    const tiles = getExportMapTiles(viewport)
    let cursor = 0, failed = false
    const worker = async () => {
      while (cursor < tiles.length && !failed) {
        const tile = tiles[cursor++]
        try {
          const bitmap = await createImageBitmap(await readTile(tile.x, tile.y, tile.z))
          try { context.drawImage(bitmap, tile.left, tile.top, tile.size, tile.size) } finally { bitmap.close() }
        } catch { failed = true; unavailable = '网络或底图服务不可用，请联网后重新导出' }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, tiles.length) }, worker))
    if (failed) return { failure: unavailable }
    return { dataUrl: canvas.toDataURL('image/jpeg', .9) }
  }
}

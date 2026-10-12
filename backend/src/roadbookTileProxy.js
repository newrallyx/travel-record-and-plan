/** 只代理应用现有高德底图的固定瓦片地址，不接受任意上游 URL。 */
export function createRoadbookTileHandler({ fetchImpl = fetch } = {}) {
  return async (req, res) => {
    const { x, y, z } = req.query
    const valid = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
    if (![x, y, z].every(valid) || Number(z) < 1 || Number(z) > 18
      || Number(x) >= 2 ** Number(z) || Number(y) >= 2 ** Number(z)) {
      res.status(400).json({ message: '地图瓦片参数无效。' }); return
    }
    try {
      const url = `https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`
      const upstream = await fetchImpl(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })
      if (!upstream.ok || !/^image\/(png|jpeg|webp)(;|$)/i.test(upstream.headers.get('content-type') ?? '')) throw new Error('底图服务响应异常')
      const body = Buffer.from(await upstream.arrayBuffer())
      if (!body.length || body.length > 1024 * 1024) throw new Error('底图瓦片大小异常')
      res.setHeader('Content-Type', upstream.headers.get('content-type'))
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.status(200).send(body)
    } catch { res.status(502).json({ message: '地图底图获取失败，请检查网络后重试。' }) }
  }
}

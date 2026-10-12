import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileAtomically } from '../backend/src/atomicFile.js'

export function validateRoadbookPdfPayload(payload) {
  if (typeof payload?.html !== 'string' || !payload.html.startsWith('<!doctype html>') || Buffer.byteLength(payload.html, 'utf8') > 32 * 1024 * 1024) {
    throw new Error('路书内容无效或超过 32 MB，请减少精选照片。')
  }
  if (typeof payload.filename !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f]{1,120}\.pdf$/i.test(payload.filename)) {
    throw new Error('路书文件名无效。')
  }
  return { html: payload.html, filename: payload.filename }
}

/** 独立的沙箱窗口，无 preload、无外网、无持久化应用数据。 */
export async function renderRoadbookPdf(BrowserWindow, html) {
  const reportWindow = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `roadbook-export-${randomUUID()}` },
  })
  let timeout
  let temporaryDirectory
  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'roadbook-export-'))
    const htmlPath = join(temporaryDirectory, 'roadbook.html')
    const htmlUrl = pathToFileURL(htmlPath).href
    reportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    reportWindow.webContents.on('will-navigate', event => event.preventDefault())
    reportWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({
      cancel: !(details.url.startsWith('data:') || (details.resourceType === 'mainFrame' && details.url === htmlUrl)),
    }))
    // CSP 放在任何用户提供的 HTML 之前，禁止脚本、外部资源、框架和表单。
    const safeHtml = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' + html.slice('<!doctype html>'.length)
    // 整份路书含内嵌地图和照片，不能作为 data: 导航地址，否则可能超过 URL 长度限制。
    await writeFile(htmlPath, safeHtml, 'utf8')
    const rendering = async () => {
      await reportWindow.loadFile(htmlPath)
      await reportWindow.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode().catch(() => {})), ...Array.from(document.querySelectorAll('svg image'), element => { const image = new Image(); image.src = element.getAttribute('href') || ''; return image.decode().catch(() => {}); })]).then(() => true)`)
      return reportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true })
    }
    return await Promise.race([rendering(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('PDF 生成超时，请减少精选照片后重试。')), 30000) })])
  } finally {
    clearTimeout(timeout)
    if (!reportWindow.isDestroyed()) reportWindow.destroy()
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function saveRoadbookPdf({ BrowserWindow, dialog, parent, payload }) {
  const { html, filename } = validateRoadbookPdfPayload(payload)
  const options = { title: '导出旅行路书 PDF', defaultPath: filename, filters: [{ name: 'PDF 路书', extensions: ['pdf'] }] }
  const chosen = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (chosen.canceled || !chosen.filePath) return { cancelled: true }
  const pdf = await renderRoadbookPdf(BrowserWindow, html)
  await writeFileAtomically(chosen.filePath, pdf)
  return { cancelled: false, filename }
}

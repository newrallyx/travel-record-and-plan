import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createApp } from '../backend/src/app.js'
import { loadBackendEnv, resolveAmapWebApiKey } from '../backend/src/env.js'
import { inspectAuthorizedPhoto, isTrustedDesktopUrl, readAuthorizedPhoto } from './photoLibraryAccess.mjs'
import { reconcilePhotoLibraryScan, scanPhotoLibraryRoot } from './photoLibraryScanner.mjs'
import { PhotoMetadataStore } from './photoMetadataStore.mjs'
import { PhotoThumbnailCache } from './photoThumbnailCache.mjs'
import { commitPhotoContentRefresh } from './photoContentStore.mjs'
import {
  commitPreparedDesktopBackup,
  prepareDesktopBackupZip,
  readTripBackupJsonFile,
  writeDesktopBackupZip,
} from './photoBackupArchive.mjs'
import { isAllowedExternalUrl, resolveDesktopPort, resolveDesktopRuntimeProfile } from './runtimeProfile.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const runtimeProfile = resolveDesktopRuntimeProfile(app.getName())
if (runtimeProfile.userDataDirectoryName) {
  app.setPath('userData', path.join(app.getPath('appData'), runtimeProfile.userDataDirectoryName))
}

let mainWindow = null
let server = null
let photoMetadataStore = null
let photoThumbnailCache = null
const authorizedPhotoLibraryRoots = new Map()
const pendingBackupImports = new Map()
const activePhotoLibraryScans = new Map()

function getDesktopPort() {
  return resolveDesktopPort(process.env.ROADTRIP_DESKTOP_PORT, runtimeProfile.defaultPort)
}

function getExternalEnvPaths() {
  const paths = []

  if (app.isPackaged) {
    paths.push(
      path.join(path.dirname(process.execPath), '.env'),
      path.join(path.dirname(process.execPath), '.env.local'),
      path.join(process.resourcesPath, '.env'),
      path.join(process.resourcesPath, '.env.local'),
    )
  }

  return paths
}

function getStaticDir() {
  return path.join(projectRoot, 'dist')
}

function getApiKeyConfigPath() {
  return path.join(app.getPath('userData'), 'amap-key.json')
}

function getPhotoMetadataStore() {
  if (!photoMetadataStore) {
    photoMetadataStore = new PhotoMetadataStore(path.join(app.getPath('userData'), 'photo-library.json'))
  }
  return photoMetadataStore
}

function getPhotoThumbnailCache() {
  if (!photoThumbnailCache) {
    photoThumbnailCache = new PhotoThumbnailCache(path.join(app.getPath('userData'), 'photo-thumbnails'))
  }
  return photoThumbnailCache
}

async function hydrateAuthorizedPhotoLibraryRoots() {
  const roots = await getPhotoMetadataStore().listRoots()
  authorizedPhotoLibraryRoots.clear()
  roots.forEach((root) => authorizedPhotoLibraryRoots.set(root.id, root))
}

function getDesktopOrigin() {
  return `http://127.0.0.1:${getDesktopPort()}`
}

function assertTrustedPhotoLibrarySender(event) {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
  if (!isTrustedDesktopUrl(senderUrl, getDesktopOrigin())) {
    throw new Error('Photo library access is only available to the local desktop application.')
  }
}

function normalizeReferencedPhotoIds(value) {
  if (!Array.isArray(value)) throw new Error('Referenced photo ids must be an array.')
  return new Set(value.map((photoId) => {
    if (typeof photoId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(photoId)) {
      throw new Error('Referenced photo id contains unsupported characters.')
    }
    return photoId
  }))
}

async function getPhotoLibraryRootOrThrow(rootId) {
  const root = await getPhotoMetadataStore().getRoot(rootId)
  if (!root) throw new Error('Photo library root was not found.')
  return root
}

function photoLibraryPathsOverlap(leftPath, rightPath) {
  const left = process.platform === 'win32' ? path.normalize(leftPath).toLowerCase() : path.normalize(leftPath)
  const right = process.platform === 'win32' ? path.normalize(rightPath).toLowerCase() : path.normalize(rightPath)
  const leftToRight = path.relative(left, right)
  const rightToLeft = path.relative(right, left)
  return leftToRight === ''
    || (leftToRight !== '..' && !leftToRight.startsWith(`..${path.sep}`) && !path.isAbsolute(leftToRight))
    || (rightToLeft !== '..' && !rightToLeft.startsWith(`..${path.sep}`) && !path.isAbsolute(rightToLeft))
}

function registerPhotoLibraryIpc() {
  ipcMain.handle('photo-library:choose-root', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const tripId = typeof payload?.tripId === 'string' ? payload.tripId.trim() : ''
    if (!tripId) throw new Error('A trip must be selected before adding a photo library.')
    if (Array.from(authorizedPhotoLibraryRoots.values()).some((root) => root.tripId === tripId)) {
      throw new Error('This trip already has a photo library folder.')
    }
    const options = {
      title: '选择本地照片库文件夹',
      properties: ['openDirectory'],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null

    const rootPath = await realpath(result.filePaths[0])
    const existingRoot = Array.from(authorizedPhotoLibraryRoots.values()).find((root) => root.path === rootPath)
    if (existingRoot) {
      if (existingRoot.tripId && existingRoot.tripId !== tripId) {
        throw new Error('This photo library folder already belongs to another trip.')
      }
      if (!existingRoot.tripId) {
        const claimedRoot = await getPhotoMetadataStore().saveRoot({
          ...existingRoot,
          tripId,
          updatedAt: new Date().toISOString(),
        })
        authorizedPhotoLibraryRoots.set(claimedRoot.id, claimedRoot)
        return claimedRoot
      }
      return existingRoot
    }
    if (Array.from(authorizedPhotoLibraryRoots.values()).some((root) => photoLibraryPathsOverlap(root.path, rootPath))) {
      throw new Error('The selected folder overlaps an existing photo library. Choose a separate folder.')
    }

    const timestamp = new Date().toISOString()
    const root = {
      id: randomUUID(),
      tripId,
      name: path.basename(rootPath),
      path: rootPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const savedRoot = await getPhotoMetadataStore().saveRoot(root)
    authorizedPhotoLibraryRoots.set(savedRoot.id, savedRoot)
    return savedRoot
  })

  ipcMain.handle('photo-library:list-roots', async (event) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().listRoots()
  })

  ipcMain.handle('photo-library:get-root-summary', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const root = await getPhotoLibraryRootOrThrow(payload?.rootId)
    const photos = await getPhotoMetadataStore().listPhotosByRoot(root.id)
    let available = true
    try {
      await realpath(root.path)
    } catch {
      available = false
    }
    return { root, photoCount: photos.length, available }
  })

  ipcMain.handle('photo-library:get-root', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().getRoot(payload?.rootId)
  })

  ipcMain.handle('photo-library:update-root', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const existingRoot = await getPhotoMetadataStore().getRoot(payload?.rootId)
    if (!existingRoot) throw new Error('Photo library root was not found.')
    if (existingRoot.tripId && payload?.tripId && existingRoot.tripId !== payload.tripId) {
      throw new Error('A photo library folder cannot be moved to another trip.')
    }
    const updatedRoot = await getPhotoMetadataStore().saveRoot({
      ...existingRoot,
      name: payload?.name,
      tripId: payload?.tripId ?? existingRoot.tripId,
      updatedAt: new Date().toISOString(),
    })
    authorizedPhotoLibraryRoots.set(updatedRoot.id, updatedRoot)
    return updatedRoot
  })

  ipcMain.handle('photo-library:delete-root', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    await getPhotoMetadataStore().deleteRoot(payload?.rootId)
    authorizedPhotoLibraryRoots.delete(payload?.rootId)
  })

  ipcMain.handle('photo-library:list-photos-by-segment', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().listPhotosBySegment(payload?.segmentId)
  })

  ipcMain.handle('photo-library:list-photos', async (event) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().listPhotos()
  })

  ipcMain.handle('photo-library:get-photo', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().getPhoto(payload?.photoId)
  })

  ipcMain.handle('photo-library:save-photo', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().savePhoto(payload?.photo)
  })

  ipcMain.handle('photo-library:save-photos', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    return getPhotoMetadataStore().savePhotos(payload?.photos)
  })

  ipcMain.handle('photo-library:delete-photo', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    await getPhotoThumbnailCache().delete(payload?.photoId)
    await getPhotoMetadataStore().deletePhoto(payload?.photoId)
  })

  ipcMain.handle('photo-library:delete-trip-data', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const tripId = typeof payload?.tripId === 'string' ? payload.tripId.trim() : ''
    if (!tripId) throw new Error('Trip id must be a non-empty string.')
    if (!Array.isArray(payload?.segmentIds)) throw new Error('Segment ids must be an array.')
    const segmentIds = payload.segmentIds.map((segmentId) => {
      const normalized = typeof segmentId === 'string' ? segmentId.trim() : ''
      if (!normalized) throw new Error('Segment id must be a non-empty string.')
      return normalized
    })

    const state = await getPhotoMetadataStore().read()
    const deletedRootIdSet = new Set(
      state.roots.filter((root) => root.tripId === tripId).map((root) => root.id),
    )
    const deletedSegmentIdSet = new Set(segmentIds)
    const plannedPhotoIds = state.photos
      .filter((photo) => (
        deletedRootIdSet.has(photo.libraryRootId) || deletedSegmentIdSet.has(photo.segmentId)
      ))
      .map((photo) => photo.id)
    await Promise.all(plannedPhotoIds.map((photoId) => getPhotoThumbnailCache().delete(photoId)))

    const result = await getPhotoMetadataStore().deleteTripData(tripId, segmentIds)
    const plannedPhotoIdSet = new Set(plannedPhotoIds)
    await Promise.all(result.deletedPhotoIds
      .filter((photoId) => !plannedPhotoIdSet.has(photoId))
      .map((photoId) => getPhotoThumbnailCache().delete(photoId)))
    for (const rootId of result.deletedRootIds) authorizedPhotoLibraryRoots.delete(rootId)
    return result
  })

  ipcMain.handle('photo-library:cleanup-orphans', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const referencedPhotoIds = normalizeReferencedPhotoIds(payload?.referencedPhotoIds)
    const allPhotos = await getPhotoMetadataStore().listPhotos()
    const metadataPhotoIds = new Set(allPhotos.map((photo) => photo.id))
    const missingReferencedPhotoIds = Array.from(referencedPhotoIds)
      .filter((photoId) => !metadataPhotoIds.has(photoId))
    const orphanPhotoIds = allPhotos
      .filter((photo) => !referencedPhotoIds.has(photo.id))
      .map((photo) => photo.id)

    const remainingPhotoIds = allPhotos
      .filter((photo) => !orphanPhotoIds.includes(photo.id))
      .map((photo) => photo.id)
    const thumbnailCleanup = await getPhotoThumbnailCache().cleanup(remainingPhotoIds)
    const deletedMetadataPhotoIds = await getPhotoMetadataStore().deletePhotos(orphanPhotoIds)

    return {
      deletedMetadataPhotoIds,
      deletedThumbnailPhotoIds: thumbnailCleanup.deletedThumbnailIds,
      deletedTempFileCount: thumbnailCleanup.deletedTempFileCount,
      missingReferencedPhotoIds,
    }
  })

  ipcMain.handle('photo-library:check-photo-availability', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const photo = await getPhotoMetadataStore().getPhoto(payload?.photoId)
    if (!photo) throw new Error('Linked photo was not found.')
    const root = await getPhotoLibraryRootOrThrow(photo.libraryRootId)

    try {
      await realpath(root.path)
    } catch {
      return { photoId: photo.id, availability: 'root-unavailable' }
    }

    try {
      const inspected = await inspectAuthorizedPhoto(root.path, photo.relativePath)
      const currentFingerprint = { size: inspected.size, modifiedAt: inspected.modifiedAt }
      const availability = currentFingerprint.size === photo.fingerprint.size
        && currentFingerprint.modifiedAt === photo.fingerprint.modifiedAt
        ? 'available'
        : 'changed'
      return { photoId: photo.id, availability, currentFingerprint }
    } catch (error) {
      if (error?.code === 'ENOENT') return { photoId: photo.id, availability: 'missing' }
      throw error
    }
  })

  ipcMain.handle('photo-library:read-thumbnail', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const data = await getPhotoThumbnailCache().read(payload?.photoId)
    return data ? { data, mimeType: 'image/webp' } : null
  })

  ipcMain.handle('photo-library:save-thumbnail', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    if (payload?.mimeType !== 'image/webp') throw new Error('Thumbnail must use the image/webp MIME type.')
    return getPhotoThumbnailCache().save(payload?.photoId, payload?.data)
  })

  ipcMain.handle('photo-library:delete-thumbnail', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    await getPhotoThumbnailCache().delete(payload?.photoId)
  })

  ipcMain.handle('photo-library:scan-root', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const root = await getPhotoLibraryRootOrThrow(payload?.rootId)
    const requestId = typeof payload?.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.requestId)
      ? payload.requestId
      : randomUUID()
    const controller = new AbortController()
    activePhotoLibraryScans.set(requestId, controller)
    try {
      const scan = await scanPhotoLibraryRoot(root.path, {
        signal: controller.signal,
        onProgress: (progress) => event.sender.send('photo-library:scan-progress', {
          requestId,
          rootId: root.id,
          ...progress,
        }),
      })
      if (scan.status !== 'available') {
        return {
          rootId: root.id,
          ...scan,
          newFiles: [],
          unchangedPhotoIds: [],
          changed: [],
          missing: [],
          relocationCandidates: [],
        }
      }

      const indexedPhotos = await getPhotoMetadataStore().listPhotosByRoot(root.id)
      const reconciliation = reconcilePhotoLibraryScan(indexedPhotos, scan.files)
      return { rootId: root.id, ...scan, ...reconciliation }
    } finally {
      activePhotoLibraryScans.delete(requestId)
    }
  })

  ipcMain.handle('photo-library:cancel-scan', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
    activePhotoLibraryScans.get(requestId)?.abort()
  })

  ipcMain.handle('photo-library:relink-root', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const root = await getPhotoLibraryRootOrThrow(payload?.rootId)
    const options = {
      title: `重新关联照片库：${root.name}`,
      properties: ['openDirectory'],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null

    const nextPath = await realpath(result.filePaths[0])
    if (Array.from(authorizedPhotoLibraryRoots.values()).some((candidate) => (
      candidate.id !== root.id && photoLibraryPathsOverlap(candidate.path, nextPath)
    ))) {
      throw new Error('The selected folder overlaps another photo library.')
    }
    const updatedRoot = await getPhotoMetadataStore().relinkRoot(root.id, nextPath, new Date().toISOString())
    authorizedPhotoLibraryRoots.set(updatedRoot.id, updatedRoot)
    return updatedRoot
  })

  ipcMain.handle('photo-library:repair-photo-path', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const photo = await getPhotoMetadataStore().getPhoto(payload?.photoId)
    if (!photo) throw new Error('Linked photo was not found.')
    const root = await getPhotoLibraryRootOrThrow(photo.libraryRootId)
    const relativePath = typeof payload?.relativePath === 'string' ? payload.relativePath : ''
    const inspected = await inspectAuthorizedPhoto(root.path, relativePath)
    return getPhotoMetadataStore().savePhoto({
      ...photo,
      relativePath,
      originalFilename: path.basename(inspected.photoPath),
      mimeType: inspected.mimeType,
      fingerprint: {
        size: inspected.size,
        modifiedAt: inspected.modifiedAt,
      },
      updatedAt: new Date().toISOString(),
    })
  })

  ipcMain.handle('photo-library:choose-replacement', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const photo = await getPhotoMetadataStore().getPhoto(payload?.photoId)
    if (!photo) throw new Error('Linked photo was not found.')
    const root = await getPhotoLibraryRootOrThrow(photo.libraryRootId)
    const options = {
      title: `重新关联照片：${photo.originalFilename}`,
      defaultPath: root.path,
      properties: ['openFile'],
      filters: [{ name: '支持的照片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null

    const selectedPath = await realpath(result.filePaths[0])
    const relativePath = path.relative(await realpath(root.path), selectedPath)
    await inspectAuthorizedPhoto(root.path, relativePath)
    return relativePath
  })

  ipcMain.handle('photo-library:refresh-photo-content', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const photo = await getPhotoMetadataStore().getPhoto(payload?.photoId)
    if (!photo) throw new Error('Linked photo was not found.')
    const root = await getPhotoLibraryRootOrThrow(photo.libraryRootId)
    const relativePath = typeof payload?.relativePath === 'string' ? payload.relativePath : ''
    const inspected = await inspectAuthorizedPhoto(root.path, relativePath)
    return commitPhotoContentRefresh({
      photo,
      inspected,
      payload: { ...payload, relativePath },
      metadataStore: getPhotoMetadataStore(),
      thumbnailCache: getPhotoThumbnailCache(),
    })
  })

  ipcMain.handle('photo-library:read-photo', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const rootId = typeof payload?.rootId === 'string' ? payload.rootId : ''
    const relativePath = typeof payload?.relativePath === 'string' ? payload.relativePath : ''
    const root = authorizedPhotoLibraryRoots.get(rootId)
    if (!root) {
      throw new Error('Photo library root is not authorized for this session.')
    }

    return readAuthorizedPhoto(root.path, relativePath)
  })
}

function registerDesktopBackupIpc() {
  ipcMain.handle('desktop-backup:export-zip', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const filename = typeof payload?.filename === 'string' && payload.filename.trim()
      ? path.basename(payload.filename.trim()).replace(/\.json$/i, '.zip')
      : `trip-review-backup-${Date.now()}.zip`
    const options = {
      title: '导出完整备份 ZIP',
      defaultPath: filename.endsWith('.zip') ? filename : `${filename}.zip`,
      filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { cancelled: true }

    const summary = await writeDesktopBackupZip({
      zipPath: result.filePath,
      tripBackupJson: payload?.tripBackupJson,
      referencedPhotoIds: normalizeReferencedPhotoIds(payload?.referencedPhotoIds),
      metadataStore: getPhotoMetadataStore(),
      thumbnailCache: getPhotoThumbnailCache(),
    })
    return { cancelled: false, ...summary }
  })

  ipcMain.handle('desktop-backup:import-file', async (event) => {
    assertTrustedPhotoLibrarySender(event)
    const options = {
      title: '导入备份（ZIP 或 JSON）',
      properties: ['openFile'],
      filters: [
        { name: '备份文件', extensions: ['zip', 'json'] },
        { name: '完整 ZIP 备份', extensions: ['zip'] },
        { name: '旧版 JSON 备份', extensions: ['json'] },
      ],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }

    const backupPath = result.filePaths[0]
    const extension = path.extname(backupPath).toLowerCase()
    if (extension === '.json') {
      return {
        cancelled: false,
        format: 'json',
        tripBackupJson: await readTripBackupJsonFile(backupPath),
        photoRootCount: 0,
        photoCount: 0,
        thumbnailCount: 0,
      }
    }
    if (extension !== '.zip') throw new Error('请选择 ZIP 或 JSON 备份文件。')

    const prepared = await prepareDesktopBackupZip({
      zipPath: backupPath,
      tempParentPath: app.getPath('temp'),
      thumbnailCache: getPhotoThumbnailCache(),
    })
    const importToken = randomUUID()
    pendingBackupImports.set(importToken, prepared)
    return {
      cancelled: false,
      format: 'zip',
      importToken,
      tripBackupJson: prepared.tripBackupJson,
      photoRootCount: prepared.photoRootCount,
      photoCount: prepared.photoCount,
      thumbnailCount: prepared.thumbnailCount,
      photoIds: prepared.photoIds,
    }
  })

  ipcMain.handle('desktop-backup:commit-import', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const importToken = typeof payload?.importToken === 'string' ? payload.importToken : ''
    const prepared = pendingBackupImports.get(importToken)
    if (!prepared) throw new Error('Prepared backup import was not found or has expired.')
    await commitPreparedDesktopBackup({
      prepared,
      metadataStore: getPhotoMetadataStore(),
      thumbnailCache: getPhotoThumbnailCache(),
    })
    pendingBackupImports.delete(importToken)
    try {
      await hydrateAuthorizedPhotoLibraryRoots()
    } catch (error) {
      console.error('[backup] Backup restored, but photo root authorization refresh failed.', error)
    }
  })

  ipcMain.handle('desktop-backup:cancel-import', async (event, payload) => {
    assertTrustedPhotoLibrarySender(event)
    const importToken = typeof payload?.importToken === 'string' ? payload.importToken : ''
    pendingBackupImports.delete(importToken)
  })
}

function startLocalServer() {
  loadBackendEnv({
    extraPaths: getExternalEnvPaths(),
    includeDefaultPaths: !app.isPackaged,
  })

  const { key: amapWebApiKey, source } = resolveAmapWebApiKey(process.env)
  if (!amapWebApiKey) {
    console.warn('[desktop] AMAP Web API key not loaded. Expected AMAP_WEB_API_KEY, AMAP_WEB_KEY or AMAP_KEY.')
  } else {
    console.log(`[desktop] AMAP Web API key loaded from ${source}`)
  }

  const expressApp = createApp({
    amapWebApiKey,
    staticDir: getStaticDir(),
    apiKeyConfigPath: getApiKeyConfigPath(),
    allowedOrigins: [getDesktopOrigin()],
  })
  const desktopPort = getDesktopPort()

  return new Promise((resolve, reject) => {
    server = createServer(expressApp)
    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        reject(new Error(`桌面服务端口 ${desktopPort} 已被占用，请关闭正在运行的程序后重试。`))
        return
      }

      reject(error)
    })
    server.listen(desktopPort, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${desktopPort}`)
    })
  })
}

async function createMainWindow() {
  const appUrl = await startLocalServer()

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: runtimeProfile.windowTitle,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedDesktopUrl(url, getDesktopOrigin())) {
      event.preventDefault()
    }
  })

  await mainWindow.loadURL(appUrl)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  registerPhotoLibraryIpc()
  registerDesktopBackupIpc()

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    try {
      await hydrateAuthorizedPhotoLibraryRoots()
    } catch (error) {
      console.error('[desktop] Failed to load photo library metadata. Existing metadata will not be overwritten.', error)
    }

    createMainWindow().catch((error) => {
      console.error(error)
      dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error))
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  server?.close()
})

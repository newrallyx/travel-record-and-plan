import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import archiver from 'archiver'
import extractZip from 'extract-zip'
import {
  normalizePhotoLibraryState,
  PHOTO_LIBRARY_SCHEMA,
  PHOTO_LIBRARY_VERSION,
} from './photoMetadataStore.mjs'

export const DESKTOP_BACKUP_SCHEMA = 'roadtrip-desktop-backup'
export const DESKTOP_BACKUP_VERSION = 1
const MAX_BACKUP_ZIP_SIZE = 1024 * 1024 * 1024
const MAX_BACKUP_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024
const MAX_JSON_FILE_SIZE = 100 * 1024 * 1024
// Route geometry can exceed the metadata limit; use the same limit for ZIP and JSON trips.
const MAX_TRIP_JSON_FILE_SIZE = 512 * 1024 * 1024
const SUPPORTED_TRIP_BACKUP_VERSIONS = [1, 2, 3]

async function readFileLimited(filePath, maxSize = MAX_JSON_FILE_SIZE) {
  const fileStats = await stat(filePath)
  if (!fileStats.isFile() || fileStats.size > maxSize) {
    throw new Error(`备份文件 ${path.basename(filePath)} 不是普通文件或超过 ${Math.round(maxSize / 1024 / 1024)} MB 大小限制。`)
  }
  return readFile(filePath)
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

function validateTripBackupJson(json) {
  const parsed = parseJson(Buffer.from(json), 'Trip backup')
  if (
    parsed?.schema !== 'roadtrip-retrospective-backup'
    || !SUPPORTED_TRIP_BACKUP_VERSIONS.includes(parsed?.version)
    || !Array.isArray(parsed?.data?.tripReview?.trips)
    || !Array.isArray(parsed?.data?.segmentRoutes)
  ) {
    throw new Error('Trip backup schema or version is unsupported.')
  }
  return parsed
}

function validateImportableTripBackupJson(json) {
  const parsed = parseJson(Buffer.from(json), 'Trip backup')
  if (Array.isArray(parsed?.trips)) return parsed
  if (
    parsed?.schema === 'roadtrip-retrospective-backup'
    && SUPPORTED_TRIP_BACKUP_VERSIONS.includes(parsed?.version)
    && Array.isArray(parsed?.data?.tripReview?.trips)
  ) {
    return parsed
  }
  throw new Error('Trip backup schema or version is unsupported.')
}

export async function readTripBackupJsonFile(jsonPath) {
  if (typeof jsonPath !== 'string' || !path.isAbsolute(jsonPath)) {
    throw new Error('Backup JSON path must be absolute.')
  }
  const tripBackupJson = (await readFileLimited(jsonPath, MAX_TRIP_JSON_FILE_SIZE)).toString('utf8')
  validateImportableTripBackupJson(tripBackupJson)
  return tripBackupJson
}

function createArchive(zipPath) {
  const output = createWriteStream(zipPath)
  const archive = archiver('zip', { zlib: { level: 9 } })
  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (error) => {
      if (error?.code !== 'ENOENT') reject(error)
    })
  })
  archive.pipe(output)
  return { archive, completed }
}

export async function writeDesktopBackupZip({
  zipPath,
  tripBackupJson,
  referencedPhotoIds,
  metadataStore,
  thumbnailCache,
  exportedAt = new Date(),
}) {
  if (typeof zipPath !== 'string' || !path.isAbsolute(zipPath)) throw new Error('Backup ZIP path must be absolute.')
  if (typeof tripBackupJson !== 'string' || !tripBackupJson.trim()) throw new Error('Trip backup JSON is required.')
  if (Buffer.byteLength(tripBackupJson, 'utf8') > MAX_TRIP_JSON_FILE_SIZE) {
    throw new Error('旅程备份数据超过 512 MB 大小限制，无法生成可导入的 ZIP 备份。')
  }
  validateTripBackupJson(tripBackupJson)

  const referencedIds = new Set(referencedPhotoIds)
  const state = await metadataStore.read()
  const selectedPhotos = state.photos.filter((photo) => referencedIds.has(photo.id))
  const selectedRootIds = new Set(selectedPhotos.map((photo) => photo.libraryRootId))
  const selectedRoots = state.roots.filter((root) => selectedRootIds.has(root.id))
  const thumbnailEntries = []
  const exportedPhotos = []

  for (const photo of selectedPhotos) {
    const thumbnail = await thumbnailCache.read(photo.id)
    if (thumbnail) {
      thumbnailEntries.push({ photoId: photo.id, data: thumbnail })
      exportedPhotos.push({ ...photo, thumbnailCacheKey: thumbnailCache.getCacheKey(photo.id) })
    } else {
      exportedPhotos.push({ ...photo, thumbnailCacheKey: undefined })
    }
  }

  const photoMetadata = normalizePhotoLibraryState(selectedRoots, exportedPhotos)
  const manifest = {
    schema: DESKTOP_BACKUP_SCHEMA,
    version: DESKTOP_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    originalsIncluded: false,
    summary: {
      photoRootCount: photoMetadata.roots.length,
      photoCount: photoMetadata.photos.length,
      thumbnailCount: thumbnailEntries.length,
    },
  }
  const { archive, completed } = createArchive(zipPath)
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' })
  archive.append(tripBackupJson, { name: 'trip-backup.json' })
  archive.append(`${JSON.stringify(photoMetadata, null, 2)}\n`, { name: 'photos/metadata.json' })
  thumbnailEntries.forEach((entry) => {
    archive.append(entry.data, { name: `photos/thumbnails/${thumbnailCache.getCacheKey(entry.photoId)}` })
  })
  try {
    await archive.finalize()
    await completed
  } catch (error) {
    await rm(zipPath, { force: true })
    throw error
  }

  return {
    filename: path.basename(zipPath),
    photoRootCount: photoMetadata.roots.length,
    photoCount: photoMetadata.photos.length,
    thumbnailCount: thumbnailEntries.length,
    size: (await stat(zipPath)).size,
  }
}

export async function prepareDesktopBackupZip({
  zipPath,
  tempParentPath,
  thumbnailCache,
}) {
  if (typeof zipPath !== 'string' || !path.isAbsolute(zipPath)) throw new Error('Backup ZIP path must be absolute.')
  const zipStats = await stat(zipPath)
  if (!zipStats.isFile() || zipStats.size > MAX_BACKUP_ZIP_SIZE) {
    throw new Error('Backup ZIP exceeds the 1 GB safety limit.')
  }

  const extractionPath = await mkdtemp(path.join(tempParentPath, 'roadtrip-backup-import-'))
  try {
    let totalUncompressedSize = 0
    await extractZip(zipPath, {
      dir: extractionPath,
      onEntry: (entry) => {
        const entryName = entry.fileName.replace(/\\/g, '/')
        const allowed = entryName === 'manifest.json'
          || entryName === 'trip-backup.json'
          || entryName === 'photos/'
          || entryName === 'photos/metadata.json'
          || entryName === 'photos/thumbnails/'
          || /^photos\/thumbnails\/[A-Za-z0-9_-]{1,128}\.webp$/.test(entryName)
        if (!allowed) throw new Error(`Backup ZIP contains an unsupported entry: ${entryName}`)
        if (entryName === 'trip-backup.json' && entry.uncompressedSize > MAX_TRIP_JSON_FILE_SIZE) {
          throw new Error('备份文件 trip-backup.json 超过 512 MB 大小限制。')
        }
        totalUncompressedSize += entry.uncompressedSize
        if (totalUncompressedSize > MAX_BACKUP_UNCOMPRESSED_SIZE) {
          throw new Error('Backup ZIP exceeds the 2 GB uncompressed safety limit.')
        }
      },
    })
    const manifest = parseJson(
      await readFileLimited(path.join(extractionPath, 'manifest.json')),
      'Backup manifest',
    )
    if (manifest?.schema !== DESKTOP_BACKUP_SCHEMA || manifest?.version !== DESKTOP_BACKUP_VERSION) {
      throw new Error('Backup ZIP schema or version is unsupported.')
    }
    if (manifest.originalsIncluded !== false) {
      throw new Error('Backup ZIP must not contain local original photos.')
    }

    const tripBackupJson = (await readFileLimited(path.join(extractionPath, 'trip-backup.json'), MAX_TRIP_JSON_FILE_SIZE)).toString('utf8')
    validateTripBackupJson(tripBackupJson)
    const rawPhotoMetadata = parseJson(
      await readFileLimited(path.join(extractionPath, 'photos', 'metadata.json')),
      'Photo metadata',
    )
    if (
      rawPhotoMetadata?.schema !== PHOTO_LIBRARY_SCHEMA
      || rawPhotoMetadata?.version !== PHOTO_LIBRARY_VERSION
    ) {
      throw new Error('Photo metadata schema or version is unsupported.')
    }
    const normalizedState = normalizePhotoLibraryState(rawPhotoMetadata.roots, rawPhotoMetadata.photos)
    const thumbnailEntries = []
    const restoredPhotos = []

    for (const photo of normalizedState.photos) {
      const expectedCacheKey = thumbnailCache.getCacheKey(photo.id)
      if (photo.thumbnailCacheKey && photo.thumbnailCacheKey !== expectedCacheKey) {
        throw new Error(`Photo ${photo.id} has an invalid thumbnail cache key.`)
      }
      let thumbnail = null
      try {
        thumbnail = await readFileLimited(
          path.join(extractionPath, 'photos', 'thumbnails', expectedCacheKey),
          5 * 1024 * 1024,
        )
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (thumbnail) {
        thumbnailEntries.push({ photoId: photo.id, data: thumbnail })
        restoredPhotos.push({ ...photo, thumbnailCacheKey: expectedCacheKey })
      } else {
        restoredPhotos.push({ ...photo, thumbnailCacheKey: undefined })
      }
    }

    return {
      tripBackupJson,
      photoRootCount: normalizedState.roots.length,
      photoCount: restoredPhotos.length,
      thumbnailCount: thumbnailEntries.length,
      photoIds: restoredPhotos.map((photo) => photo.id),
      roots: normalizedState.roots,
      photos: restoredPhotos,
      thumbnailEntries,
    }
  } finally {
    await rm(extractionPath, { recursive: true, force: true })
  }
}

async function readCurrentThumbnailEntries(metadataStore, thumbnailCache) {
  const state = await metadataStore.read()
  const entries = []
  for (const photo of state.photos) {
    const data = await thumbnailCache.read(photo.id)
    if (data) entries.push({ photoId: photo.id, data })
  }
  return { state, entries }
}

export async function commitPreparedDesktopBackup({
  prepared,
  metadataStore,
  thumbnailCache,
}) {
  if (!prepared || !Array.isArray(prepared.roots) || !Array.isArray(prepared.photos)) {
    throw new Error('Prepared desktop backup is invalid.')
  }
  const previous = await readCurrentThumbnailEntries(metadataStore, thumbnailCache)
  let thumbnailsReplaced = false
  try {
    await thumbnailCache.replaceAll(prepared.thumbnailEntries)
    thumbnailsReplaced = true
    await metadataStore.replaceAll(prepared.roots, prepared.photos)
  } catch (error) {
    const rollbackErrors = []
    if (thumbnailsReplaced) {
      try {
        await thumbnailCache.replaceAll(previous.entries)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    try {
      await metadataStore.replaceAll(previous.state.roots, previous.state.photos)
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'Backup restore failed and rollback was incomplete.')
    }
    throw error
  }
}

export async function restoreDesktopBackupZip({
  zipPath,
  tempParentPath,
  metadataStore,
  thumbnailCache,
}) {
  const prepared = await prepareDesktopBackupZip({ zipPath, tempParentPath, thumbnailCache })
  await commitPreparedDesktopBackup({ prepared, metadataStore, thumbnailCache })
  return {
    tripBackupJson: prepared.tripBackupJson,
    photoRootCount: prepared.photoRootCount,
    photoCount: prepared.photoCount,
    thumbnailCount: prepared.thumbnailCount,
    photoIds: prepared.photoIds,
  }
}

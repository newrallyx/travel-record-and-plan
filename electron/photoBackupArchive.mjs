import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import archiver from 'archiver'
import extractZip from 'extract-zip'
import { finished } from 'node:stream/promises'
import { replaceFileAtomically } from '../backend/src/atomicFile.js'
import { validateThumbnailFile } from './photoThumbnailCache.mjs'
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
    archive.on('warning', reject)
  })
  completed.catch(() => {})
  archive.pipe(output)
  return { archive, completed, abort: async () => {
    archive.abort()
    output.destroy()
    await finished(output).catch(() => {})
  } }
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
    const thumbnail = await thumbnailFileEntry(thumbnailCache, photo.id)
    if (thumbnail) {
      thumbnailEntries.push(thumbnail)
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
  await replaceFileAtomically(zipPath, async (tempPath) => {
    const { archive, completed, abort } = createArchive(tempPath)
    try {
      archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' })
      archive.append(tripBackupJson, { name: 'trip-backup.json' })
      archive.append(`${JSON.stringify(photoMetadata, null, 2)}\n`, { name: 'photos/metadata.json' })
      for (const entry of thumbnailEntries) {
        archive.file(entry.filePath, { name: `photos/thumbnails/${thumbnailCache.getCacheKey(entry.photoId)}` })
      }
      await Promise.all([archive.finalize(), completed])
    } catch (error) { await abort(); throw error }
  })

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
        thumbnail = await validateThumbnailFile(path.join(extractionPath, 'photos', 'thumbnails', expectedCacheKey))
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (thumbnail) {
        thumbnailEntries.push({ photoId: photo.id, filePath: thumbnail.filePath })
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
      dispose: () => rm(extractionPath, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(extractionPath, { recursive: true, force: true })
    throw error
  }
}

async function thumbnailFileEntry(thumbnailCache, photoId) {
  try {
    const { filePath } = await validateThumbnailFile(thumbnailCache.getCachePath(photoId))
    return { photoId, filePath }
  } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

/** Legacy JSON cleanup is committed only inside the restore transaction. */
export async function commitPhotoCleanup({ referencedPhotoIds, metadataStore, thumbnailCache }) {
  const references = new Set(referencedPhotoIds)
  const state = await metadataStore.read()
  const orphanIds = state.photos.filter((photo) => !references.has(photo.id)).map((photo) => photo.id)
  return deletePhotoRecords({ photoIds: orphanIds, metadataStore, thumbnailCache })
}

export async function deletePhotoRecords({ photoIds, metadataStore, thumbnailCache }) {
  if (!photoIds.length) return { deletedPhotoIds: [], deletedThumbnailIds: [] }
  const deletion = await thumbnailCache.prepareDeletion(photoIds)
  try {
    const deleted = await metadataStore.deletePhotos(photoIds)
    await deletion.finalize()
    return { deletedPhotoIds: deleted, deletedThumbnailIds: deletion.deletedThumbnailIds }
  } catch (error) {
    try { await deletion.rollback() } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Photo deletion failed and rollback was incomplete.')
    }
    throw error
  }
}

export async function commitPreparedDesktopBackup({
  prepared,
  metadataStore,
  thumbnailCache,
}) {
  if (!prepared || !Array.isArray(prepared.roots) || !Array.isArray(prepared.photos)) {
    throw new Error('Prepared desktop backup is invalid.')
  }
  const previous = await metadataStore.read()
  const replacement = await thumbnailCache.prepareReplacement(prepared.thumbnailEntries)
  try {
    await replacement.commit()
    await metadataStore.replaceAll(prepared.roots, prepared.photos)
  } catch (error) {
    const rollbackErrors = []
    try { await replacement.rollback() } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    try {
      await metadataStore.replaceAll(previous.roots, previous.photos)
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], 'Backup restore failed and rollback was incomplete.')
    }
    throw error
  }
  await replacement.finalize()
}

export async function restoreDesktopBackupZip({
  zipPath,
  tempParentPath,
  metadataStore,
  thumbnailCache,
}) {
  const prepared = await prepareDesktopBackupZip({ zipPath, tempParentPath, thumbnailCache })
  try {
    await commitPreparedDesktopBackup({ prepared, metadataStore, thumbnailCache })
    return {
      tripBackupJson: prepared.tripBackupJson,
      photoRootCount: prepared.photoRootCount,
      photoCount: prepared.photoCount,
      thumbnailCount: prepared.thumbnailCount,
      photoIds: prepared.photoIds,
    }
  } finally { await prepared.dispose() }
}

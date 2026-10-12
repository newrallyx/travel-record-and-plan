import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024
const STALE_TEMP_FILE_AGE_MS = 60 * 60 * 1000

function normalizePhotoId(photoId) {
  if (typeof photoId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(photoId)) {
    throw new Error('Photo id contains unsupported characters.')
  }
  return photoId
}

function normalizeThumbnailData(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  throw new Error('Thumbnail data must be binary.')
}

function isWebp(data) {
  return data.length >= 12
    && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

export class PhotoThumbnailCache {
  constructor(directoryPath) {
    if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
      throw new Error('Thumbnail cache directory must be absolute.')
    }
    this.directoryPath = directoryPath
  }

  getCacheKey(photoId) {
    return `${normalizePhotoId(photoId)}.webp`
  }

  getCachePath(photoId) {
    return path.join(this.directoryPath, this.getCacheKey(photoId))
  }

  async save(photoId, thumbnailData) {
    const data = normalizeThumbnailData(thumbnailData)
    if (!isWebp(data)) throw new Error('Thumbnail must be encoded as WebP.')
    if (data.length > MAX_THUMBNAIL_SIZE) throw new Error('Thumbnail exceeds the 5 MB safety limit.')

    await mkdir(this.directoryPath, { recursive: true })
    const cachePath = this.getCachePath(photoId)
    const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(tempPath, data)
    try {
      await rename(tempPath, cachePath)
    } finally {
      await rm(tempPath, { force: true })
    }
    return this.getCacheKey(photoId)
  }

  async read(photoId) {
    try {
      return await readFile(this.getCachePath(photoId))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async delete(photoId) {
    await rm(this.getCachePath(photoId), { force: true })
  }

  async cleanup(validPhotoIds) {
    const normalizedValidIds = new Set(Array.from(validPhotoIds ?? [], (photoId) => normalizePhotoId(photoId)))
    let entries
    try {
      entries = await readdir(this.directoryPath, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return { deletedThumbnailIds: [], deletedTempFileCount: 0 }
      throw error
    }

    const deletedThumbnailIds = []
    let deletedTempFileCount = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const filePath = path.join(this.directoryPath, entry.name)
      if (entry.name.endsWith('.tmp')) {
        const fileStats = await stat(filePath)
        if (Date.now() - fileStats.mtimeMs >= STALE_TEMP_FILE_AGE_MS) {
          await rm(filePath, { force: true })
          deletedTempFileCount += 1
        }
        continue
      }
      if (!entry.name.endsWith('.webp')) continue
      const photoId = entry.name.slice(0, -'.webp'.length)
      try {
        normalizePhotoId(photoId)
      } catch {
        continue
      }
      if (normalizedValidIds.has(photoId)) continue
      await rm(filePath, { force: true })
      deletedThumbnailIds.push(photoId)
    }

    return { deletedThumbnailIds, deletedTempFileCount }
  }

  async replaceAll(entries) {
    const replacement = await this.prepareReplacement(entries)
    try {
      await replacement.commit()
    } catch (error) {
      try { await replacement.rollback() } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Thumbnail replacement rollback was incomplete.')
      }
      throw error
    }
    await replacement.finalize()
  }

  async prepareReplacement(entries) {
    if (!Array.isArray(entries)) throw new Error('Thumbnail replacement entries must be an array.')
    const stagingPath = `${this.directoryPath}.staging-${randomUUID()}`
    const backupPath = `${this.directoryPath}.backup-${randomUUID()}`
    const stagingCache = new PhotoThumbnailCache(stagingPath)
    await mkdir(stagingPath, { recursive: true })
    let movedExisting = false
    let installed = false
    try {
      const ids = new Set()
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new Error('Thumbnail replacement entry is invalid.')
        const id = normalizePhotoId(entry.photoId)
        if (ids.has(id)) throw new Error('Thumbnail replacement contains duplicate ids.')
        ids.add(id)
        if (entry.filePath) {
          const destination = stagingCache.getCachePath(id)
          await copyFile(entry.filePath, destination)
          await validateThumbnailFile(destination)
        } else {
          await stagingCache.save(id, entry.data)
        }
      }
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true })
      throw error
    }
    return {
      commit: async () => {
        try {
          await rename(this.directoryPath, backupPath)
          movedExisting = true
        } catch (error) { if (error?.code !== 'ENOENT') throw error }
        await rename(stagingPath, this.directoryPath)
        installed = true
      },
      rollback: async () => {
        if (installed) await rm(this.directoryPath, { recursive: true, force: true })
        if (movedExisting) await rename(backupPath, this.directoryPath)
        await rm(stagingPath, { recursive: true, force: true })
      },
      finalize: async () => {
        // Cleanup cannot turn an already committed restore into a reported failure.
        if (movedExisting) await rm(backupPath, { recursive: true, force: true }).catch((error) => {
          console.warn('[photos] Old thumbnail directory cleanup failed.', { code: error?.code })
        })
      },
    }
  }

  async prepareDeletion(photoIds) {
    const ids = [...new Set(photoIds.map(normalizePhotoId))]
    const backupPath = `${this.directoryPath}.deleting-${randomUUID()}`
    await mkdir(backupPath, { recursive: true })
    const moved = []
    const rollback = async () => {
      for (const id of moved) await rename(path.join(backupPath, this.getCacheKey(id)), this.getCachePath(id))
      await rm(backupPath, { recursive: true, force: true })
    }
    try {
      for (const id of ids) {
        try {
          await rename(this.getCachePath(id), path.join(backupPath, this.getCacheKey(id)))
          moved.push(id)
        } catch (error) { if (error?.code !== 'ENOENT') throw error }
      }
    } catch (error) {
      try { await rollback() } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Photo deletion rollback was incomplete.')
      }
      throw error
    }
    return {
      rollback,
      deletedThumbnailIds: moved,
      finalize: () => rm(backupPath, { recursive: true, force: true }).catch((error) => {
        console.warn('[photos] Deleted thumbnail directory cleanup failed.', { code: error?.code })
      }),
    }
  }
}

export async function validateThumbnailFile(filePath) {
  const file = await open(filePath, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_THUMBNAIL_SIZE) throw new Error('Thumbnail exceeds the 5 MB safety limit.')
    const header = Buffer.alloc(12)
    const { bytesRead } = await file.read(header, 0, 12, 0)
    if (bytesRead !== 12 || !isWebp(header)) throw new Error('Thumbnail must be encoded as WebP.')
    return { filePath, size: info.size }
  } finally { await file.close() }
}

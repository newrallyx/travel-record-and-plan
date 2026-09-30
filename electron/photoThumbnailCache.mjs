import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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
    if (!Array.isArray(entries)) throw new Error('Thumbnail replacement entries must be an array.')
    const stagingPath = `${this.directoryPath}.staging-${randomUUID()}`
    const backupPath = `${this.directoryPath}.backup-${randomUUID()}`
    const stagingCache = new PhotoThumbnailCache(stagingPath)
    await mkdir(stagingPath, { recursive: true })
    try {
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new Error('Thumbnail replacement entry is invalid.')
        await stagingCache.save(entry.photoId, entry.data)
      }

      let movedExisting = false
      try {
        await rename(this.directoryPath, backupPath)
        movedExisting = true
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }

      try {
        await rename(stagingPath, this.directoryPath)
      } catch (error) {
        if (movedExisting) await rename(backupPath, this.directoryPath)
        throw error
      }
      if (movedExisting) await rm(backupPath, { recursive: true, force: true })
    } finally {
      await rm(stagingPath, { recursive: true, force: true })
    }
  }
}

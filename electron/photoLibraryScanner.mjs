import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { getSupportedPhotoMimeType, MAX_PHOTO_FILE_SIZE } from './photoLibraryAccess.mjs'

function normalizeRelativePathKey(relativePath) {
  const normalized = path.normalize(relativePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function fingerprintsMatch(left, right) {
  return left.size === right.size && left.modifiedAt === right.modifiedAt
}

function fingerprintKey(fingerprint) {
  return `${fingerprint.size}:${fingerprint.modifiedAt}`
}

function createUnavailableResult(rootPath, error) {
  return {
    status: 'root-unavailable',
    rootPath,
    files: [],
    issues: [{
      relativePath: '',
      code: typeof error?.code === 'string' ? error.code : 'ROOT_UNAVAILABLE',
      message: error instanceof Error ? error.message : String(error),
    }],
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('Photo library scan was cancelled.')
  error.name = 'AbortError'
  throw error
}

export async function scanPhotoLibraryRoot(rootPath, { signal, onProgress } = {}) {
  const startedAt = Date.now()
  let canonicalRoot
  try {
    canonicalRoot = await realpath(rootPath)
    const rootStat = await stat(canonicalRoot)
    if (!rootStat.isDirectory()) throw new Error('Photo library root is not a directory.')
  } catch (error) {
    return createUnavailableResult(rootPath, error)
  }

  const files = []
  const issues = []
  const pendingDirectories = [canonicalRoot]
  let processedEntries = 0

  const emitProgress = (directoryPath) => {
    onProgress?.({
      processedEntries,
      discoveredPhotos: files.length,
      currentDirectory: path.relative(canonicalRoot, directoryPath) || '.',
    })
  }

  while (pendingDirectories.length > 0) {
    throwIfAborted(signal)
    const directoryPath = pendingDirectories.pop()
    let entries
    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    } catch (error) {
      issues.push({
        relativePath: path.relative(canonicalRoot, directoryPath),
        code: typeof error?.code === 'string' ? error.code : 'DIRECTORY_UNREADABLE',
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    for (const entry of entries) {
      throwIfAborted(signal)
      processedEntries += 1
      if (processedEntries % 100 === 0) emitProgress(directoryPath)
      const absolutePath = path.join(directoryPath, entry.name)
      const relativePath = path.relative(canonicalRoot, absolutePath)

      if (entry.isSymbolicLink()) {
        issues.push({
          relativePath,
          code: 'SYMLINK_SKIPPED',
          message: 'Symbolic links and directory junctions are not scanned.',
        })
        continue
      }
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue

      const extension = path.extname(entry.name).toLowerCase()
      if (extension === '.heic' || extension === '.heif') {
        issues.push({
          relativePath,
          code: 'PHOTO_CONVERSION_REQUIRED',
          message: 'HEIC/HEIF is not decoded reliably by this Electron runtime. Convert it to JPEG or WebP before linking.',
        })
        continue
      }
      const mimeType = getSupportedPhotoMimeType(entry.name)
      if (!mimeType) continue

      try {
        const fileStat = await stat(absolutePath)
        if (fileStat.size > MAX_PHOTO_FILE_SIZE) {
          issues.push({
            relativePath,
            code: 'PHOTO_TOO_LARGE',
            message: 'Photo exceeds the 100 MB safety limit.',
          })
          continue
        }

        files.push({
          relativePath,
          originalFilename: entry.name,
          mimeType,
          fingerprint: {
            size: fileStat.size,
            modifiedAt: fileStat.mtimeMs,
          },
        })
      } catch (error) {
        issues.push({
          relativePath,
          code: typeof error?.code === 'string' ? error.code : 'PHOTO_UNREADABLE',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }))
  emitProgress(canonicalRoot)
  return { status: 'available', rootPath: canonicalRoot, files, issues, durationMs: Date.now() - startedAt }
}

export function reconcilePhotoLibraryScan(indexedPhotos, scannedFiles) {
  const scannedByPath = new Map(
    scannedFiles.map((file) => [normalizeRelativePathKey(file.relativePath), file]),
  )
  const indexedPathKeys = new Set(indexedPhotos.map((photo) => normalizeRelativePathKey(photo.relativePath)))
  const unchangedPhotoIds = []
  const changed = []
  const missing = []

  for (const photo of indexedPhotos) {
    const scannedFile = scannedByPath.get(normalizeRelativePathKey(photo.relativePath))
    if (!scannedFile) {
      missing.push({ photoId: photo.id, relativePath: photo.relativePath })
      continue
    }
    if (fingerprintsMatch(photo.fingerprint, scannedFile.fingerprint)) unchangedPhotoIds.push(photo.id)
    else changed.push({ photoId: photo.id, file: scannedFile })
  }

  const newFiles = scannedFiles.filter((file) => !indexedPathKeys.has(normalizeRelativePathKey(file.relativePath)))
  const newFilesByFingerprint = new Map()
  for (const file of newFiles) {
    const key = fingerprintKey(file.fingerprint)
    const matches = newFilesByFingerprint.get(key) ?? []
    matches.push(file)
    newFilesByFingerprint.set(key, matches)
  }

  const indexedById = new Map(indexedPhotos.map((photo) => [photo.id, photo]))
  const relocationCandidates = missing
    .map((item) => ({
      photoId: item.photoId,
      candidates: newFilesByFingerprint.get(fingerprintKey(indexedById.get(item.photoId).fingerprint)) ?? [],
    }))
    .filter((item) => item.candidates.length > 0)

  return { newFiles, unchangedPhotoIds, changed, missing, relocationCandidates }
}

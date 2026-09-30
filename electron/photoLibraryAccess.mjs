import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export const MAX_PHOTO_FILE_SIZE = 100 * 1024 * 1024

const PHOTO_MIME_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)
}

export function getSupportedPhotoMimeType(filePath) {
  return PHOTO_MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? null
}

export function isTrustedDesktopUrl(url, expectedOrigin) {
  try {
    return new URL(url).origin === expectedOrigin
  } catch {
    return false
  }
}

export async function resolveAuthorizedPhotoPath(rootPath, relativePhotoPath) {
  if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) {
    throw new Error('Photo library root must be an absolute path.')
  }
  if (typeof relativePhotoPath !== 'string' || !relativePhotoPath.trim() || path.isAbsolute(relativePhotoPath)) {
    throw new Error('Photo path must be a non-empty relative path.')
  }

  const canonicalRoot = await realpath(rootPath)
  const candidatePath = path.resolve(canonicalRoot, relativePhotoPath)
  if (!isPathInsideRoot(canonicalRoot, candidatePath)) {
    throw new Error('Photo path is outside the authorized library root.')
  }

  const canonicalPhotoPath = await realpath(candidatePath)
  if (!isPathInsideRoot(canonicalRoot, canonicalPhotoPath)) {
    throw new Error('Photo path resolves outside the authorized library root.')
  }

  return canonicalPhotoPath
}

export async function inspectAuthorizedPhoto(rootPath, relativePhotoPath) {
  const photoPath = await resolveAuthorizedPhotoPath(rootPath, relativePhotoPath)
  const mimeType = getSupportedPhotoMimeType(photoPath)
  if (!mimeType) {
    throw new Error('Unsupported photo format. Supported formats: JPEG, PNG and WebP.')
  }

  const photoStat = await stat(photoPath)
  if (!photoStat.isFile()) {
    throw new Error('Selected photo path is not a file.')
  }
  if (photoStat.size > MAX_PHOTO_FILE_SIZE) {
    throw new Error('Photo exceeds the 100 MB safety limit.')
  }

  return {
    photoPath,
    mimeType,
    size: photoStat.size,
    modifiedAt: photoStat.mtimeMs,
  }
}

export async function readAuthorizedPhoto(rootPath, relativePhotoPath) {
  const inspected = await inspectAuthorizedPhoto(rootPath, relativePhotoPath)
  const data = await readFile(inspected.photoPath)
  return {
    data,
    mimeType: inspected.mimeType,
    size: inspected.size,
    modifiedAt: inspected.modifiedAt,
  }
}

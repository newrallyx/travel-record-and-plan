import type { PhotoBlobAsset } from './photoRepository'
import { extractPhotoExif } from './photoExif.ts'

export interface PhotoThumbnailOptions {
  maxDimension?: number
  quality?: number
  orientation?: number
}

export const PHOTO_THUMBNAIL_CACHE_VERSION = 2

function applyExifOrientation(
  context: CanvasRenderingContext2D,
  orientation: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (orientation === 2) context.setTransform(-1, 0, 0, 1, canvasWidth, 0)
  else if (orientation === 3) context.setTransform(-1, 0, 0, -1, canvasWidth, canvasHeight)
  else if (orientation === 4) context.setTransform(1, 0, 0, -1, 0, canvasHeight)
  else if (orientation === 5) context.setTransform(0, 1, 1, 0, 0, 0)
  else if (orientation === 6) context.setTransform(0, 1, -1, 0, canvasWidth, 0)
  else if (orientation === 7) context.setTransform(0, -1, -1, 0, canvasWidth, canvasHeight)
  else if (orientation === 8) context.setTransform(0, -1, 1, 0, 0, canvasHeight)
}

export async function createPhotoThumbnail(
  original: Blob,
  { maxDimension = 320, quality = 0.82, orientation: knownOrientation }: PhotoThumbnailOptions = {},
): Promise<PhotoBlobAsset> {
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) throw new Error('Thumbnail size must be positive.')
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) throw new Error('Thumbnail quality must be between 0 and 1.')
  if (typeof createImageBitmap !== 'function') throw new Error('This environment cannot decode photos.')

  const orientation = Number.isInteger(knownOrientation) && Number(knownOrientation) >= 1 && Number(knownOrientation) <= 8
    ? Number(knownOrientation)
    : ((await extractPhotoExif(original)).metadata.orientation ?? 1)
  const bitmap = await createImageBitmap(original, { imageOrientation: 'none' })
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Photo has invalid dimensions.')
    const swapsDimensions = orientation >= 5
    const displayWidth = swapsDimensions ? bitmap.height : bitmap.width
    const displayHeight = swapsDimensions ? bitmap.width : bitmap.height
    const scale = Math.min(1, maxDimension / Math.max(displayWidth, displayHeight))
    const width = Math.max(1, Math.round(displayWidth * scale))
    const height = Math.max(1, Math.round(displayHeight * scale))
    const rawWidth = Math.max(1, Math.round(bitmap.width * scale))
    const rawHeight = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to create a thumbnail canvas.')
    applyExifOrientation(context, orientation, width, height)
    context.drawImage(bitmap, 0, 0, rawWidth, rawHeight)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('Failed to encode the photo thumbnail.'))),
        'image/webp',
        quality,
      )
    })
    return { blob, mimeType: 'image/webp' }
  } finally {
    bitmap.close()
  }
}

import type { PhotoCoordinate } from '../types/photo'

export interface PhotoExifMetadata {
  capturedAt?: string
  orientation?: number
  originalGps?: PhotoCoordinate
}

export interface PhotoExifResult {
  metadata: PhotoExifMetadata
  warning?: string
}

type ExifParser = (input: ArrayBuffer, options?: unknown) => Promise<unknown>

const defaultExifParser: ExifParser = async (input, options) => {
  const { default: exifr } = await import('exifr')
  return exifr.parse(input, options as string[])
}

function normalizeExifDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  }
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const exifMatch = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(trimmed)
  if (exifMatch) {
    const [, year, month, day, hour, minute, second] = exifMatch
    const parts = [year, month, day, hour, minute, second].map(Number)
    const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber, secondNumber] = parts
    const parsed = new Date(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber)
    if (
      parsed.getFullYear() !== yearNumber
      || parsed.getMonth() !== monthNumber - 1
      || parsed.getDate() !== dayNumber
      || parsed.getHours() !== hourNumber
      || parsed.getMinutes() !== minuteNumber
      || parsed.getSeconds() !== secondNumber
    ) return undefined
    const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}`
    return normalized
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function normalizeOrientation(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 8 ? Number(value) : undefined
}

function dmsToDecimal(value: unknown, reference: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!Array.isArray(value) || value.length < 2) return undefined
  const [degrees, minutes, seconds = 0] = value.map(Number)
  if (![degrees, minutes, seconds].every(Number.isFinite)) return undefined
  const decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600
  const normalizedReference = typeof reference === 'string' ? reference.toUpperCase() : ''
  return normalizedReference === 'S' || normalizedReference === 'W' ? -decimal : decimal
}

function normalizeGps(exif: Record<string, unknown>): PhotoCoordinate | undefined {
  const latitude = typeof exif.latitude === 'number'
    ? exif.latitude
    : dmsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef)
  const lon = typeof exif.longitude === 'number'
    ? exif.longitude
    : dmsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef)
  if (!Number.isFinite(latitude) || !Number.isFinite(lon)) return undefined
  if (Number(latitude) < -90 || Number(latitude) > 90 || Number(lon) < -180 || Number(lon) > 180) return undefined
  return { lat: Number(latitude), lon: Number(lon) }
}

export function normalizeExifOutput(value: unknown): PhotoExifMetadata {
  if (!value || typeof value !== 'object') return {}
  const exif = value as Record<string, unknown>
  const capturedAt = normalizeExifDate(
    exif.DateTimeOriginal ?? exif.CreateDate ?? exif.DateTimeDigitized ?? exif.ModifyDate,
  )
  const orientation = normalizeOrientation(exif.Orientation)
  const originalGps = normalizeGps(exif)
  return { capturedAt, orientation, originalGps }
}

export async function extractPhotoExif(blob: Blob, parser: ExifParser = defaultExifParser): Promise<PhotoExifResult> {
  try {
    const output = await parser(await blob.arrayBuffer(), {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'DateTimeDigitized',
        'ModifyDate',
        'Orientation',
        'GPSLatitude',
        'GPSLatitudeRef',
        'GPSLongitude',
        'GPSLongitudeRef',
      ],
      translateValues: false,
    })
    return { metadata: normalizeExifOutput(output) }
  } catch (error) {
    return {
      metadata: {},
      warning: `EXIF 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

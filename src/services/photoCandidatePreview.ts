import type { PhotoBlobAsset } from './photoRepository'
import { createPhotoThumbnail } from './photoThumbnail.ts'
import { createAsyncTaskLimiter } from '../utils/asyncTaskLimiter.ts'

interface CandidatePhotoReadResult {
  data: Uint8Array
  mimeType: string
}

type CandidatePhotoReader = (rootId: string, relativePath: string) => Promise<CandidatePhotoReadResult>
type CandidatePreviewGenerator = (original: Blob) => Promise<PhotoBlobAsset>

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

export function createCandidatePreviewLoader({
  readPhoto,
  createPreview,
  maxConcurrency = 2,
}: {
  readPhoto: CandidatePhotoReader
  createPreview: CandidatePreviewGenerator
  maxConcurrency?: number
}) {
  const limitRead = createAsyncTaskLimiter(maxConcurrency)
  const pending = new Map<string, Promise<PhotoBlobAsset>>()

  return (rootId: string, relativePath: string): Promise<PhotoBlobAsset> => {
    const key = `${rootId}\u0000${relativePath}`
    const existing = pending.get(key)
    if (existing) return existing

    const request = limitRead(async () => {
      const source = await readPhoto(rootId, relativePath)
      const original = new Blob([copyToArrayBuffer(source.data)], { type: source.mimeType })
      return createPreview(original)
    })
    pending.set(key, request)
    const clearPending = () => {
      if (pending.get(key) === request) pending.delete(key)
    }
    void request.then(clearPending, clearPending)
    return request
  }
}

export const loadCandidatePhotoPreview = createCandidatePreviewLoader({
  readPhoto: async (rootId, relativePath) => {
    const api = window.roadtripDesktop?.photoLibrary
    if (!api) throw new Error('The desktop photo library API is unavailable.')
    return api.readPhoto(rootId, relativePath)
  },
  createPreview: (original) => createPhotoThumbnail(original, { maxDimension: 480, quality: 0.78 }),
  maxConcurrency: 2,
})

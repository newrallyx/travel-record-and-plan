import path from 'node:path'

export async function commitPhotoContentRefresh({
  photo,
  inspected,
  payload,
  metadataStore,
  thumbnailCache,
  updatedAt = new Date().toISOString(),
}) {
  const expectedFingerprint = payload?.expectedFingerprint
  if (
    !expectedFingerprint
    || inspected.size !== expectedFingerprint.size
    || inspected.modifiedAt !== expectedFingerprint.modifiedAt
  ) {
    throw new Error('The photo changed while it was being refreshed. Please try again.')
  }
  if (payload?.thumbnailMimeType !== 'image/webp') {
    throw new Error('Thumbnail must use the image/webp MIME type.')
  }

  const oldThumbnail = await thumbnailCache.read(photo.id)
  try {
    const thumbnailCacheKey = await thumbnailCache.save(photo.id, payload?.thumbnailData)
    return await metadataStore.savePhoto({
      ...photo,
      relativePath: payload.relativePath,
      originalFilename: path.basename(inspected.photoPath),
      mimeType: inspected.mimeType,
      capturedAt: payload.capturedAt,
      orientation: payload.orientation,
      originalGps: payload.originalGps,
      mapPosition: payload.mapPosition,
      metadataReadAt: payload.metadataReadAt,
      fingerprint: { size: inspected.size, modifiedAt: inspected.modifiedAt },
      thumbnailCacheKey,
      thumbnailCacheVersion: payload.thumbnailCacheVersion,
      updatedAt,
    })
  } catch (error) {
    try {
      if (oldThumbnail) await thumbnailCache.save(photo.id, oldThumbnail)
      else await thumbnailCache.delete(photo.id)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Photo refresh failed and thumbnail rollback was incomplete.')
    }
    throw error
  }
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const PHOTO_LIBRARY_SCHEMA = 'roadtrip-photo-library'
export const PHOTO_LIBRARY_VERSION = 1

function createEmptyState() {
  return {
    schema: PHOTO_LIBRARY_SCHEMA,
    version: PHOTO_LIBRARY_VERSION,
    roots: [],
    photos: [],
  }
}

function clone(value) {
  return structuredClone(value)
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`)
  }
  return value.trim()
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeCoordinate(value, fieldName) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || !Number.isFinite(value.lat) || !Number.isFinite(value.lon)) {
    throw new Error(`${fieldName} must contain finite latitude and longitude values.`)
  }
  if (value.lat < -90 || value.lat > 90 || value.lon < -180 || value.lon > 180) {
    throw new Error(`${fieldName} is outside the valid latitude or longitude range.`)
  }
  return { lat: value.lat, lon: value.lon }
}

function linkedPhotoSourceKey(photo) {
  const relativePath = process.platform === 'win32' ? photo.relativePath.toLowerCase() : photo.relativePath
  return `${photo.libraryRootId}\u0000${relativePath}`
}

export function normalizePhotoLibraryState(rootsValue, photosValue) {
  if (!Array.isArray(rootsValue) || !Array.isArray(photosValue)) {
    throw new Error('Photo library metadata is missing roots or photos arrays.')
  }
  const roots = rootsValue.map((root) => normalizePhotoLibraryRoot(root))
  const rootIds = new Set(roots.map((root) => root.id))
  if (rootIds.size !== roots.length) throw new Error('Photo library metadata contains duplicate root ids.')

  const photos = photosValue.map((photo) => normalizeLinkedPhotoRecord(photo))
  const photoIds = new Set(photos.map((photo) => photo.id))
  if (photoIds.size !== photos.length) throw new Error('Photo library metadata contains duplicate photo ids.')
  if (photos.some((photo) => !rootIds.has(photo.libraryRootId))) {
    throw new Error('Photo library metadata contains a photo with an unknown root.')
  }
  return { schema: PHOTO_LIBRARY_SCHEMA, version: PHOTO_LIBRARY_VERSION, roots, photos }
}

export function normalizePhotoLibraryRoot(value) {
  if (!value || typeof value !== 'object') throw new Error('Photo library root must be an object.')

  const rootPath = requireNonEmptyString(value.path, 'Photo library root path')
  if (!path.isAbsolute(rootPath)) throw new Error('Photo library root path must be absolute.')

  return {
    id: requireNonEmptyString(value.id, 'Photo library root id'),
    tripId: normalizeOptionalString(value.tripId),
    name: requireNonEmptyString(value.name, 'Photo library root name'),
    path: path.normalize(rootPath),
    createdAt: requireNonEmptyString(value.createdAt, 'Photo library root createdAt'),
    updatedAt: requireNonEmptyString(value.updatedAt, 'Photo library root updatedAt'),
  }
}

export function normalizeLinkedPhotoRecord(value) {
  if (!value || typeof value !== 'object') throw new Error('Linked photo record must be an object.')
  if (value.storageMode !== 'linked') throw new Error('Only linked photo records are supported.')

  const relativePath = requireNonEmptyString(value.relativePath, 'Linked photo relative path')
  const normalizedRelativePath = path.normalize(relativePath)
  if (
    path.isAbsolute(relativePath)
    || normalizedRelativePath === '..'
    || normalizedRelativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error('Linked photo path must stay inside its photo library root.')
  }

  if (!value.fingerprint || typeof value.fingerprint !== 'object') {
    throw new Error('Linked photo fingerprint is required.')
  }
  const size = value.fingerprint.size
  const modifiedAt = value.fingerprint.modifiedAt
  if (!Number.isFinite(size) || size < 0 || !Number.isFinite(modifiedAt) || modifiedAt < 0) {
    throw new Error('Linked photo fingerprint is invalid.')
  }

  const originalGps = normalizeCoordinate(value.originalGps, 'Original GPS')
  const rawMapPosition = normalizeCoordinate(value.mapPosition, 'Map position')
  const mapPosition = rawMapPosition
    ? {
        ...rawMapPosition,
        coordinateSystem: value.mapPosition.coordinateSystem === 'WGS84' ? 'WGS84' : 'GCJ02',
        source: ['exif', 'manual', 'track-time'].includes(value.mapPosition.source)
          ? value.mapPosition.source
          : 'manual',
        manuallyAdjusted: value.mapPosition.manuallyAdjusted === true,
      }
    : undefined

  return {
    id: requireNonEmptyString(value.id, 'Linked photo id'),
    segmentId: requireNonEmptyString(value.segmentId, 'Linked photo segmentId'),
    storageMode: 'linked',
    libraryRootId: requireNonEmptyString(value.libraryRootId, 'Linked photo libraryRootId'),
    relativePath: normalizedRelativePath,
    originalFilename: requireNonEmptyString(value.originalFilename, 'Linked photo originalFilename'),
    mimeType: normalizeOptionalString(value.mimeType),
    width: Number.isFinite(value.width) && value.width > 0 ? value.width : undefined,
    height: Number.isFinite(value.height) && value.height > 0 ? value.height : undefined,
    orientation: Number.isInteger(value.orientation) && value.orientation > 0 ? value.orientation : undefined,
    capturedAt: normalizeOptionalString(value.capturedAt),
    metadataReadAt: normalizeOptionalString(value.metadataReadAt),
    importedAt: requireNonEmptyString(value.importedAt, 'Linked photo importedAt'),
    updatedAt: requireNonEmptyString(value.updatedAt, 'Linked photo updatedAt'),
    fingerprint: {
      size,
      modifiedAt,
      sha256: normalizeOptionalString(value.fingerprint.sha256),
    },
    originalGps,
    mapPosition,
    note: normalizeOptionalString(value.note),
    thumbnailCacheKey: normalizeOptionalString(value.thumbnailCacheKey),
    thumbnailCacheVersion: Number.isInteger(value.thumbnailCacheVersion) && value.thumbnailCacheVersion > 0
      ? value.thumbnailCacheVersion
      : undefined,
  }
}

async function readState(filePath) {
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return createEmptyState()
    throw error
  }

  const parsed = JSON.parse(raw)
  if (parsed?.schema !== PHOTO_LIBRARY_SCHEMA || parsed?.version !== PHOTO_LIBRARY_VERSION) {
    throw new Error('Unsupported photo library metadata schema or version.')
  }
  return normalizePhotoLibraryState(parsed.roots, parsed.photos)
}

async function writeState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

export class PhotoMetadataStore {
  constructor(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('Photo metadata store path must be absolute.')
    }
    this.filePath = filePath
    this.writeQueue = Promise.resolve()
    this.cachedState = null
  }

  async loadState() {
    if (!this.cachedState) this.cachedState = await readState(this.filePath)
    return this.cachedState
  }

  async read() {
    await this.writeQueue
    return clone(await this.loadState())
  }

  async replaceAll(roots, photos) {
    const nextState = normalizePhotoLibraryState(roots, photos)
    const operation = this.writeQueue.then(async () => {
      await writeState(this.filePath, nextState)
      this.cachedState = nextState
      return nextState
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return clone(await operation)
  }

  mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      const state = clone(await this.loadState())
      const result = await mutator(state)
      await writeState(this.filePath, state)
      this.cachedState = state
      return clone(result)
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async listRoots() {
    return (await this.read()).roots
  }

  async getRoot(rootId) {
    return (await this.read()).roots.find((root) => root.id === rootId) ?? null
  }

  async listPhotosByRoot(rootId) {
    const normalizedRootId = requireNonEmptyString(rootId, 'Photo library root id')
    return (await this.read()).photos.filter((photo) => photo.libraryRootId === normalizedRootId)
  }

  async listPhotos() {
    return (await this.read()).photos
  }

  async saveRoot(rootValue) {
    const root = normalizePhotoLibraryRoot(rootValue)
    return this.mutate((state) => {
      const existingIndex = state.roots.findIndex((item) => item.id === root.id)
      const duplicatePath = state.roots.find((item) => item.id !== root.id && item.path === root.path)
      if (duplicatePath) return duplicatePath

      if (existingIndex >= 0) {
        const existing = state.roots[existingIndex]
        if (existing.path !== root.path) throw new Error('A photo library root path cannot be changed directly.')
        state.roots[existingIndex] = { ...root, createdAt: existing.createdAt }
        return state.roots[existingIndex]
      }

      state.roots.push(root)
      return root
    })
  }

  async deleteRoot(rootId) {
    const normalizedRootId = requireNonEmptyString(rootId, 'Photo library root id')
    return this.mutate((state) => {
      if (state.photos.some((photo) => photo.libraryRootId === normalizedRootId)) {
        throw new Error('Cannot remove a photo library root while photos still reference it.')
      }
      state.roots = state.roots.filter((root) => root.id !== normalizedRootId)
      return undefined
    })
  }

  async relinkRoot(rootId, nextPath, updatedAt) {
    const normalizedRootId = requireNonEmptyString(rootId, 'Photo library root id')
    const normalizedPath = requireNonEmptyString(nextPath, 'Photo library root path')
    if (!path.isAbsolute(normalizedPath)) throw new Error('Photo library root path must be absolute.')

    return this.mutate((state) => {
      const existingIndex = state.roots.findIndex((root) => root.id === normalizedRootId)
      if (existingIndex < 0) throw new Error('Photo library root was not found.')
      const canonicalPath = path.normalize(normalizedPath)
      if (state.roots.some((root) => root.id !== normalizedRootId && root.path === canonicalPath)) {
        throw new Error('Another photo library root already uses this path.')
      }

      state.roots[existingIndex] = {
        ...state.roots[existingIndex],
        path: canonicalPath,
        updatedAt: requireNonEmptyString(updatedAt, 'Photo library root updatedAt'),
      }
      return state.roots[existingIndex]
    })
  }

  async listPhotosBySegment(segmentId) {
    const normalizedSegmentId = requireNonEmptyString(segmentId, 'Segment id')
    return (await this.read()).photos.filter((photo) => photo.segmentId === normalizedSegmentId)
  }

  async getPhoto(photoId) {
    return (await this.read()).photos.find((photo) => photo.id === photoId) ?? null
  }

  async savePhoto(photoValue) {
    const [photo] = await this.savePhotos([photoValue])
    return photo
  }

  async savePhotos(photoValues) {
    if (!Array.isArray(photoValues)) throw new Error('Photos must be an array.')
    const photos = photoValues.map((photo) => normalizeLinkedPhotoRecord(photo))
    const batchIds = new Set(photos.map((photo) => photo.id))
    if (batchIds.size !== photos.length) throw new Error('Photo batch contains duplicate ids.')
    if (photos.length === 0) return []

    return this.mutate((state) => {
      const rootIds = new Set(state.roots.map((root) => root.id))
      if (photos.some((photo) => !rootIds.has(photo.libraryRootId))) {
        throw new Error('Cannot save a linked photo for an unknown photo library root.')
      }

      const mergedPhotos = new Map(state.photos.map((photo) => [photo.id, photo]))
      for (const photo of photos) mergedPhotos.set(photo.id, photo)
      const sourceKeys = new Set()
      for (const photo of mergedPhotos.values()) {
        const sourceKey = linkedPhotoSourceKey(photo)
        if (sourceKeys.has(sourceKey)) throw new Error('This local photo is already linked to the application.')
        sourceKeys.add(sourceKey)
      }

      state.photos = Array.from(mergedPhotos.values())
      return photos
    })
  }

  async deletePhoto(photoId) {
    const normalizedPhotoId = requireNonEmptyString(photoId, 'Photo id')
    return this.mutate((state) => {
      state.photos = state.photos.filter((photo) => photo.id !== normalizedPhotoId)
      return undefined
    })
  }

  async deletePhotos(photoIds) {
    if (!Array.isArray(photoIds)) throw new Error('Photo ids must be an array.')
    const normalizedPhotoIds = new Set(photoIds.map((photoId) => requireNonEmptyString(photoId, 'Photo id')))
    return this.mutate((state) => {
      const deletedPhotoIds = state.photos
        .filter((photo) => normalizedPhotoIds.has(photo.id))
        .map((photo) => photo.id)
      state.photos = state.photos.filter((photo) => !normalizedPhotoIds.has(photo.id))
      return deletedPhotoIds
    })
  }

  async deleteTripData(tripId, segmentIds = []) {
    const normalizedTripId = requireNonEmptyString(tripId, 'Trip id')
    if (!Array.isArray(segmentIds)) throw new Error('Segment ids must be an array.')
    const normalizedSegmentIds = new Set(
      segmentIds.map((segmentId) => requireNonEmptyString(segmentId, 'Segment id')),
    )

    return this.mutate((state) => {
      const deletedRootIds = state.roots
        .filter((root) => root.tripId === normalizedTripId)
        .map((root) => root.id)
      const deletedRootIdSet = new Set(deletedRootIds)
      const deletedPhotoIds = state.photos
        .filter((photo) => (
          deletedRootIdSet.has(photo.libraryRootId) || normalizedSegmentIds.has(photo.segmentId)
        ))
        .map((photo) => photo.id)
      const deletedPhotoIdSet = new Set(deletedPhotoIds)

      state.photos = state.photos.filter((photo) => !deletedPhotoIdSet.has(photo.id))
      state.roots = state.roots.filter((root) => !deletedRootIdSet.has(root.id))
      return { deletedPhotoIds, deletedRootIds }
    })
  }
}

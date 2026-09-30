import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPhotoConsistency, createPhotoConsistencyRepair } from '../src/services/photoConsistency.ts'

function photo(id, segmentId) {
  return {
    id,
    segmentId,
    storageMode: 'linked',
    libraryRootId: 'root-1',
    relativePath: `${id}.jpg`,
    originalFilename: `${id}.jpg`,
    importedAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    fingerprint: { size: 1, modifiedAt: 1 },
  }
}

const tripReview = {
  trips: [
    {
      id: 'review', category: 'review', days: [{ id: 'day-1', routeSegments: [
        { id: 'segment-1', photoIds: ['photo-duplicate', 'photo-mismatch', 'photo-missing'] },
        { id: 'segment-2', photoIds: ['photo-duplicate'] },
      ] }],
    },
    {
      id: 'plan', category: 'plan', days: [{ id: 'day-2', routeSegments: [
        { id: 'segment-plan', photoIds: ['photo-plan'] },
      ] }],
    },
  ],
}

test('photo consistency audit reports missing, orphan, plan, duplicate and mismatched relationships', () => {
  const photos = [
    photo('photo-duplicate', 'segment-2'),
    photo('photo-mismatch', 'old-segment'),
    photo('photo-orphan', 'segment-1'),
  ]
  const report = auditPhotoConsistency(tripReview, photos)
  assert.deepEqual(report.missingMetadataPhotoIds, ['photo-missing'])
  assert.deepEqual(report.orphanMetadataPhotoIds, ['photo-orphan'])
  assert.deepEqual(report.planPhotoIds, ['photo-plan'])
  assert.deepEqual(report.duplicateReferences, [{ photoId: 'photo-duplicate', segmentIds: ['segment-1', 'segment-2'] }])
  assert.deepEqual(report.segmentMismatches, [{
    photoId: 'photo-mismatch',
    metadataSegmentId: 'old-segment',
    referencedSegmentId: 'segment-1',
  }])
})

test('photo consistency repair keeps one review relationship and updates metadata segment ownership', () => {
  const photos = [
    photo('photo-duplicate', 'segment-2'),
    photo('photo-mismatch', 'old-segment'),
    photo('photo-orphan', 'segment-1'),
  ]
  const repaired = createPhotoConsistencyRepair(tripReview, photos)
  const reviewSegments = repaired.tripReview.trips[0].days[0].routeSegments
  assert.deepEqual(reviewSegments[0].photoIds, ['photo-mismatch'])
  assert.deepEqual(reviewSegments[1].photoIds, ['photo-duplicate'])
  assert.equal(repaired.tripReview.trips[1].days[0].routeSegments[0].photoIds, undefined)
  assert.equal(repaired.photoUpdates.find((item) => item.id === 'photo-mismatch').segmentId, 'segment-1')
})

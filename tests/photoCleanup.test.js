import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectReferencedPhotoIds,
  deleteLinkedPhotoRecords,
  removePhotoReferences,
} from '../src/services/photoCleanup.ts'

test('collectReferencedPhotoIds deduplicates review photo associations and ignores plan trips', () => {
  const data = {
    trips: [
      {
        id: 'review', category: 'review', title: 'Review', startDate: '', endDate: '',
        days: [{ id: 'day-1', date: '', routeSegments: [
          { id: 'segment-1', name: '', date: '', startPoint: '', endPoint: '', photoIds: ['photo-1', 'photo-2'] },
          { id: 'segment-2', name: '', date: '', startPoint: '', endPoint: '', photoIds: ['photo-2'] },
        ] }],
      },
      {
        id: 'plan', category: 'plan', title: 'Plan', startDate: '', endDate: '',
        days: [{ id: 'day-2', date: '', routeSegments: [
          { id: 'segment-3', name: '', date: '', startPoint: '', endPoint: '', photoIds: ['photo-plan'] },
        ] }],
      },
    ],
  }

  assert.deepEqual(collectReferencedPhotoIds(data), ['photo-1', 'photo-2'])
})

test('deleteLinkedPhotoRecords continues after failures and deduplicates ids', async () => {
  const attempts = []
  const repository = {
    async deletePhoto(photoId) {
      attempts.push(photoId)
      if (photoId === 'photo-2') throw new Error('locked')
    },
  }

  const result = await deleteLinkedPhotoRecords(repository, ['photo-1', 'photo-2', 'photo-1', ''])
  assert.deepEqual(attempts, ['photo-1', 'photo-2'])
  assert.deepEqual(result.deletedPhotoIds, ['photo-1'])
  assert.deepEqual(result.failures, [{ photoId: 'photo-2', error: 'locked' }])
})

test('removePhotoReferences removes missing ids and drops empty photo arrays', () => {
  const data = {
    trips: [{
      id: 'review', category: 'review', title: 'Review', startDate: '', endDate: '',
      days: [{ id: 'day-1', date: '', routeSegments: [
        { id: 'segment-1', name: '', date: '', startPoint: '', endPoint: '', photoIds: ['keep', 'missing'] },
        { id: 'segment-2', name: '', date: '', startPoint: '', endPoint: '', photoIds: ['missing'] },
      ] }],
    }],
  }

  const cleaned = removePhotoReferences(data, ['missing'])
  assert.deepEqual(cleaned.trips[0].days[0].routeSegments[0].photoIds, ['keep'])
  assert.equal(cleaned.trips[0].days[0].routeSegments[1].photoIds, undefined)
})

test('removePhotoReferences clears the trip cover when the cover photo is removed', () => {
  const data = {
    trips: [{
      id: 'review', category: 'review', title: 'Review', startDate: '', endDate: '',
      coverPhotoId: 'cover-photo',
      days: [{ id: 'day-1', date: '', routeSegments: [
        { id: 'segment-1', name: '', date: '', startPoint: '', endPoint: '', photoIds: ['cover-photo', 'keep'] },
      ] }],
    }],
  }
  const cleaned = removePhotoReferences(data, ['cover-photo'])
  assert.equal(cleaned.trips[0].coverPhotoId, undefined)
  assert.deepEqual(cleaned.trips[0].days[0].routeSegments[0].photoIds, ['keep'])

  const untouched = removePhotoReferences(data, ['other-photo'])
  assert.equal(untouched.trips[0].coverPhotoId, 'cover-photo')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { commitDesktopRestoreTransaction } from '../src/services/backupRestoreTransaction.ts'

const currentTripReview = { trips: [{ id: 'old', days: [] }] }
const nextTripReview = { trips: [{ id: 'new', days: [] }] }
const currentRoutes = [{ segmentId: 'old', routeBuildKey: 'old-key', points: [{ lat: 1, lon: 1 }], updatedAt: 1 }]
const nextRoutes = [{ segmentId: 'new', routeBuildKey: 'new-key', points: [{ lat: 2, lon: 2 }], updatedAt: 2 }]

test('desktop restore transaction restores trip storage and routes when photo commit fails', async () => {
  const persistedTrips = []
  const replacedRoutes = []
  await assert.rejects(commitDesktopRestoreTransaction({
    currentTripReview,
    nextTripReview,
    currentRoutes,
    nextRoutes,
    persistTripReview: (value) => persistedTrips.push(value),
    replaceRoutes: async (value) => {
      replacedRoutes.push(value)
      return value.length
    },
    commitPhotos: async () => {
      throw new Error('photo commit failed')
    },
  }), /photo commit failed/)

  assert.deepEqual(persistedTrips, [nextTripReview, currentTripReview])
  assert.deepEqual(replacedRoutes, [nextRoutes, currentRoutes])
})

test('desktop restore transaction reports the imported route count after all stores commit', async () => {
  let photoCommitted = false
  const count = await commitDesktopRestoreTransaction({
    currentTripReview,
    nextTripReview,
    currentRoutes,
    nextRoutes,
    persistTripReview: () => undefined,
    replaceRoutes: async (value) => value.length,
    commitPhotos: async () => { photoCommitted = true },
  })
  assert.equal(count, 1)
  assert.equal(photoCommitted, true)
})

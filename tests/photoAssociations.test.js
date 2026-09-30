import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadPhotoAssociations() {
  const source = await readFile(new URL('../src/services/photoAssociations.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

function createTripReview(category = 'review') {
  return {
    trips: [{
      id: 'trip-1',
      title: 'Trip',
      category,
      startDate: '2026-07-11',
      endDate: '2026-07-11',
      days: [{
        id: 'day-1',
        date: '2026-07-11',
        routeSegments: [{
          id: 'segment-1',
          name: 'Segment',
          startPoint: 'A',
          endPoint: 'B',
          preference: 'HIGHWAY_FIRST',
        }],
      }],
    }],
  }
}

test('photo association attaches once and detaches cleanly from review segments', async () => {
  const { attachPhotoToReviewSegment, detachPhotoFromReviewSegment } = await loadPhotoAssociations()
  const original = createTripReview()
  const attached = attachPhotoToReviewSegment(original, 'segment-1', 'photo-1')
  const attachedAgain = attachPhotoToReviewSegment(attached, 'segment-1', 'photo-1')

  assert.equal(original.trips[0].days[0].routeSegments[0].photoIds, undefined)
  assert.deepEqual(attachedAgain.trips[0].days[0].routeSegments[0].photoIds, ['photo-1'])

  const detached = detachPhotoFromReviewSegment(attachedAgain, 'segment-1', 'photo-1')
  assert.equal(detached.trips[0].days[0].routeSegments[0].photoIds, undefined)
})
test('photo association rejects plan trips and unknown review segments', async () => {
  const { attachPhotoToReviewSegment } = await loadPhotoAssociations()

  assert.throws(() => attachPhotoToReviewSegment(createTripReview('plan'), 'segment-1', 'photo-1'), /review trips/)
  assert.throws(() => attachPhotoToReviewSegment(createTripReview(), 'missing-segment', 'photo-1'), /not found/)
})

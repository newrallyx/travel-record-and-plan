import test from 'node:test'
import assert from 'node:assert/strict'
import { createCandidatePreviewLoader } from '../src/services/photoCandidatePreview.ts'

test('candidate preview loader limits reads and deduplicates the same source', async () => {
  let active = 0
  let peak = 0
  let reads = 0
  const load = createCandidatePreviewLoader({
    maxConcurrency: 2,
    readPhoto: async (_rootId, relativePath) => {
      reads += 1
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { data: new TextEncoder().encode(relativePath), mimeType: 'image/jpeg' }
    },
    createPreview: async (blob) => ({ blob, mimeType: 'image/webp' }),
  })

  const duplicateA = load('root', 'a.jpg')
  const duplicateB = load('root', 'a.jpg')
  await Promise.all([duplicateA, duplicateB, load('root', 'b.jpg'), load('root', 'c.jpg')])

  assert.equal(reads, 3)
  assert.equal(peak, 2)
})

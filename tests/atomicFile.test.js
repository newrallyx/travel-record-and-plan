import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { replaceFileAtomically, writeFileAtomically } from '../backend/src/atomicFile.js'

test('atomic output preserves existing content on partial write and removes only its temporary file', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-atomic-file-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'backup.zip')
  await writeFile(target, 'old complete backup')
  await assert.rejects(replaceFileAtomically(target, async (temporary) => {
    await writeFile(temporary, 'partial new backup')
    throw new Error('disk write failure')
  }), /disk write failure/)
  assert.equal(await readFile(target, 'utf8'), 'old complete backup')
  assert.deepEqual(await readdir(directory), ['backup.zip'])
  await writeFileAtomically(target, 'new complete backup')
  assert.equal(await readFile(target, 'utf8'), 'new complete backup')
  assert.deepEqual(await readdir(directory), ['backup.zip'])
})

test('failed atomic replacement preserves the occupied destination and cleans staging', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roadtrip-atomic-file-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = path.join(directory, 'occupied')
  await mkdir(target)
  await writeFile(path.join(target, 'keep.txt'), 'keep')
  await assert.rejects(writeFileAtomically(target, 'replacement'))
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep')
  assert.deepEqual(await readdir(directory), ['occupied'])
})

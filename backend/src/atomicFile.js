import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Keep the previous file until the new file has been completely written. */
export async function replaceFileAtomically(filePath, writeTemporaryFile) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('File path must be absolute.')
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    const result = await writeTemporaryFile(tempPath)
    await rename(tempPath, filePath)
    return result
  } finally {
    await rm(tempPath, { force: true })
  }
}

export function writeFileAtomically(filePath, data, options) {
  return replaceFileAtomically(filePath, (tempPath) => writeFile(tempPath, data, options))
}

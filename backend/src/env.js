import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function normalizePath(filePath) {
  return path.resolve(filePath)
}

function uniquePaths(paths) {
  const seen = new Set()
  const result = []

  for (const filePath of paths) {
    const normalized = normalizePath(filePath)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function loadBackendEnv() {
  const projectRoot = path.resolve(__dirname, '..', '..')
  const cwd = process.cwd()

  const candidates = uniquePaths([
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.env.local'),
    path.join(cwd, '.env'),
    path.join(cwd, '.env.local'),
  ])

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue
    dotenv.config({ path: filePath, override: true })
  }
}

export function resolveAmapWebApiKey(env = process.env) {
  if (env.AMAP_WEB_API_KEY) return { key: env.AMAP_WEB_API_KEY, source: 'AMAP_WEB_API_KEY' }
  if (env.AMAP_WEB_KEY) return { key: env.AMAP_WEB_KEY, source: 'AMAP_WEB_KEY' }
  if (env.AMAP_KEY) return { key: env.AMAP_KEY, source: 'AMAP_KEY' }
  return { key: '', source: null }
}

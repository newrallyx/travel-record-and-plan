import fs from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const sourceFile = process.argv[2]
  ? path.resolve(projectRoot, process.argv[2])
  : path.join(projectRoot, 'backup', 'demo-data.json')
const outputDir = path.join(projectRoot, 'public', 'demo-data')

// Keep chunks below common static-hosting limits with some safety margin.
const MAX_BYTES = 22 * 1024 * 1024

function byteSize(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8')
}

async function main() {
  const raw = await fs.readFile(sourceFile, 'utf8')
  const data = JSON.parse(raw)

  if (!data || !Array.isArray(data.trips)) {
    throw new Error('Demo data must be an object with a trips array.')
  }

  const trips = data.trips
  if (trips.length === 0) {
    throw new Error('Demo data has no trips to split.')
  }

  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const groups = []
  let currentGroup = []

  for (const trip of trips) {
    const singleTripSize = byteSize({ trips: [trip] })
    if (singleTripSize > MAX_BYTES) {
      throw new Error(
        `A single trip is too large to split safely. Size: ${(singleTripSize / 1024 / 1024).toFixed(2)} MB`,
      )
    }

    const testGroup = { trips: [...currentGroup, trip] }
    const testSize = byteSize(testGroup)

    if (currentGroup.length > 0 && testSize > MAX_BYTES) {
      groups.push(currentGroup)
      currentGroup = [trip]
    } else {
      currentGroup.push(trip)
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  const manifest = { files: [] }

  for (let i = 0; i < groups.length; i++) {
    const fileName = `part-${String(i + 1).padStart(2, '0')}.json`
    const filePath = path.join(outputDir, fileName)
    const content = { trips: groups[i] }

    await fs.writeFile(filePath, JSON.stringify(content), 'utf8')
    manifest.files.push(`/demo-data/${fileName}`)

    const sizeMB = (byteSize(content) / 1024 / 1024).toFixed(2)
    console.log(`Generated ${fileName}: ${sizeMB} MB, trips: ${groups[i].length}`)
  }

  const manifestPath = path.join(outputDir, 'manifest.json')
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`\nSplit complete. Generated ${groups.length} chunk file(s).`)
  console.log('Manifest: public/demo-data/manifest.json')
}

main().catch((err) => {
  console.error('Split failed:', err.message)
  process.exit(1)
})

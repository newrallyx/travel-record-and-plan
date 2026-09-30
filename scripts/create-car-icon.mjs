import fs from 'node:fs'
import path from 'node:path'

const outputDir = path.resolve('build')
const outputFile = path.join(outputDir, 'icon.ico')
const sizes = [16, 24, 32, 48, 64, 128, 256]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function makeCanvas(size) {
  return new Uint8ClampedArray(size * size * 4)
}

function setPixel(canvas, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const alpha = color[3] / 255
  const index = (y * size + x) * 4
  canvas[index] = Math.round(color[0] * alpha + canvas[index] * (1 - alpha))
  canvas[index + 1] = Math.round(color[1] * alpha + canvas[index + 1] * (1 - alpha))
  canvas[index + 2] = Math.round(color[2] * alpha + canvas[index + 2] * (1 - alpha))
  canvas[index + 3] = Math.round(color[3] + canvas[index + 3] * (1 - alpha))
}

function fillRoundedRect(canvas, size, x, y, width, height, radius, color) {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const right = Math.ceil(x + width)
  const bottom = Math.ceil(y + height)

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const cx = px < x + radius ? x + radius : px > x + width - radius ? x + width - radius : px
      const cy = py < y + radius ? y + radius : py > y + height - radius ? y + height - radius : py
      const dx = px - cx
      const dy = py - cy
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(canvas, size, px, py, color)
      }
    }
  }
}

function fillPolygon(canvas, size, points, color) {
  const minY = Math.floor(Math.min(...points.map((point) => point[1])))
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])))

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = []
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % points.length]
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
    }

    intersections.sort((a, b) => a - b)
    for (let i = 0; i < intersections.length; i += 2) {
      const start = Math.floor(intersections[i])
      const end = Math.ceil(intersections[i + 1])
      for (let x = start; x <= end; x += 1) {
        setPixel(canvas, size, x, y, color)
      }
    }
  }
}

function fillCircle(canvas, size, cx, cy, radius, color) {
  const left = Math.floor(cx - radius)
  const right = Math.ceil(cx + radius)
  const top = Math.floor(cy - radius)
  const bottom = Math.ceil(cy + radius)

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(canvas, size, x, y, color)
      }
    }
  }
}

function drawCarIcon(size) {
  const canvas = makeCanvas(size)
  const scale = size / 256

  const blue = [37, 99, 235, 255]
  const blueDark = [30, 64, 175, 255]
  const sky = [186, 230, 253, 255]
  const white = [255, 255, 255, 255]
  const tire = [17, 24, 39, 255]
  const hub = [229, 231, 235, 255]
  const shadow = [15, 23, 42, 42]

  fillRoundedRect(canvas, size, 34 * scale, 158 * scale, 188 * scale, 24 * scale, 12 * scale, shadow)
  fillRoundedRect(canvas, size, 38 * scale, 104 * scale, 180 * scale, 70 * scale, 20 * scale, blue)
  fillPolygon(
    canvas,
    size,
    [
      [76 * scale, 106 * scale],
      [104 * scale, 68 * scale],
      [158 * scale, 68 * scale],
      [190 * scale, 106 * scale],
    ],
    blueDark,
  )
  fillPolygon(
    canvas,
    size,
    [
      [96 * scale, 98 * scale],
      [113 * scale, 78 * scale],
      [134 * scale, 78 * scale],
      [134 * scale, 98 * scale],
    ],
    sky,
  )
  fillPolygon(
    canvas,
    size,
    [
      [142 * scale, 98 * scale],
      [142 * scale, 78 * scale],
      [154 * scale, 78 * scale],
      [174 * scale, 98 * scale],
    ],
    sky,
  )

  fillRoundedRect(canvas, size, 50 * scale, 124 * scale, 36 * scale, 14 * scale, 7 * scale, white)
  fillRoundedRect(canvas, size, 181 * scale, 124 * scale, 25 * scale, 14 * scale, 7 * scale, [254, 240, 138, 255])

  for (const cx of [78, 178]) {
    fillCircle(canvas, size, cx * scale, 172 * scale, 25 * scale, tire)
    fillCircle(canvas, size, cx * scale, 172 * scale, 11 * scale, hub)
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      if (canvas[index + 3] === 0) continue
      const shine = clamp(1 + (size - y) / size * 0.08, 1, 1.08)
      canvas[index] = clamp(Math.round(canvas[index] * shine), 0, 255)
      canvas[index + 1] = clamp(Math.round(canvas[index + 1] * shine), 0, 255)
      canvas[index + 2] = clamp(Math.round(canvas[index + 2] * shine), 0, 255)
    }
  }

  return canvas
}

function makeDib(canvas, size) {
  const xorStride = size * 4
  const andStride = Math.ceil(size / 32) * 4
  const headerSize = 40
  const xorSize = xorStride * size
  const andSize = andStride * size
  const buffer = Buffer.alloc(headerSize + xorSize + andSize)

  buffer.writeUInt32LE(headerSize, 0)
  buffer.writeInt32LE(size, 4)
  buffer.writeInt32LE(size * 2, 8)
  buffer.writeUInt16LE(1, 12)
  buffer.writeUInt16LE(32, 14)
  buffer.writeUInt32LE(0, 16)
  buffer.writeUInt32LE(xorSize + andSize, 20)
  buffer.writeInt32LE(0, 24)
  buffer.writeInt32LE(0, 28)
  buffer.writeUInt32LE(0, 32)
  buffer.writeUInt32LE(0, 36)

  let offset = headerSize
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4
      buffer[offset] = canvas[source + 2]
      buffer[offset + 1] = canvas[source + 1]
      buffer[offset + 2] = canvas[source]
      buffer[offset + 3] = canvas[source + 3]
      offset += 4
    }
  }

  return buffer
}

function makeIco(images) {
  const headerSize = 6
  const directorySize = images.length * 16
  let imageOffset = headerSize + directorySize
  const entries = []

  for (const image of images) {
    entries.push({ ...image, offset: imageOffset })
    imageOffset += image.data.length
  }

  const output = Buffer.alloc(imageOffset)
  output.writeUInt16LE(0, 0)
  output.writeUInt16LE(1, 2)
  output.writeUInt16LE(images.length, 4)

  let offset = headerSize
  for (const image of entries) {
    output[offset] = image.size === 256 ? 0 : image.size
    output[offset + 1] = image.size === 256 ? 0 : image.size
    output[offset + 2] = 0
    output[offset + 3] = 0
    output.writeUInt16LE(1, offset + 4)
    output.writeUInt16LE(32, offset + 6)
    output.writeUInt32LE(image.data.length, offset + 8)
    output.writeUInt32LE(image.offset, offset + 12)
    image.data.copy(output, image.offset)
    offset += 16
  }

  return output
}

fs.mkdirSync(outputDir, { recursive: true })

const images = sizes.map((size) => ({
  size,
  data: makeDib(drawCarIcon(size), size),
}))

fs.writeFileSync(outputFile, makeIco(images))
console.log(`Created ${outputFile}`)

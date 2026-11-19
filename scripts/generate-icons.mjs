import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = join(root, 'icons')

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[index] = crc >>> 0
  }
  return table
})()

const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const typeBytes = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

const encodePng = (width, height, rgba) => {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowStart + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const insideRoundRect = (px, py, left, top, right, bottom, radius) => {
  if (px < left || py < top || px >= right || py >= bottom) return false
  const nearestX = Math.min(Math.max(px, left + radius), right - radius)
  const nearestY = Math.min(Math.max(py, top + radius), bottom - radius)
  const dx = px - nearestX
  const dy = py - nearestY
  return dx * dx + dy * dy <= radius * radius
}

const fillRoundRect = (pixels, size, { x, y, w, h, r, color }) => {
  const right = x + w
  const bottom = y + h
  const radius = Math.min(r, w / 2, h / 2)
  const startX = Math.max(0, Math.floor(x))
  const startY = Math.max(0, Math.floor(y))
  const endX = Math.min(size, Math.ceil(right))
  const endY = Math.min(size, Math.ceil(bottom))

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      if (!insideRoundRect(px + 0.5, py + 0.5, x, y, right, bottom, radius)) continue
      const index = (py * size + px) * 4
      pixels[index] = color[0]
      pixels[index + 1] = color[1]
      pixels[index + 2] = color[2]
      pixels[index + 3] = color[3]
    }
  }
}

const fillCircle = (pixels, size, { cx, cy, r, color }) => {
  const startX = Math.max(0, Math.floor(cx - r))
  const startY = Math.max(0, Math.floor(cy - r))
  const endX = Math.min(size, Math.ceil(cx + r))
  const endY = Math.min(size, Math.ceil(cy + r))

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const dx = px + 0.5 - cx
      const dy = py + 0.5 - cy
      if (dx * dx + dy * dy > r * r) continue
      const index = (py * size + px) * 4
      pixels[index] = color[0]
      pixels[index + 1] = color[1]
      pixels[index + 2] = color[2]
      pixels[index + 3] = color[3]
    }
  }
}

const paint = (pixels, size) => {
  fillRoundRect(pixels, size, {
    x: size * 0.08,
    y: size * 0.08,
    w: size * 0.84,
    h: size * 0.84,
    r: size * 0.22,
    color: [31, 94, 255, 255],
  })

  const bars = [
    { y: 0.3, w: 0.42 },
    { y: 0.46, w: 0.34 },
    { y: 0.62, w: 0.24 },
  ]

  for (const bar of bars) {
    fillRoundRect(pixels, size, {
      x: size * 0.24,
      y: size * bar.y,
      w: size * bar.w,
      h: size * 0.07,
      r: size * 0.035,
      color: [255, 255, 255, 255],
    })
  }

  fillCircle(pixels, size, {
    cx: size * 0.7,
    cy: size * 0.7,
    r: size * 0.075,
    color: [255, 191, 60, 255],
  })
}

const renderIcon = (size) => {
  const scale = 4
  const big = size * scale
  const samples = new Uint8Array(big * big * 4)
  paint(samples, big)

  const output = new Uint8Array(size * size * 4)
  const sampleCount = scale * scale
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0

      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * big + (x * scale + sx)) * 4
          const sampleAlpha = samples[index + 3]
          red += samples[index] * sampleAlpha
          green += samples[index + 1] * sampleAlpha
          blue += samples[index + 2] * sampleAlpha
          alpha += sampleAlpha
        }
      }

      const out = (y * size + x) * 4
      if (alpha === 0) continue
      output[out] = Math.round(red / alpha)
      output[out + 1] = Math.round(green / alpha)
      output[out + 2] = Math.round(blue / alpha)
      output[out + 3] = Math.round(alpha / sampleCount)
    }
  }

  return output
}

mkdirSync(iconsDir, { recursive: true })

for (const size of [16, 48, 128]) {
  const png = encodePng(size, size, renderIcon(size))
  writeFileSync(join(iconsDir, `icon${size}.png`), png)
}

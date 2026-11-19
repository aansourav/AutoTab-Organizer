import { inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const decodePng = (buffer) => {
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (bitDepth !== 8 || channels === 0) throw new Error('This PNG is not 8-bit RGB.')

  const inflated = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * 4)
  let source = 0
  let previous = Buffer.alloc(stride)

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source]
    source += 1
    const row = Buffer.from(inflated.subarray(source, source + stride))
    source += stride

    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? row[index - channels] : 0
      const up = previous[index]
      const upLeft = index >= channels ? previous[index - channels] : 0
      if (filter === 1) row[index] = (row[index] + left) & 255
      else if (filter === 2) row[index] = (row[index] + up) & 255
      else if (filter === 3) row[index] = (row[index] + ((left + up) >> 1)) & 255
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const distanceLeft = Math.abs(estimate - left)
        const distanceUp = Math.abs(estimate - up)
        const distanceUpLeft = Math.abs(estimate - upLeft)
        const predictor =
          distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
            ? left
            : distanceUp <= distanceUpLeft
              ? up
              : upLeft
        row[index] = (row[index] + predictor) & 255
      }
    }

    previous = row
    for (let x = 0; x < width; x += 1) {
      const from = x * channels
      const to = (y * width + x) * 4
      rgba[to] = row[from]
      rgba[to + 1] = channels > 1 ? row[from + 1] : row[from]
      rgba[to + 2] = channels > 2 ? row[from + 2] : row[from]
      rgba[to + 3] = 255
    }
  }

  return { width, height, rgba }
}

const fit = (image, maxWidth) => {
  if (image.width <= maxWidth) return image
  const width = maxWidth
  const height = Math.max(1, Math.round((image.height * maxWidth) / image.width))
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width))
      const from = (sourceY * image.width + sourceX) * 4
      const to = (y * width + x) * 4
      rgba[to] = image.rgba[from]
      rgba[to + 1] = image.rgba[from + 1]
      rgba[to + 2] = image.rgba[from + 2]
      rgba[to + 3] = 255
    }
  }
  return { width, height, rgba }
}

const buildPalette = (frames) => {
  const counts = new Map()
  for (const frame of frames) {
    const step = Math.max(1, Math.floor((frame.width * frame.height) / 20000))
    for (let pixel = 0; pixel < frame.width * frame.height; pixel += step) {
      const offset = pixel * 4
      const key =
        ((frame.rgba[offset] >> 3) << 10) |
        ((frame.rgba[offset + 1] >> 3) << 5) |
        (frame.rgba[offset + 2] >> 3)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const palette = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 256)
    .map(([key]) => [(key >> 10) << 3, ((key >> 5) & 31) << 3, (key & 31) << 3])

  const lookup = new Uint8Array(32768)
  for (let key = 0; key < lookup.length; key += 1) {
    const red = (key >> 10) << 3
    const green = ((key >> 5) & 31) << 3
    const blue = (key & 31) << 3
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < palette.length; index += 1) {
      const [paletteRed, paletteGreen, paletteBlue] = palette[index]
      const distance =
        (red - paletteRed) ** 2 + (green - paletteGreen) ** 2 + (blue - paletteBlue) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
      }
    }
    lookup[key] = best
  }

  return { palette, lookup }
}

const indexFrame = (frame, palette) => {
  const indices = new Uint8Array(frame.width * frame.height)
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4
    const key =
      ((frame.rgba[offset] >> 3) << 10) |
      ((frame.rgba[offset + 1] >> 3) << 5) |
      (frame.rgba[offset + 2] >> 3)
    indices[pixel] = palette.lookup[key]
  }
  return indices
}

const lzw = (indices, minCodeSize) => {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let dictionary = new Map()
  const bytes = []
  let buffer = 0
  let bits = 0

  const emit = (code) => {
    buffer |= code << bits
    bits += codeSize
    while (bits >= 8) {
      bytes.push(buffer & 255)
      buffer >>= 8
      bits -= 8
    }
  }

  const reset = () => {
    dictionary = new Map()
    codeSize = minCodeSize + 1
    nextCode = endCode + 1
  }

  emit(clearCode)
  reset()
  let prefix = String(indices[0])

  for (let index = 1; index < indices.length; index += 1) {
    const suffix = String(indices[index])
    const joined = `${prefix},${suffix}`
    if (dictionary.has(joined)) {
      prefix = joined
      continue
    }
    const code = prefix.includes(',') ? dictionary.get(prefix) : Number(prefix)
    emit(code)
    // The new code is written at the old width. The width grows on the
    // following code, once nextCode has already reached the current limit.
    if (nextCode === 4096) {
      emit(clearCode)
      reset()
    } else {
      if (nextCode >= 1 << codeSize && codeSize < 12) codeSize += 1
      dictionary.set(joined, nextCode)
      nextCode += 1
    }
    prefix = suffix
  }

  emit(prefix.includes(',') ? dictionary.get(prefix) : Number(prefix))
  emit(endCode)
  if (bits > 0) bytes.push(buffer & 255)
  return Buffer.from(bytes)
}

const subBlocks = (bytes) => {
  const parts = []
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const chunk = bytes.subarray(offset, offset + 255)
    parts.push(Buffer.from([chunk.length]), chunk)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

const padFrame = (image, width, height, paper) => {
  if (image.width === width && image.height === height) return image
  const rgba = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    rgba[offset] = paper[0]
    rgba[offset + 1] = paper[1]
    rgba[offset + 2] = paper[2]
    rgba[offset + 3] = 255
  }
  const originX = Math.floor((width - image.width) / 2)
  const originY = Math.floor((height - image.height) / 2)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + x) * 4
      const to = ((y + originY) * width + (x + originX)) * 4
      rgba[to] = image.rgba[from]
      rgba[to + 1] = image.rgba[from + 1]
      rgba[to + 2] = image.rgba[from + 2]
      rgba[to + 3] = 255
    }
  }
  return { width, height, rgba }
}

const encodeGif = (frames, delayCs) => {
  const width = Math.max(...frames.map((frame) => frame.width))
  const height = Math.max(...frames.map((frame) => frame.height))
  const paper = [20, 26, 34]
  const fitted = frames.map((frame) => padFrame(frame, width, height, paper))
  const palette = buildPalette(fitted)
  const colorTable = Buffer.alloc(256 * 3)
  palette.palette.forEach(([red, green, blue], index) => {
    colorTable[index * 3] = red
    colorTable[index * 3 + 1] = green
    colorTable[index * 3 + 2] = blue
  })

  const header = Buffer.alloc(13)
  header.write('GIF89a', 0, 'ascii')
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  header[10] = 0xf7
  header[11] = 0
  header[12] = 0

  const loop = Buffer.from([0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00])
  const blocks = [header, colorTable, loop]

  for (const frame of fitted) {
    const control = Buffer.alloc(8)
    control[0] = 0x21
    control[1] = 0xf9
    control[2] = 0x04
    control[3] = 0x08
    control.writeUInt16LE(delayCs, 4)
    control[6] = 0
    control[7] = 0

    const descriptor = Buffer.alloc(10)
    descriptor[0] = 0x2c
    descriptor.writeUInt16LE(0, 1)
    descriptor.writeUInt16LE(0, 3)
    descriptor.writeUInt16LE(width, 5)
    descriptor.writeUInt16LE(height, 7)
    descriptor[9] = 0

    const compressed = lzw(indexFrame(frame, palette), 8)
    blocks.push(control, descriptor, Buffer.from([8]), subBlocks(compressed))
  }

  blocks.push(Buffer.from([0x3b]))
  return Buffer.concat(blocks)
}

const frames = process.argv.slice(2, -1).map((path) => fit(decodePng(readFileSync(path)), 1100))
const output = process.argv.at(-1)
if (frames.length === 0 || !output) {
  throw new Error('Usage: node scripts/make-demo-gif.mjs frame.png [frame.png...] out.gif')
}

writeFileSync(output, encodeGif(frames, 180))
console.log(`wrote ${output} (${frames.length} frames)`)

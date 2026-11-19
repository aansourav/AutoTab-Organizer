export const GROUP_COLORS = [
  { id: 'grey', label: 'Grey', swatch: '#5f6368' },
  { id: 'blue', label: 'Blue', swatch: '#1a73e8' },
  { id: 'red', label: 'Red', swatch: '#d93025' },
  { id: 'yellow', label: 'Yellow', swatch: '#f9ab00' },
  { id: 'green', label: 'Green', swatch: '#188038' },
  { id: 'pink', label: 'Pink', swatch: '#d01884' },
  { id: 'purple', label: 'Purple', swatch: '#a142f4' },
  { id: 'cyan', label: 'Cyan', swatch: '#007b83' },
  { id: 'orange', label: 'Orange', swatch: '#e8710a' },
]

const GREY = GROUP_COLORS[0]
const BY_ID = new Map(GROUP_COLORS.map((color) => [color.id, color]))

export const isGroupColor = (value) => BY_ID.has(value)

const channel = (raw) => {
  if (!/^\d{1,3}$/.test(raw)) return undefined
  const number = Number(raw)
  if (number > 255) return undefined
  return number
}

const hexByte = (value) => value.toString(16).padStart(2, '0')

const channelsFromHex = (hex) => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

const hexFromChannels = (r, g, b) => `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`

const expandHex = (digits) => {
  if (digits.length === 3) return digits.split('').map((item) => item + item).join('')
  if (digits.length === 8) return digits.slice(0, 6)
  return digits
}

const parseRgb = (text) => {
  const match = text.match(
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*(?:,|\/)\s*[\d.]+%?)?\s*\)$/,
  ) ?? text.match(/^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/)
  if (!match) return undefined
  const [r, g, b] = match.slice(1, 4).map(channel)
  if (r == null || g == null || b == null) return undefined
  return hexFromChannels(r, g, b)
}

export const parseColor = (value) => {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return undefined

  const named = BY_ID.get(text)
  if (named) return named.swatch

  const digits = text.startsWith('#') ? text.slice(1) : text
  if (/^[0-9a-f]{3}$/.test(digits) || /^[0-9a-f]{6}$/.test(digits) || /^[0-9a-f]{8}$/.test(digits)) {
    return `#${expandHex(digits)}`
  }

  return parseRgb(text)
}

export const normalizeColor = (value) => parseColor(value) ?? GREY.swatch

export const rgbFromHex = (value) => channelsFromHex(normalizeColor(value))

const rgbToHsl = ({ r, g, b }) => {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l: lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  hue *= 60
  if (hue < 0) hue += 360
  return { h: hue, s: saturation, l: lightness }
}

const hueDistance = (left, right) => {
  const distance = Math.abs(left - right) % 360
  return Math.min(distance, 360 - distance)
}

const CHROMATIC = GROUP_COLORS.filter((color) => color.id !== 'grey').map((color) => ({
  id: color.id,
  hue: rgbToHsl(channelsFromHex(color.swatch)).h,
}))

export const chromeColorFor = (value) => {
  const hex = normalizeColor(value)
  const exact = GROUP_COLORS.find((color) => color.swatch === hex)
  if (exact) return exact.id

  const { h, s, l } = rgbToHsl(channelsFromHex(hex))
  if (s < 0.12 || l < 0.06 || l > 0.96) return GREY.id

  let nearest = CHROMATIC[0]
  let nearestDistance = hueDistance(h, nearest.hue)
  for (const color of CHROMATIC.slice(1)) {
    const distance = hueDistance(h, color.hue)
    if (distance < nearestDistance) {
      nearest = color
      nearestDistance = distance
    }
  }
  return nearest.id
}

export const chromeColorLabel = (value) =>
  BY_ID.get(chromeColorFor(value))?.label ?? GREY.label

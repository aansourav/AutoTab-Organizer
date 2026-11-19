const MAX_PATTERN_LENGTH = 180
const MAX_PATTERNS = 40
const MIN_KEYWORD_LENGTH = 3

export const normalizePattern = (pattern) => {
  let value = String(pattern ?? '').trim().toLowerCase()
  if (!value) return ''

  value = value.replace(/^https?:\/\//, '')
  value = value.replace(/[?#].*$/, '')
  value = value.replace(/\/+$/, '')

  const hasNestedDot = value.startsWith('www.') && value.indexOf('.', 4) !== -1
  if (hasNestedDot && !value.startsWith('*.')) {
    value = value.slice(4)
  }

  return value
}

export const parsePatternList = (value) => {
  const pieces = Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/)
  const seen = new Set()
  const patterns = []

  for (const piece of pieces) {
    const normalized = normalizePattern(piece)
    if (!normalized || normalized.length < 2 || normalized.length > MAX_PATTERN_LENGTH) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    patterns.push(normalized)
    if (patterns.length >= MAX_PATTERNS) break
  }

  return patterns
}

export const classifyPattern = (pattern) => {
  const normalized = normalizePattern(pattern)
  if (!normalized || normalized.length < 2) return undefined

  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(2)
    if (!suffix || (!suffix.includes('.') && suffix !== 'localhost')) return undefined
    return { kind: 'wildcard-domain', suffix }
  }

  if (normalized.startsWith('/')) {
    return { kind: 'path', path: normalized }
  }

  const slashAt = normalized.indexOf('/')
  if (slashAt !== -1) {
    const host = normalized.slice(0, slashAt)
    const path = normalized.slice(slashAt)
    if (!host || !path) return undefined
    return { kind: 'host-path', host, path }
  }

  if (isHostPattern(normalized)) return { kind: 'domain', host: normalized }
  if (normalized.length < MIN_KEYWORD_LENGTH) return undefined
  return { kind: 'keyword', text: normalized }
}

const isHostPattern = (pattern) =>
  pattern === 'localhost' || isIpv4(pattern) || pattern.includes('.')

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

export const isIpv4 = (host) => {
  if (!IPV4.test(host)) return false
  return host.split('.').every((part) => {
    const octet = Number(part)
    return octet >= 0 && octet <= 255 && String(octet) === part
  })
}

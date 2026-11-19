import { classifyPattern, isIpv4 } from './patterns.js'
import { chromeColorFor } from './color.js'
import { isGroupColor, ruleTitle } from './rules.js'

export const UNGROUPED_TAB_GROUP_ID = -1

const AUTO_GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey']

// A bundled public-suffix list would be heavier than this extension needs.
// These suffixes are the ones that would otherwise merge unrelated sites
// (bbc.co.uk with every .co.uk host, or every *.github.io page).
const THREE_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.mx',
  'co.nz',
  'com.sg',
  'co.za',
  'com.tr',
  'co.kr',
  'com.hk',
  'com.tw',
  'co.id',
  'com.ar',
  'co.in',
  'com.cn',
  'github.io',
  'blogspot.com',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
])

export const parseHttpUrl = (rawUrl) => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return undefined

  try {
    const url = new URL(rawUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}

export const isIgnoredUrl = (rawUrl) => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return true

  const lower = rawUrl.trim().toLowerCase()
  if (lower.startsWith('chrome://')) return true
  if (lower.startsWith('chrome-extension://')) return true
  if (lower.startsWith('chrome-untrusted://')) return true
  if (lower.startsWith('edge://')) return true
  if (lower.startsWith('about:')) return true
  if (lower.startsWith('devtools://')) return true
  if (lower.startsWith('view-source:')) return true

  return parseHttpUrl(rawUrl) == null
}

export const tabUrl = (tab) => tab?.url || tab?.pendingUrl || ''

export const isGroupableTab = (tab) => {
  if (!tab || tab.pinned === true) return false
  if (typeof tab.id !== 'number') return false
  return !isIgnoredUrl(tabUrl(tab))
}

const cleanHost = (hostname) => {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '')
  return host.startsWith('www.') ? host.slice(4) : host
}

export const registrableDomain = (hostname) => {
  const host = cleanHost(hostname)
  if (!host) return ''
  if (host === 'localhost' || isIpv4(host)) return host

  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')

  const lastTwo = parts.slice(-2).join('.')
  if (THREE_LABEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

export const registrableDomainFromUrl = (rawUrl) => {
  const parsed = parseHttpUrl(rawUrl)
  if (!parsed) return undefined
  const domain = registrableDomain(parsed.hostname)
  return domain || undefined
}

export const domainGroupTitle = (hostname) => {
  const registrable = registrableDomain(hostname)
  const label = registrable.split('.')[0] ?? ''
  if (!label) return 'Site'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export const titleFromHost = (host) => {
  const label = String(host ?? '').replace(/^www\./, '').split('.')[0] ?? ''
  if (!label) return 'New group'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export const suggestedPattern = (rawUrl) => {
  const parsed = parseHttpUrl(rawUrl)
  if (!parsed) return undefined

  const host = parsed.hostname.replace(/\.$/, '').toLowerCase()
  const registrable = registrableDomain(host)
  if (!registrable) return undefined
  if (host === registrable || host === `www.${registrable}`) return registrable
  return host
}

export const colorForDomain = (domain) => {
  let hash = 0
  for (const char of String(domain ?? '')) {
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  }
  const color = AUTO_GROUP_COLORS[hash % AUTO_GROUP_COLORS.length]
  return isGroupColor(color) ? color : 'grey'
}

const hostMatches = (hostname, hostPattern) => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (hostPattern.startsWith('*.')) {
    const suffix = hostPattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === hostPattern || host.endsWith(`.${hostPattern}`)
}

const pathMatches = (pathname, path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (pathname === normalizedPath) return true
  const prefix = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
  return pathname.startsWith(prefix)
}

const matchCorpus = (url) =>
  `${url.hostname}${url.pathname}${url.search}${url.hash}`.toLowerCase()

export const patternMatchesUrl = (pattern, rawUrl) => {
  const url = parseHttpUrl(rawUrl)
  const classified = classifyPattern(pattern)
  if (!url || !classified) return false

  if (classified.kind === 'wildcard-domain') return hostMatches(url.hostname, `*.${classified.suffix}`)
  if (classified.kind === 'domain') return hostMatches(url.hostname, classified.host)
  if (classified.kind === 'path') return pathMatches(url.pathname, classified.path)
  if (classified.kind === 'host-path') {
    return hostMatches(url.hostname, classified.host) && pathMatches(url.pathname, classified.path)
  }
  return matchCorpus(url).includes(classified.text)
}

export const findMatchingRule = (rawUrl, rules) => {
  if (isIgnoredUrl(rawUrl)) return undefined

  const ordered = [...(rules ?? [])].sort(
    (left, right) => (left.priority ?? 0) - (right.priority ?? 0),
  )

  return ordered.find((rule) =>
    (rule.patterns ?? []).some((pattern) => patternMatchesUrl(pattern, rawUrl)),
  )
}

export const targetFromRule = (rule) => ({
  key: `rule:${rule.id}`,
  title: ruleTitle(rule),
  color: chromeColorFor(rule.color),
  autoCollapse: rule.autoCollapse === true,
  priority: rule.priority ?? 0,
})

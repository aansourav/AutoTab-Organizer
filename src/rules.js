import { normalizeColor } from './color.js'
import { parsePatternList } from './patterns.js'

export { GROUP_COLORS, isGroupColor } from './color.js'

export const MAX_RULES = 80
const MAX_NAME_LENGTH = 60
const MIN_DOMAIN_THRESHOLD = 1
const MAX_DOMAIN_THRESHOLD = 50

export const DEFAULT_SETTINGS = {
  autoOrganizeEnabled: true,
  autoGroupByDomain: true,
  domainThreshold: 2,
  ignorePinnedTabs: true,
}

export const createRuleId = () => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const ruleTitle = (rule) => {
  const name = String(rule?.name ?? '').trim()
  return name || 'Untitled'
}

export const createRule = ({
  name = '',
  color = 'blue',
  patterns = [],
  autoCollapse = false,
} = {}) => ({
  id: createRuleId(),
  name: String(name).slice(0, MAX_NAME_LENGTH).trim(),
  color: normalizeColor(color),
  patterns: parsePatternList(patterns),
  autoCollapse: autoCollapse === true,
  priority: 0,
})

export const defaultRules = () => [
  {
    id: 'rule-youtube',
    name: 'YouTube',
    color: 'red',
    patterns: ['youtube.com', 'youtu.be'],
    autoCollapse: false,
    priority: 0,
  },
  {
    id: 'rule-social',
    name: 'Social',
    color: 'blue',
    patterns: ['facebook.com', 'x.com', 'twitter.com', 'instagram.com', 'reddit.com', 'linkedin.com'],
    autoCollapse: false,
    priority: 1,
  },
  {
    id: 'rule-email',
    name: 'Email',
    color: 'yellow',
    patterns: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'proton.me'],
    autoCollapse: false,
    priority: 2,
  },
  {
    id: 'rule-work',
    name: 'Work & Docs',
    color: 'green',
    patterns: ['docs.google.com', 'drive.google.com', 'notion.so', 'figma.com', 'slack.com'],
    autoCollapse: false,
    priority: 3,
  },
  {
    id: 'rule-dev',
    name: 'Dev',
    color: 'purple',
    patterns: ['github.com', 'stackoverflow.com', 'localhost', '127.0.0.1'],
    autoCollapse: false,
    priority: 4,
  },
]

export const defaultState = () => ({
  rules: defaultRules(),
  settings: { ...DEFAULT_SETTINGS },
})

export const normalizeSettings = (input = {}) => {
  const merged = { ...DEFAULT_SETTINGS, ...(input ?? {}) }
  const numeric = Number(merged.domainThreshold)
  const domainThreshold = Number.isFinite(numeric)
    ? Math.min(MAX_DOMAIN_THRESHOLD, Math.max(MIN_DOMAIN_THRESHOLD, Math.round(numeric)))
    : DEFAULT_SETTINGS.domainThreshold

  return {
    autoOrganizeEnabled: merged.autoOrganizeEnabled !== false,
    autoGroupByDomain: merged.autoGroupByDomain !== false,
    domainThreshold,
    ignorePinnedTabs: true,
  }
}

export const normalizeRule = (rule, index) => ({
  id: typeof rule?.id === 'string' && rule.id.trim() ? rule.id.trim() : createRuleId(),
  name: String(rule?.name ?? '').slice(0, MAX_NAME_LENGTH).trim(),
  color: normalizeColor(rule?.color),
  patterns: parsePatternList(rule?.patterns ?? []),
  autoCollapse: rule?.autoCollapse === true,
  priority: index,
})

export const normalizeState = (stored, { trustOrder = false } = {}) => {
  if (!Array.isArray(stored?.rules)) return defaultState()

  const source = trustOrder
    ? stored.rules
    : [...stored.rules].sort((left, right) => (left?.priority ?? 0) - (right?.priority ?? 0))

  return {
    rules: source.slice(0, MAX_RULES).map((rule, index) => normalizeRule(rule, index)),
    settings: normalizeSettings(stored.settings),
  }
}

export const serializeBackup = (state) =>
  JSON.stringify(
    {
      version: 1,
      rules: state.rules,
      settings: state.settings,
    },
    null,
    2,
  )

export const parseBackup = (raw, currentSettings = DEFAULT_SETTINGS) => {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.rules)) {
    throw new Error('This file has no rules array.')
  }

  const settings = data.settings
    ? normalizeSettings({ ...currentSettings, ...data.settings })
    : normalizeSettings(currentSettings)

  return normalizeState({ rules: data.rules, settings }, { trustOrder: true })
}

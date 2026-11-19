import {
  UNGROUPED_TAB_GROUP_ID,
  colorForDomain,
  domainGroupTitle,
  findMatchingRule,
  isGroupableTab,
  registrableDomainFromUrl,
  tabUrl,
  targetFromRule,
} from './matcher.js'

const DOMAIN_PRIORITY = 10_000

const titlesMatch = (left, right) => String(left ?? '').trim() === String(right ?? '').trim()

const countUnmatchedDomains = (tabs, rules) => {
  const counts = new Map()

  for (const tab of tabs) {
    const url = tabUrl(tab)
    if (findMatchingRule(url, rules)) continue
    const domain = registrableDomainFromUrl(url)
    if (!domain) continue
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }

  return counts
}

const domainTarget = (domain) => ({
  key: `domain:${domain}`,
  title: domainGroupTitle(domain),
  color: colorForDomain(domain),
  autoCollapse: false,
  priority: DOMAIN_PRIORITY,
})

const targetForTab = ({ tab, rules, settings, domainCounts }) => {
  const matched = findMatchingRule(tabUrl(tab), rules)
  if (matched) return targetFromRule(matched)
  if (settings.autoGroupByDomain !== true) return undefined

  const domain = registrableDomainFromUrl(tabUrl(tab))
  if (!domain) return undefined
  if ((domainCounts.get(domain) ?? 0) < settings.domainThreshold) return undefined
  return domainTarget(domain)
}

const isUngrouped = (tab) =>
  typeof tab.groupId !== 'number' || tab.groupId === UNGROUPED_TAB_GROUP_ID

const shouldIncludeDecision = (decision, decisions, touchedIds) => {
  if (!decision.target) return false
  if (touchedIds == null) return true
  if (touchedIds.has(decision.tab.id)) return true
  if (!decision.target.key.startsWith('domain:')) return false
  if (!isUngrouped(decision.tab)) return false

  return decisions.some(
    (other) => touchedIds.has(other.tab.id) && other.target?.key === decision.target.key,
  )
}

const groupInWindow = (groups, windowId, groupId) =>
  (groups ?? []).find((group) => group.id === groupId && group.windowId === windowId)

const isAlreadyInTarget = (tab, target, groups, windowId) => {
  if (isUngrouped(tab)) return false
  const group = groupInWindow(groups, windowId, tab.groupId)
  if (!group) return false
  return titlesMatch(group.title, target.title)
}

const findExistingGroupId = (groups, windowId, title) => {
  const matches = (groups ?? [])
    .filter((group) => group.windowId === windowId && titlesMatch(group.title, title))
    .sort((left, right) => left.id - right.id)

  return matches[0]?.id ?? null
}

const compareTargets = (left, right) => {
  if (left.priority !== right.priority) return left.priority - right.priority
  return left.title.localeCompare(right.title)
}

export const planWindowOrganization = ({
  tabs = [],
  groups = [],
  rules = [],
  settings,
  windowId,
  mode = 'all',
  tabIds = [],
}) => {
  const resolvedSettings = {
    autoGroupByDomain: settings?.autoGroupByDomain === true,
    domainThreshold: Math.max(1, Number(settings?.domainThreshold) || 2),
  }

  const scopedTabs = tabs.filter((tab) => tab.windowId === windowId)
  const groupableTabs = scopedTabs.filter((tab) => isGroupableTab(tab))
  const domainCounts = countUnmatchedDomains(groupableTabs, rules)

  const decisions = groupableTabs.map((tab) => ({
    tab,
    target: targetForTab({
      tab,
      rules,
      settings: resolvedSettings,
      domainCounts,
    }),
  }))

  const touchedIds = mode === 'touched' ? new Set(tabIds) : null
  const buckets = new Map()

  for (const decision of decisions) {
    if (!shouldIncludeDecision(decision, decisions, touchedIds)) continue
    if (isAlreadyInTarget(decision.tab, decision.target, groups, windowId)) continue

    const bucket = buckets.get(decision.target.key) ?? {
      key: decision.target.key,
      title: decision.target.title,
      color: decision.target.color,
      autoCollapse: decision.target.autoCollapse,
      priority: decision.target.priority,
      tabIds: [],
    }
    bucket.tabIds.push(decision.tab.id)
    buckets.set(decision.target.key, bucket)
  }

  const plannedGroups = [...buckets.values()].sort(compareTargets).map((bucket) => ({
    key: bucket.key,
    title: bucket.title,
    color: bucket.color,
    autoCollapse: bucket.autoCollapse,
    priority: bucket.priority,
    tabIds: bucket.tabIds,
    existingGroupId: findExistingGroupId(groups, windowId, bucket.title),
  }))

  return { groups: plannedGroups }
}

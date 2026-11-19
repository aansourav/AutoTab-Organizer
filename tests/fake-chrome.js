import { UNGROUPED_TAB_GROUP_ID } from '../src/matcher.js'

export const createFakeChrome = ({ tabs = [], groups = [], failTabIds = [] } = {}) => {
  const failing = new Set(failTabIds)
  const control = {
    quotaExceeded: false,
    groupCalls: [],
  }

  const createArea = () => {
    const data = {}
    return {
      async get(keys) {
        const list = typeof keys === 'string' ? [keys] : keys
        const result = {}
        for (const key of list) {
          if (Object.hasOwn(data, key)) result[key] = structuredClone(data[key])
        }
        return result
      },
      async set(values) {
        Object.assign(data, structuredClone(values))
      },
      data,
    }
  }

  const local = createArea()
  const sync = createArea()
  const syncSet = sync.set.bind(sync)
  sync.set = async (values) => {
    if (control.quotaExceeded && values.rules) {
      throw new Error('QUOTA_BYTES quota exceeded')
    }
    await syncSet(values)
  }

  const queryTabs = async (queryInfo = {}) =>
    tabs
      .filter((tab) => {
        if (queryInfo.windowId != null && tab.windowId !== queryInfo.windowId) return false
        if (queryInfo.active != null && Boolean(tab.active) !== queryInfo.active) return false
        return true
      })
      .map((tab) => ({ ...tab }))

  const chrome = {
    tabs: {
      query: queryTabs,
      async group({ tabIds, groupId, createProperties }) {
        if (tabIds.some((id) => failing.has(id))) {
          const badId = tabIds.find((id) => failing.has(id))
          throw new Error(`No tab with id: ${badId}.`)
        }

        for (const tabId of tabIds) {
          if (!tabs.some((tab) => tab.id === tabId)) {
            throw new Error(`No tab with id: ${tabId}.`)
          }
        }

        let resolvedId = groupId ?? null
        if (resolvedId == null) {
          resolvedId = groups.reduce((max, group) => Math.max(max, group.id), 0) + 1
          groups.push({
            id: resolvedId,
            windowId: createProperties.windowId,
            title: '',
            color: 'grey',
            collapsed: false,
          })
        }

        const group = groups.find((item) => item.id === resolvedId)
        if (!group) throw new Error('No group')

        for (const tabId of tabIds) {
          const tab = tabs.find((item) => item.id === tabId)
          if (tab.windowId !== group.windowId) {
            throw new Error('Tabs cannot be grouped across windows')
          }
          tab.groupId = resolvedId
        }

        control.groupCalls.push({
          tabIds: [...tabIds],
          groupId: groupId ?? null,
          windowId: createProperties?.windowId ?? group.windowId,
        })

        return resolvedId
      },
      async ungroup(tabIds) {
        for (const tabId of tabIds) {
          const tab = tabs.find((item) => item.id === tabId)
          if (!tab) throw new Error(`No tab with id: ${tabId}.`)
          tab.groupId = UNGROUPED_TAB_GROUP_ID
        }
      },
    },
    tabGroups: {
      async query(queryInfo = {}) {
        return groups
          .filter((group) => queryInfo.windowId == null || group.windowId === queryInfo.windowId)
          .map((group) => ({ ...group }))
      },
      async update(groupId, updateProperties) {
        const group = groups.find((item) => item.id === groupId)
        if (!group) throw new Error('No group')
        Object.assign(group, updateProperties)
      },
    },
    windows: {
      async getAll() {
        const ids = [...new Set(tabs.map((tab) => tab.windowId))]
        return ids.map((id) => ({ id, type: 'normal' }))
      },
    },
    storage: {
      sync,
      local,
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
  }

  return { chrome, control, tabs, groups }
}

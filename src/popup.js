import { GROUP_COLORS, normalizeColor } from './color.js'
import { suggestedPattern } from './matcher.js'
import { MessageType } from './messages.js'
import { ruleTitle } from './rules.js'
import { loadState, saveSettings } from './storage.js'

const autoButton = document.querySelector('#auto-organize')
const hint = document.querySelector('#hint')
const tabCount = document.querySelector('#tab-count')
const groupCount = document.querySelector('#group-count')
const status = document.querySelector('#status')
const groupList = document.querySelector('#group-list')
const actionButtons = [...document.querySelectorAll('.actions button, footer button')]

const extensionAvailable = () =>
  Boolean(globalThis.chrome?.storage && globalThis.chrome?.tabs && globalThis.chrome?.runtime)

const setStatus = (message) => {
  status.textContent = message
}

const setBusy = (busy) => {
  autoButton.disabled = busy
  for (const button of actionButtons) button.disabled = busy
}

const setSwitch = (enabled) => {
  autoButton.setAttribute('aria-checked', String(enabled))
}

const renderHint = (settings) => {
  hint.textContent = settings.autoGroupByDomain
    ? `Unmatched sites group at ${settings.domainThreshold} tabs.`
    : 'Unmatched sites stay loose.'
}

const currentWindowId = async () => {
  const browserWindow = await chrome.windows.getCurrent()
  if (!Number.isInteger(browserWindow?.id)) throw new Error('No browser window was selected.')
  return browserWindow.id
}

const swatchForGroup = (group, rules) => {
  const title = String(group.title ?? '').trim()
  const rule = rules.find((item) => ruleTitle(item) === title)
  if (rule) return normalizeColor(rule.color)
  return GROUP_COLORS.find((color) => color.id === group.color)?.swatch ?? GROUP_COLORS[0].swatch
}

const renderGroupList = (groups, rules) => {
  groupList.replaceChildren()
  if (groups.length === 0) {
    groupList.hidden = true
    return
  }

  const ordered = [...groups].sort((left, right) =>
    String(left.title ?? '').localeCompare(String(right.title ?? '')),
  )
  for (const group of ordered) {
    const item = document.createElement('li')
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = swatchForGroup(group, rules)
    const name = document.createElement('span')
    name.textContent = String(group.title ?? '').trim() || 'Untitled'
    item.append(dot, name)
    groupList.append(item)
  }
  groupList.hidden = false
}

const refreshStats = async (windowId) => {
  const [tabs, groups, state] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    loadState(),
  ])
  tabCount.textContent = String(tabs.length)
  groupCount.textContent = String(groups.length)
  renderGroupList(groups, state.rules)
}

const send = async (type, extra = {}) => {
  const response = await chrome.runtime.sendMessage({ type, ...extra })
  if (!response?.ok) {
    throw new Error(response?.error || 'The organizer did not answer.')
  }
  return response
}

const runAction = async (work) => {
  setBusy(true)
  setStatus('')
  try {
    await work()
    await refreshStats(await currentWindowId())
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Something went wrong.')
  } finally {
    setBusy(false)
  }
}

const describeMoved = (moved) => {
  if (moved === 0) return 'Nothing to move.'
  if (moved === 1) return 'Moved 1 tab.'
  return `Moved ${moved} tabs.`
}

const bindActions = () => {
  autoButton.addEventListener('click', () => {
    void runAction(async () => {
      const state = await loadState()
      const enabled = state.settings.autoOrganizeEnabled !== true
      const saved = await saveSettings({ autoOrganizeEnabled: enabled })
      setSwitch(saved.settings.autoOrganizeEnabled)
      renderHint(saved.settings)
      setStatus(saved.settings.autoOrganizeEnabled ? 'Auto-organize is on.' : 'Auto-organize is off.')
    })
  })

  document.querySelector('#organize-window').addEventListener('click', () => {
    void runAction(async () => {
      const result = await send(MessageType.organizeWindow, { windowId: await currentWindowId() })
      setStatus(describeMoved(result.moved))
    })
  })

  document.querySelector('#organize-all').addEventListener('click', () => {
    void runAction(async () => {
      const result = await send(MessageType.organizeAllWindows)
      if (result.moved === 0) {
        setStatus('Nothing to move.')
        return
      }
      const windows = result.windows === 1 ? '1 window' : `${result.windows} windows`
      setStatus(`Moved ${result.moved} tabs across ${windows}.`)
    })
  })

  document.querySelector('#collapse').addEventListener('click', () => {
    void runAction(async () => {
      const result = await send(MessageType.collapseInactive, { windowId: await currentWindowId() })
      if (result.collapsed === 0) {
        setStatus('No other groups to collapse.')
        return
      }
      setStatus(result.collapsed === 1 ? 'Collapsed 1 group.' : `Collapsed ${result.collapsed} groups.`)
    })
  })

  document.querySelector('#ungroup').addEventListener('click', () => {
    void runAction(async () => {
      const result = await send(MessageType.ungroupWindow, { windowId: await currentWindowId() })
      if (result.ungrouped === 0) {
        setStatus('No groups in this window.')
        return
      }
      setStatus(
        result.ungrouped === 1 ? 'Ungrouped 1 tab.' : `Ungrouped ${result.ungrouped} tabs.`,
      )
    })
  })

  document.querySelector('#add-rule').addEventListener('click', () => {
    void runAction(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const pattern = suggestedPattern(tab?.url || tab?.pendingUrl || '')
      if (!pattern) {
        setStatus('This tab has no site to save.')
        return
      }
      const url = new URL(chrome.runtime.getURL('src/options.html'))
      url.searchParams.set('domain', pattern)
      await chrome.tabs.create({ url: url.href })
      window.close()
    })
  })

  document.querySelector('#open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage()
  })
}

const init = async () => {
  if (!extensionAvailable()) {
    setSwitch(true)
    renderHint({ autoGroupByDomain: true, domainThreshold: 2 })
    setStatus('Load the unpacked extension to organize tabs.')
    setBusy(true)
    return
  }

  bindActions()
  const state = await loadState()
  setSwitch(state.settings.autoOrganizeEnabled === true)
  renderHint(state.settings)
  await refreshStats(await currentWindowId())
}

void init()

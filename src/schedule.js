export const ORGANIZE_DEBOUNCE_MS = 120

export const shouldOrganizeOnUpdate = (changeInfo) => {
  if (!changeInfo || typeof changeInfo !== 'object') return false
  if (typeof changeInfo.url === 'string') return true
  return changeInfo.status === 'complete'
}

export const createWindowDebouncer = ({ waitMs, onFlush }) => {
  const pending = new Map()

  const push = (windowId, tabId) => {
    if (typeof windowId !== 'number') return

    const existing = pending.get(windowId)
    const bucket = existing ?? { tabIds: new Set(), timer: null }
    if (!existing) pending.set(windowId, bucket)
    if (typeof tabId === 'number') bucket.tabIds.add(tabId)

    clearTimeout(bucket.timer)
    bucket.timer = setTimeout(() => {
      pending.delete(windowId)
      onFlush(windowId, [...bucket.tabIds])
    }, waitMs)
  }

  return { push }
}

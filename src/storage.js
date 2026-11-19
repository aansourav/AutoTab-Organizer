import { defaultState, normalizeState } from './rules.js'

let cachedState = null
let isWatching = false

const cloneState = (state) => ({
  rules: state.rules.map((rule) => ({
    ...rule,
    patterns: [...rule.patterns],
  })),
  settings: { ...state.settings },
})

export const clearCachedState = () => {
  cachedState = null
}

const storageAreas = () => {
  const storage = globalThis.chrome?.storage
  if (!storage?.sync || !storage?.local) {
    throw new Error('Chrome storage is unavailable.')
  }
  return storage
}

const isQuotaError = (error) => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('QUOTA')
}

const readRules = async (storage, useLocal) => {
  const area = useLocal ? storage.local : storage.sync
  return area.get(['rules', 'settings'])
}

export const loadState = async () => {
  if (cachedState) return cloneState(cachedState)

  const storage = storageAreas()
  const flag = await storage.sync.get('useLocal')
  const stored = await readRules(storage, flag.useLocal === true)
  const state = normalizeState(stored)
  cachedState = state
  return cloneState(state)
}

export const saveState = async (state) => {
  const normalized = normalizeState(
    { rules: state.rules, settings: state.settings },
    { trustOrder: true },
  )
  const payload = { rules: normalized.rules, settings: normalized.settings }
  const storage = storageAreas()
  const flag = await storage.sync.get('useLocal')

  try {
    if (flag.useLocal === true) {
      await storage.local.set(payload)
    } else {
      await storage.sync.set(payload)
    }
  } catch (error) {
    if (!isQuotaError(error)) throw error
    await storage.local.set(payload)
    await storage.sync.set({ useLocal: true })
  }

  cachedState = normalized
  return cloneState(normalized)
}

export const saveSettings = async (settings) => {
  const state = await loadState()
  return saveState({
    rules: state.rules,
    settings: { ...state.settings, ...settings },
  })
}

export const ensureDefaultState = async () => {
  const storage = storageAreas()
  const flag = await storage.sync.get('useLocal')
  const stored = await readRules(storage, flag.useLocal === true)
  if (Array.isArray(stored.rules)) return loadState()
  return saveState(defaultState())
}

export const watchStorage = () => {
  const storage = globalThis.chrome?.storage
  if (!storage?.onChanged || isWatching) return
  isWatching = true
  storage.onChanged.addListener(() => {
    cachedState = null
  })
}
